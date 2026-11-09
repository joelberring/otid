import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { readMapFile, sha256Hex, type MapObject } from "@o-tid/map-file";
import { baseKey, newKey, objectRefFor, type ObjectState } from "@o-tid/map-revision";
import { acceptAllInvitations } from "../../src/account-arrival";
import { createClub, inviteClubMember, listMyClubs } from "../../src/clubs";
import { readClubMapVersionHead, uploadClubMapVersion } from "../../src/club-maps";
import { readInvitationLink, type InvitationMail } from "../../src/invitation-links";
import { readMapContent, sweepMapContent } from "../../src/map-content";
import {
  createMapProject, createMapProjectFromUpload, inviteMapProjectMember, listMapProjects, readMapProject, readMapProjectSource, removeMapProjectMember,
  setMapProjectMemberRole, updateMapProject
} from "../../src/map-projects";
import { syncMapProject } from "../../src/map-project-sync";
import { exportMapProjectChanges, readMapProjectOutput, revisionNote, writeMapProjectVersion } from "../../src/map-project-output";
import { deleteAccountWithOwnedEvents, soleOwnerships } from "../../src/account-self-service";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 (steg K0): kartprojekten. Behörigheten (egna medlemmar, klubbens administratörer som ägare, andra får inget),
 * inbjudan med e-post (länken och att den tas vid inloggning), synken per objekt med krock bara på samma objekt, att nya objekt
 * aldrig krockar och att samma ändring görs en gång, ett avslutat projekt som inte kvitterar, "Skapa ny kartversion" med den
 * riktiga skrivaren (en ny version, grundversionen orörd, samma version igen utan nya ändringar) och exporten. Kartan är den
 * syntetiska Mapper-fixturen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-07T20:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const SHA = sha256Hex(mapBytes);
const parsed = readMapFile(mapBytes, "Skogen.omap", { sources: true });
async function* chunks(bytes: Uint8Array) { yield bytes; }

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const pointObject = parsed.objects.find(object => object.kind === "point") as Extract<MapObject, { kind: "point" }>;
const lineObject = parsed.objects.find(object => object.kind === "line")!;
const POINT_REF = objectRefFor(SHA, pointObject)!;
const LINE_REF = objectRefFor(SHA, lineObject)!;
const moved = (dx: number): ObjectState => ({ kind: "OBJECT", object: { ...pointObject, at: { x: pointObject.at.x + dx, y: pointObject.at.y } } });
const added = (x: number): ObjectState => ({ kind: "OBJECT", object: { kind: "point", symbol: pointObject.symbol, at: { x, y: 0 }, angle: 0 } });

function edit(key: string, state: ObjectState, editBase: string | null, kind = "MOVE", ref = key === baseKey(POINT_REF) ? POINT_REF
  : key === baseKey(LINE_REF) ? LINE_REF : null) {
  return { editId: randomUUID(), key, ref, base: editBase, state, kind, at: NOW.toISOString() };
}

type Proof = Awaited<ReturnType<typeof registerTestAccount>>["proof"];

async function setup() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Kartprojekt" } }, NOW);
  if (created.status !== "created") throw new Error("Ingen klubb");
  const clubId = created.club.clubId;
  const uploaded = await uploadClubMapVersion(db, { ...owner.proof, clubId, mapId: null, newMapName: "Skogen", fileName: "Skogen.omap",
    versionDate: "2025-05-01", note: null, body: chunks(mapBytes) }, NOW);
  if (uploaded.status !== "created") throw new Error(`Ingen karta: ${uploaded.status}`);
  const people = { mapper: await registerTestAccount(db, undefined, NOW), reader: await registerTestAccount(db, undefined, NOW),
    outsider: await registerTestAccount(db, undefined, NOW), clubMember: await registerTestAccount(db, undefined, NOW) };
  // En vanlig medlem i klubben är inte med i projektet.
  expect((await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: people.clubMember.email,
    role: "READER" } }, NOW)).status).toBe("invited");
  await listMyClubs(db, people.clubMember.proof, NOW);
  const project = await createMapProject(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), clubId,
    baseVersionId: uploaded.versionId, name: "Rekning hösten 2026" } }, NOW);
  if (project.status !== "created") throw new Error(`Inget projekt: ${project.status}`);
  const projectId = project.projectId;
  const mails: InvitationMail[] = [];
  for (const [person, role] of [[people.mapper, "EDIT"], [people.reader, "READ"]] as const) {
    const invited = await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(),
      email: person.email, role } }, NOW, async mail => { mails.push(mail); });
    expect(invited).toMatchObject({ status: "invited", mail: "sent" });
  }
  return { owner, ...people, clubId, mapId: uploaded.mapId, versionId: uploaded.versionId, projectId, mails };
}

async function sync(proof: Proof, projectId: string, edits: unknown[], since = 0, clientId = "telefon-1") {
  const result = await syncMapProject(db, { ...proof, projectId, request: { formatVersion: 1, clientId, since, edits } }, NOW);
  if (result.status !== "ok") throw new Error(`Synken: ${result.status}`);
  return result.response;
}

describe("ADR-0219 kartprojekt", () => {
  it("egna medlemmar: ägare hanterar, Ändra ändrar, Läsa ser, andra får inget", async () => {
    const s = await setup();
    // Inbjudan: länken visar projektet och rollen och leder till projektets sida; den tas när kontot loggar in.
    const link = await readInvitationLink(db, s.mails[0]!.token, NOW);
    expect(link).toMatchObject({ status: "valid", kind: "MAP_PROJECT", targetName: "Rekning hösten 2026", role: "EDIT",
      next: `/organizer/map-projects/${s.projectId}` });
    await db.transaction(tx => acceptAllInvitations(tx, s.mapper.accountId, NOW));
    const mapper = await readMapProject(db, { ...s.mapper.proof, projectId: s.projectId }, NOW);
    expect(mapper.status === "ok" && mapper.view.viewer).toMatchObject({ canEdit: true, canManage: false, canWriteVersion: false, canArchive: false });
    expect(mapper.status === "ok" && mapper.view.invitations).toEqual([]);
    // Läsaren tar inbjudan när projektet öppnas.
    const reader = await readMapProject(db, { ...s.reader.proof, projectId: s.projectId }, NOW);
    expect(reader.status === "ok" && reader.view).toMatchObject({ role: "READ", viewer: { canEdit: false } });
    expect((await syncMapProject(db, { ...s.reader.proof, projectId: s.projectId, request: { formatVersion: 1, clientId: "l", since: 0,
      edits: [edit(baseKey(POINT_REF), moved(1), null)] } }, NOW)).status).toBe("forbidden");
    expect((await sync(s.reader.proof, s.projectId, [])).results).toEqual([]);
    expect((await readMapProjectSource(db, { ...s.reader.proof, projectId: s.projectId }, NOW)).status).toBe("ok");
    for (const other of [s.outsider, s.clubMember]) {
      expect((await readMapProject(db, { ...other.proof, projectId: s.projectId }, NOW)).status).toBe("not-found");
      expect((await readMapProjectSource(db, { ...other.proof, projectId: s.projectId }, NOW)).status).toBe("not-found");
      const list = await listMapProjects(db, other.proof, NOW);
      expect(list.status === "ok" && list.list.projects).toEqual([]);
    }
    // Ägaren ser inbjudningarna; Ändra hanterar inte medlemmar och skapar inga projekt eller versioner.
    const owner = await readMapProject(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    expect(owner.status === "ok" && owner.view.viewer).toMatchObject({ canManage: true, canWriteVersion: true, canArchive: true });
    expect(owner.status === "ok" && owner.view.base).toMatchObject({ source: "ARCHIVE", versionId: s.versionId, mapName: "Skogen" });
    expect(owner.status === "ok" && owner.view.members.map(member => member.role)).toEqual(["OWNER", "EDIT", "READ"]);
    expect((await inviteMapProjectMember(db, { ...s.mapper.proof, projectId: s.projectId, request: { formatVersion: 1, requestId: randomUUID(),
      email: "ny@test.o-tid.se", role: "EDIT" } }, NOW)).status).toBe("forbidden");
    expect((await createMapProject(db, { ...s.mapper.proof, request: { formatVersion: 1, requestId: randomUUID(), clubId: s.clubId,
      baseVersionId: s.versionId, name: "Eget" } }, NOW)).status).toBe("not-found");
    expect((await writeMapProjectVersion(db, { ...s.mapper.proof, projectId: s.projectId, request: { formatVersion: 1, requestId: randomUUID() } },
      NOW)).status).toBe("forbidden");
    // Roller: läsaren får ändra; den sista ägaren kan inte bli något annat eller tas bort; en medlem kan lämna själv.
    expect((await setMapProjectMemberRole(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, accountId: s.reader.accountId,
      role: "EDIT" } }, NOW)).status).toBe("ok");
    expect((await setMapProjectMemberRole(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, accountId: s.owner.accountId,
      role: "READ" } }, NOW)).status).toBe("conflict");
    expect((await removeMapProjectMember(db, { ...s.mapper.proof, projectId: s.projectId, request: { formatVersion: 1, accountId: s.reader.accountId,
      invitationId: null } }, NOW)).status).toBe("forbidden");
    expect((await removeMapProjectMember(db, { ...s.reader.proof, projectId: s.projectId, request: { formatVersion: 1, accountId: s.reader.accountId,
      invitationId: null } }, NOW)).status).toBe("removed");
    expect((await readMapProject(db, { ...s.reader.proof, projectId: s.projectId }, NOW)).status).toBe("not-found");
    // En vanlig medlem i klubben får starta ett eget projekt ur arkivet (rättelsen 2026-11-07); det hör till klubben, så
    // klubbens administratör är ägare där också.
    const own = await createMapProject(db, { ...s.clubMember.proof, request: { formatVersion: 1, requestId: randomUUID(), clubId: s.clubId,
      baseVersionId: s.versionId, name: "Medlemmens rekning" } }, NOW);
    if (own.status !== "created") throw new Error(own.status);
    const mine = await readMapProject(db, { ...s.clubMember.proof, projectId: own.projectId }, NOW);
    expect(mine.status === "ok" && mine.view).toMatchObject({ role: "OWNER", viewer: { canWriteVersion: true, canArchive: false } });
    const asAdmin = await readMapProject(db, { ...s.owner.proof, projectId: own.projectId }, NOW);
    expect(asAdmin.status === "ok" && asAdmin.view).toMatchObject({ role: "OWNER", viewer: { canArchive: true } });
  });

  it("klubbens administratörer är ägare, och ett borttaget konto lämnar projektet med någon som kan hantera det", async () => {
    const s = await setup();
    // En andra administratör i klubben; den som startade projektet tar bort sitt konto.
    expect((await inviteClubMember(db, { ...s.owner.proof, clubId: s.clubId, request: { formatVersion: 1, requestId: randomUUID(),
      email: s.outsider.email, role: "ADMIN" } }, NOW)).status).toBe("invited");
    await listMyClubs(db, s.outsider.proof, NOW);
    const before = await readMapProject(db, { ...s.outsider.proof, projectId: s.projectId }, NOW);
    expect(before.status === "ok" && before.view).toMatchObject({ role: "OWNER", viewer: { canManage: true, canWriteVersion: true } });
    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, s.owner.accountId, NOW));
    const [member] = await db.select().from(schema.mapProjectMembers).where(eq(schema.mapProjectMembers.accountId, s.owner.accountId));
    expect(member).toBeUndefined();
    const after = await readMapProject(db, { ...s.outsider.proof, projectId: s.projectId }, NOW);
    expect(after.status === "ok" && after.view.members.map(row => row.role)).toEqual([]);
    expect((await updateMapProject(db, { ...s.outsider.proof, projectId: s.projectId, request: { formatVersion: 1, name: "Nytt namn" } }, NOW)).status)
      .toBe("ok");
    // Projektet och dess grundfil står kvar; underhållet tar inte grundfilens innehåll.
    await db.transaction(tx => sweepMapContent(tx, new Date(NOW.getTime() + 2 * 3600_000)));
    expect(await readMapContent(db, SHA)).toBeDefined();
  });

  it("synkar per objekt: krock bara på samma objekt, nya objekt krockar aldrig, samma ändring görs en gång", async () => {
    const s = await setup();
    await db.transaction(tx => acceptAllInvitations(tx, s.mapper.accountId, NOW));
    const first = edit(baseKey(POINT_REF), moved(2), null);
    const ownerAdd = edit(newKey(randomUUID()), added(5), null, "ADD");
    const owner = await sync(s.owner.proof, s.projectId, [first, ownerAdd]);
    expect(owner.results.map(row => (row as { status: string }).status)).toEqual(["APPLIED", "APPLIED"]);
    expect(owner.seq).toBe(2);
    // Kartritaren ändrade samma punkt utan att ha sett ägarens ändring: krock. Linjen och ett nytt objekt går igenom.
    const clash = edit(baseKey(POINT_REF), moved(3), null);
    const line = edit(baseKey(LINE_REF), { kind: "DELETED" }, null, "DELETE");
    const mapperAdd = edit(newKey(randomUUID()), added(9), null, "ADD");
    const mapper = await sync(s.mapper.proof, s.projectId, [clash, line, mapperAdd], 0, "telefon-2");
    expect(mapper.results.map(row => (row as { status: string }).status)).toEqual(["CONFLICT", "APPLIED", "APPLIED"]);
    expect((mapper.results[0] as { current: { lastEditId: string } }).current.lastEditId).toBe(first.editId);
    expect(mapper.objects).toHaveLength(4);
    // Samma omgång igen (svaret kom aldrig fram): inget görs två gånger.
    const again = await sync(s.mapper.proof, s.projectId, [line, mapperAdd], mapper.seq, "telefon-2");
    expect(again.results.map(row => (row as { status: string }).status)).toEqual(["DUPLICATE", "DUPLICATE"]);
    expect(again.seq).toBe(mapper.seq);
    // Välj mitt: en ny ändring byggd på ägarens.
    const resolved = await sync(s.mapper.proof, s.projectId, [edit(baseKey(POINT_REF), moved(3), first.editId, "RESOLVE")], again.seq, "telefon-2");
    expect((resolved.results[0] as { status: string }).status).toBe("APPLIED");
    // En referens till en annan fil avvisas.
    const foreign = { ...edit(baseKey(POINT_REF), moved(4), null), ref: { ...POINT_REF, fileSha256: "f".repeat(64) } };
    expect((await sync(s.mapper.proof, s.projectId, [foreign], resolved.seq)).results[0]).toMatchObject({ status: "REJECTED", reason: "base" });
    // Ett avslutat projekt tar inte emot och kvitterar inget.
    expect((await updateMapProject(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, status: "CLOSED" } }, NOW)).status).toBe("ok");
    const closed = await sync(s.mapper.proof, s.projectId, [edit(newKey(randomUUID()), added(11), null, "ADD")], resolved.seq);
    expect(closed).toMatchObject({ status: "CLOSED", results: [] });
    const summary = await readMapProject(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    expect(summary.status === "ok" && summary.view.changedObjects).toBe(4);
  });

  it("skapar en ny kartversion med skrivaren, grundversionen orörd, och exporterar ändringarna", async () => {
    const s = await setup();
    expect(await writeMapProjectVersion(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, requestId: randomUUID() } },
      NOW)).toMatchObject({ status: "ok", response: { status: "empty" } });
    await sync(s.owner.proof, s.projectId, [edit(baseKey(POINT_REF), moved(7), null), edit(baseKey(LINE_REF), { kind: "DELETED" }, null, "DELETE"),
      edit(newKey(randomUUID()), added(12), null, "ADD")]);
    const requestId = randomUUID();
    const written = await writeMapProjectVersion(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, requestId,
      archive: true } }, NOW);
    expect(written).toMatchObject({ status: "ok", replayed: false, response: { status: "created", changes: 3, added: 1, modified: 1, deleted: 1 } });
    if (written.status !== "ok" || written.response.status !== "created") throw new Error("ingen version");
    const versionId = written.response.versionId!;
    expect(versionId).toBeTruthy();
    expect(written.response.fileName).toBe("Skogen reviderad 2026-11-07.omap");
    const [version] = await db.select().from(schema.clubMapVersions).where(eq(schema.clubMapVersions.id, versionId));
    expect(version).toMatchObject({ mapId: s.mapId, note: revisionNote([`Arrangör ${s.owner.email.split("@")[0]}`], 3) });
    // Den nya filen: punkten flyttad, linjen borta, ett nytt objekt; alla andra objekt som förut.
    const bytes = new Uint8Array((await readMapContent(db, version!.contentSha256))!);
    const reread = readMapFile(bytes, "ny.omap");
    expect(reread.objects).toHaveLength(parsed.objects.length);
    const point = reread.objects.find(object => object.kind === "point" && Math.abs(object.at.x - (pointObject.at.x + 7)) < 0.001);
    expect(point).toBeDefined();
    // Grundversionen är orörd.
    const head = await readClubMapVersionHead(db, { ...s.owner.proof, clubId: s.clubId, versionId: s.versionId }, NOW);
    expect(head.status === "ok" && head.sha256).toBe(SHA);
    // Samma begäran igen, och en ny begäran utan nya ändringar, ger samma version.
    expect(await writeMapProjectVersion(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, requestId, archive: true } }, NOW))
      .toMatchObject({ status: "ok", replayed: true, response: { versionId } });
    expect(await writeMapProjectVersion(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, requestId: randomUUID() } }, NOW))
      .toMatchObject({ status: "ok", replayed: true, response: { versionId } });
    const view = await readMapProject(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    expect(view.status === "ok" && view.view.outputs.map(output => output.versionId)).toEqual([versionId]);
    // Exporten: Mapper-fil med bara ändringarna och GeoJSON, för alla medlemmar.
    await db.transaction(tx => acceptAllInvitations(tx, s.reader.accountId, NOW));
    const omap = await exportMapProjectChanges(db, { ...s.reader.proof, projectId: s.projectId, format: "omap" }, NOW);
    expect(omap.status === "ok" && readMapFile(new TextEncoder().encode(omap.body)).objects).toHaveLength(3);
    const geo = await exportMapProjectChanges(db, { ...s.reader.proof, projectId: s.projectId, format: "geojson" }, NOW);
    expect(geo.status === "ok" && (JSON.parse(geo.body) as { features: unknown[] }).features).toHaveLength(3);
  });

  it("eget projekt från en uppladdad fil: utan klubb, resultatet sparas i projektet, och kontot kan inte lämna andra utan ägare", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const other = await registerTestAccount(db, undefined, NOW);
    const requestId = randomUUID();
    const metadata = { formatVersion: 1, requestId, name: "Kungshatt", fileName: "Kungshatt.omap" };
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata, file: mapBytes }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    expect(await createMapProjectFromUpload(db, { ...owner.proof, metadata, file: mapBytes }, NOW)).toMatchObject({ status: "created", replayed: true,
      projectId: created.projectId });
    expect((await createMapProjectFromUpload(db, { ...other.proof, metadata, file: mapBytes }, NOW)).status).toBe("conflict");
    expect((await createMapProjectFromUpload(db, { ...owner.proof, metadata: { ...metadata, requestId: randomUUID() },
      file: new TextEncoder().encode("inte en karta") }, NOW)).status).toBe("unsupported-file");
    const projectId = created.projectId;
    const view = await readMapProject(db, { ...owner.proof, projectId }, NOW);
    expect(view.status === "ok" && view.view).toMatchObject({ club: null, role: "OWNER",
      base: { source: "UPLOAD", versionId: null, mapId: null, mapName: "Kungshatt", fileName: "Kungshatt.omap", format: "OMAP", sha256: SHA },
      viewer: { canWriteVersion: true, canArchive: false } });
    expect(await readMapProjectSource(db, { ...owner.proof, projectId }, NOW)).toMatchObject({ status: "ok", fileName: "Kungshatt.omap", sha256: SHA });
    // Ny version: i projektet, aldrig i något arkiv.
    await sync(owner.proof, projectId, [edit(baseKey(POINT_REF), moved(5), null)]);
    expect((await writeMapProjectVersion(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), archive: true } },
      NOW)).status).toBe("forbidden");
    const written = await writeMapProjectVersion(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID() } }, NOW);
    if (written.status !== "ok" || written.response.status !== "created") throw new Error("ingen version");
    expect(written.response).toMatchObject({ versionId: null, fileName: "Kungshatt reviderad 2026-11-07.omap", changes: 1 });
    const output = await readMapProjectOutput(db, { ...owner.proof, projectId, outputId: written.response.outputId }, NOW);
    if (output.status !== "ok") throw new Error(output.status);
    const reread = readMapFile(new Uint8Array((await readMapContent(db, output.sha256))!), output.fileName);
    expect(reread.objects).toHaveLength(parsed.objects.length);
    expect((await readMapProjectOutput(db, { ...other.proof, projectId, outputId: written.response.outputId }, NOW)).status).toBe("not-found");
    // Underhållet tar varken grundfilen eller resultatet.
    await db.transaction(tx => sweepMapContent(tx, new Date(NOW.getTime() + 2 * 3600_000)));
    expect(await readMapContent(db, output.sha256)).toBeDefined();
    // Med en annan medlem kan den ensamma ägaren inte ta bort sitt konto; utan andra tas projektet bort med kontot.
    expect((await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: other.email,
      role: "EDIT" } }, NOW)).status).toBe("invited");
    expect((await readMapProject(db, { ...other.proof, projectId }, NOW)).status).toBe("ok");
    expect(await db.transaction(tx => soleOwnerships(tx, owner.accountId))).toEqual([{ kind: "MAP_PROJECT", id: projectId, name: "Kungshatt" }]);
    expect((await removeMapProjectMember(db, { ...other.proof, projectId, request: { formatVersion: 1, accountId: other.accountId, invitationId: null } },
      NOW)).status).toBe("removed");
    expect(await db.transaction(tx => soleOwnerships(tx, owner.accountId))).toEqual([]);
    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, owner.accountId, NOW));
    const [gone] = await db.select().from(schema.mapProjects).where(eq(schema.mapProjects.id, projectId));
    expect(gone).toBeUndefined();
  });

  it("K7: en ny version av en OCAD-karta skrivs bara med flaggan OTID_OCAD_WRITE", async () => {
    const ocd = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.ocd", import.meta.url)));
    const ocdSha = sha256Hex(ocd);
    const ocdMap = readMapFile(ocd, "Ocad.ocd", { sources: true });
    const owner = await registerTestAccount(db, undefined, NOW);
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Ocad",
      fileName: "Ocad.ocd" }, file: ocd }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const projectId = created.projectId;
    const point = ocdMap.objects.find(object => object.kind === "point") as Extract<MapObject, { kind: "point" }>;
    const ref = objectRefFor(ocdSha, point)!;
    await sync(owner.proof, projectId, [{ editId: randomUUID(), key: baseKey(ref), ref, base: null, kind: "MOVE", at: NOW.toISOString(),
      state: { kind: "OBJECT", object: { ...point, at: { x: point.at.x + 2, y: point.at.y } } } }]);
    const write = () => writeMapProjectVersion(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID() } }, NOW);
    const refused = await write();
    expect(refused.status === "ok" && refused.response).toMatchObject({ status: "refused", refusals: [{ code: "UNSUPPORTED_VERSION" }] });
    process.env.OTID_OCAD_WRITE = "1";
    try {
      const written = await write();
      if (written.status !== "ok" || written.response.status !== "created") throw new Error(JSON.stringify(written));
      expect(written.response).toMatchObject({ fileName: "Ocad reviderad 2026-11-07.ocd", changes: 1 });
      const output = await readMapProjectOutput(db, { ...owner.proof, projectId, outputId: written.response.outputId }, NOW);
      if (output.status !== "ok") throw new Error(output.status);
      const reread = readMapFile(new Uint8Array((await readMapContent(db, output.sha256))!), output.fileName);
      expect(reread.objects).toHaveLength(ocdMap.objects.length);
      expect(reread.objects.some(object => object.kind === "point" && Math.abs(object.at.x - point.at.x - 2) < 0.006)).toBe(true);
    } finally { delete process.env.OTID_OCAD_WRITE; }
  });
});
