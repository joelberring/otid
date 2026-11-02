import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { PublicStartListResponse } from "@o-tid/contracts";
import { createOrganizerEvent } from "../../src/organizer-events";
import { loginUserAccount, registerUserAccount } from "../../src/user-account";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { setCoursesPublicAsAdmin } from "../../src/course-secrecy";
import { raceHasStarted, setPublicTimingAsAdmin } from "../../src/public-before-start";
import { decideStartListPublicationAsAdmin, getPublicStartList, getPublishedStartListXml, getStartListPublicationPreviewAsAdmin } from "../../src/start-list-publication";
import { readPublicRaceMapImage } from "../../src/race-map";
import { listRacePeopleAsAdmin } from "../../src/race-people";
import { requireRaceRole } from "../../src/race-session";
import { requireCourseSettingAccess } from "../../src/course-setting-access";
import { markEmailVerifiedByCommand, registerUserAccountWithVerification, verifyEmailAndLogIn } from "../../src/email-verification";
import { completePasswordReset, createPasswordResetToken } from "../../src/password-reset";
import { accountOnRace, grantRacePerson } from "./accounts";
import { grantRacePersonAsAdmin } from "../../src/race-people";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0186-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0186_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixture = (name: string) => readFileSync(new URL(`../../../../fixtures/iof/${name}`, import.meta.url));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0186_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
const PASSWORD = "hemligt-lösen";
const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Ett nytt konto (obekräftat, som alla nya utan e-post) som skapar en egen tävling: ägaren behöver ingen bekräftelse. */
async function race(): Promise<Proof & { owner: Omit<Proof, "raceId"> }> {
  const account = await registerUserAccount(db, { formatVersion: 1, email: `agare.${randomUUID().slice(0, 8)}@test.o-tid.se`, displayName: "Ägare",
    password: PASSWORD });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const owner = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...owner, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Stockholm by Night", raceName: "Natt", raceDate: dayOffset(0), timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...owner, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error(`Ägaren kom inte in: ${entered.status}`);
  return { raceId: created.response.raceId, ...owner, owner };
}

async function importFile(proof: Proof, name: string) {
  const result = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: fixture(name) });
  if (result.status !== "stored") throw new Error(`Importen misslyckades: ${result.status}`);
}

async function forkedRace() {
  const proof = await race();
  await importFile(proof, "course-data-forked.xml");
  await importFile(proof, "entry-list-forked.xml");
  await importFile(proof, "course-assignment-forked.xml");
  const forked = (await pool.query<{ given_name: string; course_variant_code: string }>(
    "select given_name, course_variant_code from entry where race_id = $1 and course_variant_code is not null order by given_name", [proof.raceId])).rows;
  expect(forked.length).toBeGreaterThan(1);
  return { proof, forked };
}

const entriesOf = (response: PublicStartListResponse) =>
  Object.fromEntries(response.content.classes.flatMap(row => row.entries).map(entry => [entry.displayName.split(" ")[0]!, entry.courseVariantCode]));

async function timing(proof: Proof, change: { variant?: "AFTER_START" | "ALWAYS"; map?: "AFTER_START" | "ON_PUBLISH" }) {
  const saved = await setPublicTimingAsAdmin(db, { ...proof, request: { formatVersion: 1, ...change } });
  if (saved.status !== "saved") throw new Error(`Valet sparades inte: ${saved.status}`);
  return saved.response.publicTiming;
}

describe("ADR-0186: varianten publikt först efter start", () => {
  it("döljer varianten i den publika startlistan, dess IOF XML och API:t tills löparen har startat eller banorna är publika", async () => {
    const { proof, forked } = await forkedRace();
    const now = new Date();
    const [started, ...waiting] = forked;
    await pool.query("update class set start_rule = 'FIXED' where race_id = $1", [proof.raceId]);
    await pool.query("update entry set fixed_start_time = $2 where race_id = $1", [proof.raceId, new Date(now.getTime() + 3_600_000)]);
    await pool.query("update entry set fixed_start_time = $3 where race_id = $1 and given_name = $2",
      [proof.raceId, started!.given_name, new Date(now.getTime() - 60_000)]);

    // Löpande startlista: bara den som har startat har sin variant.
    await pool.query("update race set start_list_live = true where id = $1", [proof.raceId]);
    const live = await getPublicStartList(db, proof.raceId, now);
    if (live.status !== "published") throw new Error("Ingen löpande startlista");
    expect(live.response.variantsHiddenUntilStart).toBe(true);
    expect(entriesOf(live.response)[started!.given_name]).toBe(started!.course_variant_code);
    for (const row of waiting) expect(entriesOf(live.response)[row.given_name]).toBeUndefined();
    expect(JSON.stringify(live.response)).not.toContain(`"courseVariantCode":"${waiting[0]!.course_variant_code}"`);

    // Publicerad startlista: samma i JSON, och startlistans IOF XML (som namnger varianten) ges inte ut så länge någon är dold.
    await pool.query("update race set start_list_live = false where id = $1", [proof.raceId]);
    const preview = await getStartListPublicationPreviewAsAdmin(db, proof, now);
    if (preview.status !== "ok" || !preview.response.sourceHash) throw new Error("Ingen förhandsvisning");
    // Arrangören ser alltid varianterna.
    expect(JSON.stringify(preview.response.content)).toContain(`"courseVariantCode":"${waiting[0]!.course_variant_code}"`);
    const decided = await decideStartListPublicationAsAdmin(db, { ...proof, idempotencyKey: `start-list-publication:${randomUUID()}`,
      request: { formatVersion: 1, action: "PUBLISH", expectedRevision: 0, expectedSourceHash: preview.response.sourceHash } }, now);
    expect(decided.status).toBe("decided");
    const published = await getPublicStartList(db, proof.raceId, now);
    if (published.status !== "published") throw new Error("Ingen publicerad startlista");
    expect(published.response).toMatchObject({ live: false, variantsHiddenUntilStart: true, iofExportAvailable: false });
    for (const row of waiting) expect(entriesOf(published.response)[row.given_name]).toBeUndefined();
    expect(await getPublishedStartListXml(db, proof.raceId, now)).toEqual({ status: "unavailable" });

    // När alla har startat syns allt, också XML:en.
    const later = new Date(now.getTime() + 2 * 3_600_000);
    const all = await getPublicStartList(db, proof.raceId, later);
    if (all.status !== "published") throw new Error("Ingen startlista");
    expect(all.response.variantsHiddenUntilStart).toBe(false);
    for (const row of forked) expect(entriesOf(all.response)[row.given_name]).toBe(row.course_variant_code);
    const xml = await getPublishedStartListXml(db, proof.raceId, later);
    expect(xml.status).toBe("exported");
    expect(xml.status === "exported" && xml.xml).toContain(`-${waiting[0]!.course_variant_code}`);

    // Banorna publika (arrangörens val) eller valet "Direkt": varianten syns före start.
    expect(await setCoursesPublicAsAdmin(db, { ...proof, reveal: true })).toMatchObject({ status: "saved",
      response: { courseSecrecy: { publicTiming: { variant: "AFTER_START", map: "AFTER_START" } } } });
    const revealed = await getPublicStartList(db, proof.raceId, now);
    expect(revealed.status === "published" && revealed.response.variantsHiddenUntilStart).toBe(false);
    expect(await setCoursesPublicAsAdmin(db, { ...proof, reveal: false })).toMatchObject({ status: "saved" });
    expect(await timing(proof, { variant: "ALWAYS" })).toEqual({ variant: "ALWAYS", map: "AFTER_START" });
    const always = await getPublicStartList(db, proof.raceId, now);
    if (always.status !== "published") throw new Error("Ingen startlista");
    for (const row of forked) expect(entriesOf(always.response)[row.given_name]).toBe(row.course_variant_code);
    expect((await getPublishedStartListXml(db, proof.raceId, now)).status).toBe("exported");

    // Valet loggas (en gång; samma val igen ändrar inget) och bara admin får ändra det.
    expect(await timing(proof, { variant: "ALWAYS" })).toEqual({ variant: "ALWAYS", map: "AFTER_START" });
    const audits = (await pool.query<{ before: unknown; after: unknown }>(
      "select before, after from audit_event where race_id = $1 and action = 'PUBLIC_TIMING_SAVED_BY_ADMIN'", [proof.raceId])).rows;
    expect(audits).toEqual([{ before: { variant: "AFTER_START", map: "AFTER_START" }, after: { variant: "ALWAYS", map: "AFTER_START" } }]);
    const helper = await registerUserAccount(db, { formatVersion: 1, email: `funk.${randomUUID().slice(0, 8)}@test.o-tid.se`, displayName: "Funk",
      password: PASSWORD });
    if (helper.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
    await markEmailVerifiedByCommand(db, helper.response.email);
    expect((await grantRacePerson(db, proof.owner, proof.raceId, helper.response.email, "FUNCTIONARY")).status).toBe("granted");
    const functionary = { raceId: proof.raceId, sessionToken: helper.sessionToken, csrfCookie: helper.csrfToken, csrfHeader: helper.csrfToken };
    expect(await setPublicTimingAsAdmin(db, { ...functionary, request: { formatVersion: 1, variant: "AFTER_START" } })).toEqual({ status: "forbidden" });
    expect(await setPublicTimingAsAdmin(db, { ...proof, request: { formatVersion: 1 } })).toEqual({ status: "invalid-request" });
  });

  it("ger bricknumren av som förval för nya tävlingar men ändrar inte befintliga", async () => {
    const proof = await race();
    const row = (await pool.query<{ public_start_list_card_numbers: boolean }>("select public_start_list_card_numbers from race where id = $1",
      [proof.raceId])).rows[0];
    expect(row?.public_start_list_card_numbers).toBe(false);
    const column = (await pool.query<{ column_default: string }>(
      "select column_default from information_schema.columns where table_name = 'race' and column_name = 'public_start_list_card_numbers'")).rows[0];
    expect(column?.column_default).toBe("false");
  });
});

describe("ADR-0186: kartbilden publikt efter start", () => {
  it("lämnar inte ut kartan före start om inte arrangören valt Direkt; efter start, med publika banor eller valet syns den", async () => {
    const proof = await race();
    const image = Buffer.from("inte en riktig bild men bytes");
    await pool.query(`insert into race_map (race_id, file_name, media_type, image, sha256, byte_length, width, height, tie_points, transform,
      uploaded_at, georeferenced_at) values ($1, 'karta.png', 'image/png', $2, $3, $4, 100, 80, '[]', '{}', now(), now())`,
    [proof.raceId, image, "a".repeat(64), image.byteLength]);
    // Publicerad tävling i morgon utan starttider: kartan är hemlig.
    await pool.query("update race set race_date = $2, first_start_time = '18:00', published_at = now() where id = $1", [proof.raceId, dayOffset(1)]);
    expect(await db.transaction(tx => raceHasStarted(tx, proof.raceId, new Date()))).toBe(false);
    expect(await readPublicRaceMapImage(db, proof.raceId)).toBeUndefined();

    // Första start (Inställningar) har passerat: tävlingen har startat.
    await pool.query("update race set race_date = $2 where id = $1", [proof.raceId, dayOffset(-1)]);
    expect(await readPublicRaceMapImage(db, proof.raceId)).toMatchObject({ mediaType: "image/png" });

    // Utan första start: den första fasta starttiden avgör.
    await pool.query("update race set race_date = $2, first_start_time = null where id = $1", [proof.raceId, dayOffset(1)]);
    expect(await readPublicRaceMapImage(db, proof.raceId)).toBeUndefined();

    // Valet "Direkt när tävlingen publiceras".
    expect(await timing(proof, { map: "ON_PUBLISH" })).toEqual({ variant: "AFTER_START", map: "ON_PUBLISH" });
    expect(await readPublicRaceMapImage(db, proof.raceId)).toBeDefined();
    expect(await timing(proof, { map: "AFTER_START" })).toEqual({ variant: "AFTER_START", map: "AFTER_START" });
    expect(await readPublicRaceMapImage(db, proof.raceId)).toBeUndefined();

    // Banorna publika (arrangörens val): kartan med.
    expect(await setCoursesPublicAsAdmin(db, { ...proof, reveal: true })).toMatchObject({ status: "saved" });
    expect(await readPublicRaceMapImage(db, proof.raceId)).toBeDefined();
  });
});

describe("ADR-0186: behörigheter kräver bekräftad e-post", () => {
  it("ger en behörighet från någon annan verkan först när adressen är bekräftad", async () => {
    const proof = await race();
    const target = await registerUserAccount(db, { formatVersion: 1, email: `ny.${randomUUID().slice(0, 8)}@test.o-tid.se`, displayName: "Ny",
      password: PASSWORD });
    if (target.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
    const email = target.response.email;
    const targetProof = { raceId: proof.raceId, sessionToken: target.sessionToken, csrfCookie: target.csrfToken, csrfHeader: target.csrfToken };
    expect(target.response.emailVerified).toBe(false);
    expect((await grantRacePerson(db, proof.owner, proof.raceId, email, "FUNCTIONARY")).status).toBe("granted");
    const requestId = randomUUID();
    expect((await grantRacePersonAsAdmin(db, { ...proof, idempotencyKey: `race-person-grant:${requestId}`,
      readBody: async () => ({ formatVersion: 1, requestId, email, role: "COURSE_EDIT" }) })).status).toBe("granted");

    // Inte bekräftad: varken administratör eller banläggare, och listan säger att behörigheten väntar.
    expect(await requireRaceRole(db, { ...targetProof, role: "FUNCTIONARY" })).toEqual({ status: "unauthorized" });
    expect(await requireCourseSettingAccess(db, { ...targetProof, required: "COMMENT" })).toEqual({ status: "unauthorized" });
    const people = await listRacePeopleAsAdmin(db, proof);
    if (people.status !== "ok") throw new Error("Listan kunde inte läsas");
    // ADR-0188 beslut 6: behörigheterna väntar för adressen tills kontot har bekräftat den.
    expect(people.response.people.filter(person => person.email === email)).toEqual([]);
    expect(people.response.invitations.filter(row => row.email === email).map(row => row.role)).toEqual(["FUNCTIONARY", "COURSE_EDIT"]);
    expect(people.response.people.find(person => person.role === "OWNER")?.pendingVerification).toBeUndefined();

    // Bekräftad (här med serverkommandot): behörigheterna gäller direkt, i samma session.
    expect(await markEmailVerifiedByCommand(db, email.toUpperCase())).toEqual({ status: "verified" });
    expect(await markEmailVerifiedByCommand(db, email)).toEqual({ status: "unchanged" });
    expect(await requireRaceRole(db, { ...targetProof, role: "FUNCTIONARY" })).toMatchObject({ status: "authenticated", principal: { role: "FUNCTIONARY" } });
    expect(await requireCourseSettingAccess(db, { ...targetProof, required: "EDIT" })).toMatchObject({ status: "authenticated" });
  }, 30_000);

  it("registrering med bekräftelse: samma utfall för ny och befintlig adress, länken kräver registreringens lösenord", async () => {
    const email = `bekrafta.${randomUUID().slice(0, 8)}@test.o-tid.se`;
    const first = await registerUserAccountWithVerification(db, { formatVersion: 1, email, displayName: "Bekräfta", password: PASSWORD });
    expect(first).toMatchObject({ status: "accepted", delivery: { kind: "VERIFY", email } });
    // Inte inloggad före bekräftelsen (med e-post på servern); ett nytt mejl skickas i stället.
    const blocked = await loginUserAccount(db, { formatVersion: 1, email, password: PASSWORD }, { requireVerifiedEmail: true });
    expect(blocked).toMatchObject({ status: "unauthorized", verification: { kind: "VERIFY", email } });
    const wrong = await loginUserAccount(db, { formatVersion: 1, email, password: "fel-lösenord" }, { requireVerifiedEmail: true });
    expect(wrong).toEqual({ status: "unauthorized" });

    // Någon annan registrerar samma adress med ett annat lösenord: en ny länk till adressen, men den kräver det andra lösenordet.
    const second = await registerUserAccountWithVerification(db, { formatVersion: 1, email, displayName: "Någon annan", password: "annat-lösen-9" });
    if (second.delivery?.kind !== "VERIFY" || first.delivery?.kind !== "VERIFY") throw new Error("Länken saknas");
    expect(await verifyEmailAndLogIn(db, { formatVersion: 1, token: second.delivery.token, password: PASSWORD })).toEqual({ status: "invalid-token" });
    const verified = await verifyEmailAndLogIn(db, { formatVersion: 1, token: first.delivery.token, password: PASSWORD });
    expect(verified).toMatchObject({ status: "authenticated", response: { email, emailVerified: true, displayName: "Bekräfta" } });
    // Alla länkar är förbrukade; den andras lösenord gäller aldrig.
    expect(await verifyEmailAndLogIn(db, { formatVersion: 1, token: second.delivery.token, password: "annat-lösen-9" })).toEqual({ status: "invalid-token" });
    expect((await loginUserAccount(db, { formatVersion: 1, email, password: "annat-lösen-9" })).status).toBe("unauthorized");
    expect((await loginUserAccount(db, { formatVersion: 1, email, password: PASSWORD }, { requireVerifiedEmail: true })).status).toBe("authenticated");

    // Tre mejl till adressen den här timmen (två länkar och inloggningens): nästa registrering ger samma svar men inget mejl.
    expect(await registerUserAccountWithVerification(db, { formatVersion: 1, email, displayName: "X", password: PASSWORD })).toEqual({ status: "accepted" });

    // En bekräftad adress: samma utfall, och mejlet säger att kontot redan finns.
    const existing = await registerUserAccount(db, { formatVersion: 1, email: `finns.${randomUUID().slice(0, 8)}@test.o-tid.se`, displayName: "Finns",
      password: PASSWORD });
    if (existing.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
    await markEmailVerifiedByCommand(db, existing.response.email);
    expect(await registerUserAccountWithVerification(db, { formatVersion: 1, email: existing.response.email, displayName: "X", password: "annat-lösen-9" }))
      .toEqual({ status: "accepted", delivery: { kind: "ALREADY_REGISTERED", email: existing.response.email, displayName: "Finns" } });
    expect((await loginUserAccount(db, { formatVersion: 1, email: existing.response.email, password: "annat-lösen-9" })).status).toBe("unauthorized");
    expect(await registerUserAccountWithVerification(db, { formatVersion: 1, email: "inte-en-adress", displayName: "X", password: PASSWORD }))
      .toEqual({ status: "invalid-request" });
  }, 60_000);

  it("ett nytt lösenord via återställningslänken bekräftar adressen", async () => {
    const account = await registerUserAccount(db, { formatVersion: 1, email: `glomt.${randomUUID().slice(0, 8)}@test.o-tid.se`, displayName: "Glömsk",
      password: PASSWORD });
    if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
    expect(account.response.emailVerified).toBe(false);
    const { token } = await db.transaction(tx => createPasswordResetToken(tx, { accountId: account.response.accountId, bySuperadmin: false }, new Date()));
    expect(await completePasswordReset(db, { formatVersion: 1, token, password: "nytt-lösen-2" })).toEqual({ status: "reset" });
    const login = await loginUserAccount(db, { formatVersion: 1, email: account.response.email, password: "nytt-lösen-2" }, { requireVerifiedEmail: true });
    expect(login).toMatchObject({ status: "authenticated", response: { emailVerified: true } });
  }, 30_000);
});
