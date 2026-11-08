import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Behörighet per route utanför tävlingarna (ADR-0194 klubben, ADR-0182 träningsgruppen, ADR-0172 kontot och superadmin),
 * som `race-roles.test.ts` gör för adminroutes: varje route.ts under api/organizer/clubs, api/organizer/groups, api/account,
 * api/club-import och api/superadmin anropas med varje metod av varje roll, mot en riktig PostgreSQL (egen databas, som
 * integrationstesterna), och svaret jämförs med tabellen `ROUTES` nedan. Tabellen är skriven för hand: en ny route eller
 * metod som saknas i den fäller testet, liksom en roll som får 401/403 där tabellen säger att den får, eller når fram där
 * den inte får.
 *
 * "Får" = svaret är inte 401 eller 403 (ett tillåtet anrop med påhittade id:n slutar ofta i 404 eller 409). "Får inte" =
 * 401 (utloggad), 403 (inloggad utan rätt roll) eller 404 (inte medlem: klubbens och gruppens existens röjs inte).
 * Kroppen i tabellen är giltig för routens schema. Den som inte får prövas också med en ogiltig kropp: inloggningen och
 * behörigheten prövas före kroppen, så utloggad får 401 och inte 400 eller 422 (städrundan 2026-11-07, paket D).
 *
 * Körs när TEST_DATABASE_URL finns (CI och lokalt med en test-databas); annars bara kontrollen att tabellen är komplett.
 */
const target = vi.hoisted(() => {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return undefined;
  const name = `otid_roller_${crypto.randomUUID().replaceAll("-", "")}`;
  const url = new URL(base);
  url.pathname = `/${name}`;
  return { base, name, url: url.href };
});

vi.mock("server-only", () => ({}));
vi.mock("./db", async () => {
  const { createDatabase } = await import("@o-tid/database");
  const created = createDatabase(target?.url ?? "postgresql://ingen:ingen@127.0.0.1:1/ingen", { max: 4 });
  return { db: created.db, pool: created.pool, database: created, publicDatabase: created, publicDb: created.db };
});

type Persona = "OWNER" | "ADMIN" | "LEADER" | "READER" | "GROUP_LEADER" | "GROUP_MEMBER" | "OUTSIDER" | "SUPERADMIN" | "LOGGED_OUT" |
  /** Ett eget, nytt konto för anropet (logga ut överallt, byt lösenord, ta bort kontot). */ "SELF" |
  /** Klubbens importnyckel (`Authorization: Bearer`), utan kakor. */ "IMPORT_TOKEN";
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** Rollerna som prövas på varje route (SELF och IMPORT_TOKEN bara där tabellen nämner dem). */
const PERSONAS: readonly Persona[] = ["OWNER", "ADMIN", "LEADER", "READER", "GROUP_LEADER", "GROUP_MEMBER", "OUTSIDER", "SUPERADMIN", "LOGGED_OUT"];
const LOGGED_IN: readonly Persona[] = ["OWNER", "ADMIN", "LEADER", "READER", "GROUP_LEADER", "GROUP_MEMBER", "OUTSIDER", "SUPERADMIN"];
const CLUB_MEMBERS: readonly Persona[] = ["OWNER", "ADMIN", "LEADER", "READER"];
const CLUB_ADMINS: readonly Persona[] = ["OWNER", "ADMIN"];
const GROUP_LEADERS: readonly Persona[] = ["GROUP_LEADER"];

const id = () => randomUUID();
const agreement = { ownership: "CLUB", ownerKind: null, ownerName: null, agreement: null, validUntil: null, contact: null, trainingOnly: false,
  feePerPrint: false, noPublicDisplay: false };
/** En kartfil och en ritad karta som bara behöver komma fram till behörigheten (innehållet prövas efter den). */
const octet = { raw: "inte-en-karta", headers: { "content-type": "application/octet-stream", "x-otid-file-name": "karta.omap",
  "x-otid-map-name": "Karta" } };
/** Början av en PNG (10 × 10 px): tjänsterna läser bara huvudet före behörigheten. */
function png(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 10);
  new DataView(bytes.buffer).setUint32(20, 10);
  return bytes;
}
const metadata = { formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000, bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 },
  georeference: null, render: { pxPerMm: 8, originX: -2, originY: 102 }, summary: { objectCount: 11, warnings: [], simplifications: [] }, tiePoints: null };
/** Den ritade kartan och dess uppgifter, som webbläsaren skickar vid "Använd igen" (bild och metadata i multipart). */
const multipart = (headers: Record<string, string>) => ({ headers: { ...headers, "content-type": "multipart/form-data; boundary=grans" },
  raw: Buffer.concat([Buffer.from("--grans\r\nContent-Disposition: form-data; name=\"image\"; filename=\"karta.png\"\r\nContent-Type: image/png\r\n\r\n"),
    Buffer.from(png()), Buffer.from(`\r\n--grans\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${
      JSON.stringify(metadata)}\r\n--grans--\r\n`)]) });

interface Rule {
  /** Rollerna som får anropet; alla andra i PERSONAS får inte. */
  allow: readonly Persona[] | "PUBLIC";
  /** JSON-kroppen (en funktion ger en ny per anrop); utan den skickas ingen kropp. */
  body?: unknown;
  raw?: string | Uint8Array;
  headers?: Record<string, string>;
  /** Anropet gäller klubbens riktiga träning, banfil, karta, version och inbjudan (annars påhittade id:n, som ger 404). */
  real?: true;
  /** Routen prövas inte här, med skälet (t.ex. Google, som inte är inställt i testet: alla får 404). */
  untested?: string;
}

const NO_GOOGLE = "Google är inte inställt i testet (alla får 404)";

/** Vad varje roll får, per route och metod. */
const ROUTES: Record<string, Partial<Record<Method, Rule>>> = {
  // --- Kontot (ADR-0172, ADR-0205, ADR-0209) ---------------------------------------------------------------------------------
  "account": { GET: { allow: LOGGED_IN } },
  "account/clubs": {
    GET: { allow: LOGGED_IN },
    POST: { allow: LOGGED_IN, body: { formatVersion: 1, organisationId: null, freeText: "OK Rollerna" } },
    DELETE: { allow: LOGGED_IN, body: () => ({ formatVersion: 1, membershipId: id() }) }
  },
  "account/clubs/step": { POST: { allow: LOGGED_IN, body: { formatVersion: 1, organisationIds: [], freeText: null } } },
  // ADR-0219 (K2): kontots AI-kopplingar.
  "account/ai-connections": { GET: { allow: LOGGED_IN } },
  "account/ai-connections/[grantId]": { DELETE: { allow: LOGGED_IN, untested: "Kopplingen finns bara efter ett godkännande (integrationstestet adr-0219-ai)" } },
  "account/display-name": { POST: { allow: LOGGED_IN, body: { formatVersion: 1, displayName: "Nytt namn" } } },
  "account/delete": { POST: { allow: ["SELF"], body: { formatVersion: 1, password: "hemligt-lösen-1" } } },
  "account/logout-all": { POST: { allow: ["SELF"] } },
  "account/password": { POST: { allow: ["SELF"], body: { formatVersion: 1, currentPassword: "hemligt-lösen-1", newPassword: "ett-annat-lösen-2" } } },
  "account/password-reset": { GET: { allow: "PUBLIC" }, POST: { allow: "PUBLIC", body: { formatVersion: 1, email: "ingen@test.o-tid.se" } } },
  "account/password-reset/complete": { POST: { allow: "PUBLIC", body: { formatVersion: 1, token: "x".repeat(43), newPassword: "ett-annat-lösen-2" } } },
  "account/google/callback": { GET: { allow: "PUBLIC", untested: NO_GOOGLE } },
  "account/google/start": { GET: { allow: "PUBLIC", untested: NO_GOOGLE } },
  "account/google/link": { POST: { allow: LOGGED_IN, untested: NO_GOOGLE } },
  "account/google/delete": { POST: { allow: LOGGED_IN, untested: NO_GOOGLE } },
  "account/google/unlink": { POST: { allow: LOGGED_IN, untested: NO_GOOGLE } },
  "account/google/move": { GET: { allow: LOGGED_IN, untested: NO_GOOGLE }, POST: { allow: LOGGED_IN, untested: NO_GOOGLE },
    DELETE: { allow: LOGGED_IN, untested: NO_GOOGLE } },

  // --- Klubben (ADR-0194, ADR-0209, ADR-0210) --------------------------------------------------------------------------------
  "organizer/clubs": { GET: { allow: LOGGED_IN }, POST: { allow: LOGGED_IN, body: () => ({ formatVersion: 1, requestId: id(), name: "Egen klubb" }) } },
  "organizer/clubs/[clubId]": { GET: { allow: CLUB_MEMBERS } },
  "organizer/clubs/[clubId]/access": { PUT: { allow: CLUB_ADMINS, body: { formatVersion: 1, archive: "MEMBERS", mapBank: "MEMBERS" } } },
  "organizer/clubs/[clubId]/affiliation": { GET: { allow: CLUB_ADMINS } },
  "organizer/clubs/[clubId]/affiliation/decisions": { POST: { allow: CLUB_ADMINS, body: () => ({ formatVersion: 1, membershipId: id(), decision: "CONFIRM" }) } },
  "organizer/clubs/[clubId]/archive": { GET: { allow: CLUB_MEMBERS } },
  "organizer/clubs/[clubId]/archive/summaries": { POST: { allow: CLUB_ADMINS } },
  "organizer/clubs/[clubId]/archive/[entryId]": { GET: { allow: CLUB_MEMBERS, real: true },
    PUT: { allow: CLUB_ADMINS, real: true, body: { formatVersion: 1, trainingDate: null, place: "", title: "Träning", leader: null, tags: [], notes: null } },
    DELETE: { allow: CLUB_ADMINS } },
  // Bilden och kontrollen räknas i en medlems webbläsare och sparas av den (ändrat 2026-11-07: alla som får se arkivet; förvalet
  // i Vem ser vad är alla medlemmar).
  "organizer/clubs/[clubId]/archive/[entryId]/thumbnail": { GET: { allow: CLUB_MEMBERS, real: true },
    PUT: { allow: CLUB_MEMBERS, body: () => ({ formatVersion: 1, readerVersion: 1, status: "MAP_FAILED", detail: null, mapVersionId: id(),
      courseName: null, image: null }) } },
  "organizer/clubs/[clubId]/course-files/[courseFileId]": { GET: { allow: CLUB_MEMBERS, real: true },
    PUT: { allow: CLUB_ADMINS, real: true, body: { formatVersion: 1, mapVersionId: null } } },
  "organizer/clubs/[clubId]/eventor": { POST: { allow: CLUB_ADMINS }, DELETE: { allow: CLUB_ADMINS },
    PUT: { allow: CLUB_ADMINS, body: { formatVersion: 1, apiKey: "k".repeat(32) } } },
  "organizer/clubs/[clubId]/import-tokens": { POST: { allow: CLUB_ADMINS } },
  "organizer/clubs/[clubId]/import-tokens/[tokenId]": { DELETE: { allow: CLUB_ADMINS } },
  "organizer/clubs/[clubId]/import/check": { POST: { allow: CLUB_ADMINS, body: { formatVersion: 1, sha256: [] } } },
  "organizer/clubs/[clubId]/import/batch": { POST: { allow: CLUB_ADMINS, body: { formatVersion: 1, maps: [], entries: [] } } },
  "organizer/clubs/[clubId]/import/content/[sha256]": { PUT: { allow: CLUB_ADMINS, ...octet } },
  "organizer/clubs/[clubId]/invitations/[invitationId]": { POST: { allow: CLUB_ADMINS, real: true, body: { formatVersion: 1, delivery: "LINK" } } },
  "organizer/clubs/[clubId]/map-duplicates": { GET: { allow: CLUB_ADMINS } },
  "organizer/clubs/[clubId]/map-duplicates/dismiss": { POST: { allow: CLUB_ADMINS, body: () => ({ formatVersion: 1, mapIds: [id(), id()] }) } },
  "organizer/clubs/[clubId]/map-merges": { POST: { allow: CLUB_ADMINS, body: () => { const keep = id(); return { formatVersion: 1, keepMapId: keep, mapIds: [keep, id()] }; } } },
  "organizer/clubs/[clubId]/map-merges/[mergeId]/undo": { POST: { allow: CLUB_ADMINS } },
  "organizer/clubs/[clubId]/maps": { POST: { allow: CLUB_ADMINS, ...octet } },
  "organizer/clubs/[clubId]/maps/[mapId]": { POST: { allow: CLUB_ADMINS, ...octet },
    PUT: { allow: CLUB_ADMINS, real: true, body: { formatVersion: 1, name: "Karta", agreement } } },
  "organizer/clubs/[clubId]/maps/[mapId]/versions-copy": { POST: { allow: CLUB_ADMINS, body: () => ({ formatVersion: 1, fromVersionId: null,
    fields: ["maker"], versionIds: [id()] }) } },
  "organizer/clubs/[clubId]/map-versions/[versionId]": { GET: { allow: CLUB_MEMBERS, real: true },
    PUT: { allow: CLUB_ADMINS, real: true, body: { formatVersion: 1, versionDate: null, note: null } } },
  "organizer/clubs/[clubId]/map-versions/[versionId]/check": { GET: { allow: CLUB_MEMBERS, real: true },
    PUT: { allow: CLUB_MEMBERS, real: true, body: { formatVersion: 1, readerVersion: 1, status: "FAILED", detail: null, fileVersion: null, thumbnail: null } } },
  "organizer/clubs/[clubId]/map-versions/[versionId]/move": { POST: { allow: CLUB_ADMINS, body: { formatVersion: 1, targetMapId: null, newMapName: "Ny karta" } } },
  // "Använd igen": läsare i klubben (kartbanken) och därefter admin på tävlingen eller ledare i gruppen; här finns varken
  // tävlingen eller gruppen, så den som får når 404 efter klubbens kontroll.
  "organizer/clubs/[clubId]/map-versions/[versionId]/race": { POST: { allow: CLUB_MEMBERS, ...multipart({ "x-otid-race-id": "10000000-0000-4000-8000-000000000009" }) } },
  "organizer/clubs/[clubId]/map-versions/[versionId]/group": { POST: { allow: CLUB_MEMBERS, ...multipart({ "x-otid-group-id": "10000000-0000-4000-8000-000000000009" }) } },
  "organizer/clubs/[clubId]/members": {
    POST: { allow: CLUB_ADMINS, body: () => ({ formatVersion: 1, requestId: id(), email: `ny.${id().slice(0, 8)}@test.o-tid.se`, role: "READER" }) },
    PUT: { allow: CLUB_ADMINS, body: () => ({ formatVersion: 1, memberId: id(), role: "READER" }) },
    DELETE: { allow: CLUB_ADMINS, body: () => ({ formatVersion: 1, memberId: id(), invitationId: null }) }
  },

  // --- Klubbens import från ägarens dator (ADR-0194 beslut 6–7): bara importnyckeln --------------------------------------------
  "club-import/token": { GET: { allow: ["IMPORT_TOKEN"] } },
  "club-import/[clubId]/check": { POST: { allow: ["IMPORT_TOKEN"], body: { formatVersion: 1, sha256: [] } } },
  "club-import/[clubId]/batch": { POST: { allow: ["IMPORT_TOKEN"], body: { formatVersion: 1, maps: [], entries: [] } } },
  "club-import/[clubId]/content/[sha256]": { PUT: { allow: ["IMPORT_TOKEN"], ...octet } },

  // --- Träningsgruppen (ADR-0182, ADR-0189) ------------------------------------------------------------------------------------
  "organizer/groups": { GET: { allow: LOGGED_IN },
    POST: { allow: LOGGED_IN, body: () => ({ formatVersion: 1, requestId: id(), name: "Egen grupp", code: `egen-${id().slice(0, 8)}` }) } },
  "organizer/groups/[groupId]": { GET: { allow: GROUP_LEADERS },
    PUT: { allow: GROUP_LEADERS, body: { formatVersion: 1, name: "Rollgruppen", pageVisibility: "LINK", nameDisplay: "FIRST", statsVisibility: "LEADERS",
      pointsMode: "NONE", templateRaceId: null } } },
  "organizer/groups/[groupId]/invitations/[invitationId]": { POST: { allow: GROUP_LEADERS, real: true, body: { formatVersion: 1, delivery: "LINK" } } },
  "organizer/groups/[groupId]/maps": { POST: { allow: GROUP_LEADERS, body: () => ({ formatVersion: 1, requestId: id(), raceId: id(), name: "Karta",
    includeCourseSetting: false, agreement }) } },
  "organizer/groups/[groupId]/maps/[mapId]": { PUT: { allow: GROUP_LEADERS, body: { formatVersion: 1, name: "Karta", agreement } },
    DELETE: { allow: GROUP_LEADERS } },
  "organizer/groups/[groupId]/members": {
    POST: { allow: GROUP_LEADERS, body: () => ({ formatVersion: 1, requestId: id(), email: `ny.${id().slice(0, 8)}@test.o-tid.se`, role: "MEMBER" }) },
    DELETE: { allow: GROUP_LEADERS, body: () => ({ formatVersion: 1, memberId: id() }) }
  },
  "organizer/groups/[groupId]/series/[seriesId]/undo": { POST: { allow: GROUP_LEADERS } },
  "organizer/groups/[groupId]/sessions": { POST: { allow: GROUP_LEADERS, body: () => ({ formatVersion: 1, requestId: id(), source: "RACE",
    sourceRaceId: id(), eventName: "Träning", raceDate: "2026-11-10", startTime: null, mapId: null, includeCourseSetting: false, publish: false,
    repeat: null, acknowledgeAgreement: false }) } },
  "organizer/groups/[groupId]/sessions/[raceId]": { DELETE: { allow: GROUP_LEADERS } },

  // --- Superadmin (ADR-0172) ---------------------------------------------------------------------------------------------------
  "superadmin": { GET: { allow: ["SUPERADMIN"] } },
  "superadmin/actions": { POST: { allow: ["SUPERADMIN"], body: () => ({ formatVersion: 1, action: "HIDE_RACE", raceId: id(), reason: "Behörighetstest" }) } }
};

const origin = "http://127.0.0.1:3100";
const PASSWORD = "hemligt-lösen-1";
const api = fileURLToPath(new URL("../app/api/", import.meta.url));
function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? routeFiles(join(directory, entry.name)) : entry.name === "route.ts" ? [join(directory, entry.name)] : []);
}
const PREFIXES = ["organizer/clubs", "organizer/groups", "account", "club-import", "superadmin"];
const routes = routeFiles(api).map(file => ({ file, path: relative(api, file).split(sep).slice(0, -1).join("/") }))
  .filter(route => PREFIXES.some(prefix => route.path === prefix || route.path.startsWith(`${prefix}/`)))
  .sort((a, b) => a.path.localeCompare(b.path));
type Handler = (request: Request, context: unknown) => Promise<Response>;
type Handlers = Partial<Record<Method, Handler>>;
async function methodsOf(file: string): Promise<{ handlers: Handlers; methods: Method[] }> {
  const handlers = await import(file) as Handlers;
  return { handlers, methods: METHODS.filter(name => typeof handlers[name] === "function") };
}

describe("tabellen över klubbens, gruppens, kontots, importens och superadmins routes", () => {
  it("har varje route och metod, och inget annat", { timeout: 60_000 }, async () => {
    const found: string[] = [];
    for (const route of routes) for (const method of (await methodsOf(route.file)).methods) found.push(`${method} ${route.path}`);
    const listed = Object.entries(ROUTES).flatMap(([path, methods]) => Object.keys(methods).map(method => `${method} ${path}`));
    expect(found.sort()).toEqual(listed.sort());
    expect(found.length).toBeGreaterThan(75);
  });
});

type Session = { sessionToken: string; csrfToken: string; accountId: string };

describe.skipIf(!target)("behörighet per route för klubben, gruppen, kontot, importen och superadmin", () => {
  const sessions = new Map<Persona, Session>();
  let clubId = "", groupId = "", importToken = "";
  /** Klubbens träning med en banfil, kartan med en version och inbjudningarna (för anrop med `real`). */
  const real: Record<string, string> = {};
  let newSession: (superadmin?: boolean) => Promise<Session> = async () => { throw new Error("inte klar"); };
  let close: () => Promise<void> = async () => undefined;

  beforeAll(async () => {
    vi.stubEnv("O_TID_PUBLIC_ORIGIN", origin);
    vi.stubEnv("NODE_ENV", "test");
    // Eventor inställt (men oåtkomligt), så att kopplingen prövar behörigheten i stället för att svara "inte inställt".
    vi.stubEnv("OTID_EVENTOR_MASTER_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("OTID_EVENTOR_BASE_URL", "http://127.0.0.1:9/");
    // Tillåtna anrop med påhittade id:n kan logga ett internt fel; det prövas inte här.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { createDatabase, migrate, schema } = await import("@o-tid/database");
    const admin = createDatabase(target!.base);
    await admin.pool.query(`CREATE DATABASE "${target!.name}"`);
    await admin.pool.end();
    const { db, pool } = await import("./db");
    close = async () => {
      await pool.end();
      if (!/^otid_roller_[a-f0-9]{32}$/.test(target!.name)) throw new Error("Ogiltig testdatabas för rensning");
      const again = createDatabase(target!.base);
      await again.pool.query(`DROP DATABASE IF EXISTS "${target!.name}" WITH (FORCE)`);
      await again.pool.end();
    };
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../../../packages/database/migrations", import.meta.url)) });
    const application = await import("@o-tid/application");
    const now = new Date();
    newSession = async (superadmin = false) => {
      const login = await application.registerUserAccount(db, { formatVersion: 1, email: `roll.${id().slice(0, 12)}@test.o-tid.se`,
        displayName: "Roll Rollsson", password: PASSWORD }, { now });
      if (login.status !== "authenticated") throw new Error(`Kontot kunde inte skapas: ${login.status}`);
      await pool.query("update user_account set email_verified_at = $1, is_superadmin = $2 where id = $3", [now, superadmin, login.response.accountId]);
      return { sessionToken: login.sessionToken, csrfToken: login.csrfToken, accountId: login.response.accountId };
    };
    for (const persona of LOGGED_IN) sessions.set(persona, await newSession(persona === "SUPERADMIN"));
    const proof = (persona: Persona) => ({ sessionToken: sessions.get(persona)!.sessionToken, csrfCookie: sessions.get(persona)!.csrfToken,
      csrfHeader: sessions.get(persona)!.csrfToken });
    // Klubben: ägaren skapar den; administratören, ledaren och medlemmen läggs till (bekräftade konton).
    const club = await application.createClub(db, { ...proof("OWNER"), request: { formatVersion: 1, requestId: id(), name: "Rollklubben" } }, now);
    if (club.status !== "created") throw new Error(club.status);
    clubId = club.club.clubId;
    for (const role of ["ADMIN", "LEADER", "READER"] as const) {
      await db.insert(schema.clubMembers).values({ id: id(), clubId, accountId: sessions.get(role)!.accountId, role, addedAt: now,
        addedBy: sessions.get("OWNER")!.accountId, requestId: id() });
    }
    const token = await application.createClubImportToken(db, { ...proof("OWNER"), clubId }, now);
    if (token.status !== "created") throw new Error(token.status);
    importToken = token.token;
    const mapFile = await readFile(fileURLToPath(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
    const uploaded = await application.uploadClubMapVersion(db, { ...proof("OWNER"), clubId, mapId: null, newMapName: "Rollkartan",
      fileName: "kartfil.omap", versionDate: null, note: null, body: (async function* () { yield new Uint8Array(mapFile); })() }, now);
    if (uploaded.status !== "created") throw new Error(`Kartan: ${uploaded.status}`);
    real.mapId = uploaded.mapId;
    real.versionId = uploaded.versionId;
    const ppen = await readFile(fileURLToPath(new URL("../../../../fixtures/course-setting/kartfil.ppen", import.meta.url)));
    const imported = await application.importBatch(db, { token: importToken, clubId, request: { formatVersion: 1, maps: [], entries: [{
      importKey: "rolltraning", trainingDate: null, year: null, place: "", title: "Rollträning", leader: null, tags: [], sourcePath: "rolltraning",
      mapSha256: [], courseFiles: [{ fileName: "kartfil.ppen", kind: "PPEN", sha256: createHash("sha256").update(ppen).digest("hex"),
        contentBase64: ppen.toString("base64"), mapReference: null, mapSha256: null, resolution: "NONE" }] }] } }, now);
    if (imported.status !== "ok") throw new Error(`Importen: ${imported.status}`);
    const archive = await application.readClubArchive(db, { ...proof("OWNER"), clubId }, now);
    if (archive.status !== "ok") throw new Error(archive.status);
    real.entryId = archive.list.entries[0]!.entryId;
    const entry = await application.readClubArchiveEntry(db, { ...proof("OWNER"), clubId, entryId: real.entryId }, now);
    if (entry.status !== "ok") throw new Error(entry.status);
    real.courseFileId = entry.view.courseFiles[0]!.courseFileId;
    const invited = await application.inviteClubMember(db, { ...proof("OWNER"), clubId, request: { formatVersion: 1, requestId: id(),
      email: "inbjuden.klubb@test.o-tid.se", role: "READER" } }, now);
    if (invited.status !== "invited") throw new Error(invited.status);
    real.clubInvitationId = invited.invitationId;
    // Gruppen: ledaren skapar den; medlemmen läggs till.
    const group = await application.createTrainingGroup(db, { ...proof("GROUP_LEADER"), request: { formatVersion: 1, requestId: id(),
      name: "Rollgruppen", code: "rollgruppen" } }, now);
    if (group.status !== "created") throw new Error(group.status);
    groupId = group.group.groupId;
    await db.insert(schema.trainingGroupMembers).values({ id: id(), groupId, accountId: sessions.get("GROUP_MEMBER")!.accountId,
      role: "MEMBER", addedAt: now, addedBy: sessions.get("GROUP_LEADER")!.accountId, requestId: id() });
    const pending = await application.addGroupMember(db, { ...proof("GROUP_LEADER"), groupId, request: { formatVersion: 1, requestId: id(),
      email: "inbjuden.grupp@test.o-tid.se", role: "MEMBER" } }, now);
    if (pending.status !== "added") throw new Error(pending.status);
    real.groupInvitationId = pending.member.memberId;
  }, 180_000);
  afterAll(async () => { await close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  async function call(path: string, handler: Handler, method: Method, rule: Rule, persona: Persona, invalidBody = false): Promise<number> {
    const session = persona === "SELF" ? await newSession() : sessions.get(persona);
    const other = id();
    const fixed: Record<string, string> = { clubId, groupId, sha256: "a".repeat(64), ...(rule.real ? { ...real,
      invitationId: path.startsWith("organizer/groups") ? real.groupInvitationId! : real.clubInvitationId! } : {}) };
    const value = (name: string) => fixed[name] ?? other;
    const url = path.replaceAll(/\[([a-zA-Z0-9]+)\]/g, (_, name: string) => value(name));
    const params = Promise.resolve(Object.fromEntries(["clubId", "groupId", "sha256", "entryId", "courseFileId", "tokenId", "invitationId", "versionId",
      "mapId", "mergeId", "seriesId", "raceId"].map(name => [name, value(name)])));
    const body = invalidBody ? { formatVersion: 0 } : typeof rule.body === "function" ? (rule.body as () => unknown)() : rule.body;
    const headers: Record<string, string> = { origin, ...rule.headers };
    if (session) {
      headers.cookie = `otid_organizer_session=${session.sessionToken}; otid_organizer_csrf=${session.csrfToken}`;
      headers["x-otid-csrf"] = session.csrfToken;
    }
    if (persona === "IMPORT_TOKEN") headers.authorization = `Bearer ${importToken}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (invalidBody) headers["content-type"] = "application/json";
    const payload: BodyInit | undefined = body !== undefined ? JSON.stringify(body) : typeof rule.raw === "string" ? rule.raw
      : rule.raw ? new Blob([new Uint8Array(rule.raw)]) : undefined;
    const response = await handler(new Request(`${origin}/api/${url}`, { method, headers, ...(payload !== undefined ? { body: payload } : {}) }), { params });
    return response.status;
  }

  it("ger varje roll det tabellen säger, och inget annat", { timeout: 300_000 }, async () => {
    const lines: string[] = [];
    let checked = 0;
    for (const route of routes) {
      const { handlers, methods } = await methodsOf(route.file);
      for (const method of methods) {
        const rule = ROUTES[route.path]?.[method];
        if (!rule || rule.untested) continue;
        const allowed = rule.allow;
        // Kontots förstörande anrop (logga ut överallt, lösenord, ta bort) prövas med ett eget konto och utloggad.
        const personas: readonly Persona[] = allowed === "PUBLIC" ? PERSONAS : allowed.includes("SELF") ? ["SELF", "LOGGED_OUT"]
          : allowed.includes("IMPORT_TOKEN") ? ["IMPORT_TOKEN", ...PERSONAS] : PERSONAS;
        for (const persona of personas) {
          const status = await call(route.path, handlers[method]!, method, rule, persona);
          const may = allowed === "PUBLIC" || allowed.includes(persona);
          const ok = may ? status !== 401 && status !== 403
            : persona === "LOGGED_OUT" || persona === "IMPORT_TOKEN" ? status === 401 : [401, 403, 404].includes(status);
          if (!ok || process.env.OTID_ROLLER_MATRIS) lines.push(`${ok ? "  " : "✗ "}${method} /api/${route.path} som ${persona}: ${status} (${may ? "får" : "får inte"})`);
          checked += 1;
          // Den som inte får avvisas på samma sätt med en ogiltig kropp (behörigheten före kroppen). Utloggad också där kroppen
          // är en fil (som får fel typ här); en inloggad får där 400 för fel typ före tjänsten, vilket inte röjer något.
          if (!may && (rule.body !== undefined || (rule.raw !== undefined && persona === "LOGGED_OUT"))) {
            const invalid = await call(route.path, handlers[method]!, method, rule, persona, true);
            const denied = persona === "LOGGED_OUT" || persona === "IMPORT_TOKEN" ? invalid === 401 : [401, 403, 404].includes(invalid);
            if (!denied) lines.push(`✗ ${method} /api/${route.path} som ${persona} med ogiltig kropp: ${invalid} (får inte)`);
          }
        }
      }
    }
    if (process.env.OTID_ROLLER_MATRIS) console.log(lines.join("\n"));
    expect(lines.filter(line => line.startsWith("✗"))).toEqual([]);
    expect(checked).toBeGreaterThan(600);
  });
});
