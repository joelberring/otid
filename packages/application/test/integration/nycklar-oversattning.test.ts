import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { applyEdit, emptyDocument, writePpen, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { applySyncAsAdmin } from "../../src/source-sync";
import { saveCourseSettingEditsAsAdmin } from "../../src/course-setting-collaboration";
import { readForkLetterFactsAsAdmin } from "../../src/course-setting-fork-letters";
import { importCourseSettingAsAdmin, previewCourseSettingTransferAsAdmin, readCourseSettingAsAdmin } from "../../src/course-setting";
import { listEntryRegistrationClassesAsAdmin, registerEntryAsAdmin } from "../../src/entry-registration";
import { changeEntryVariantAsAdmin } from "../../src/course-variant-assignment";
import { accountOnRace } from "./accounts";

/**
 * ADR-0175, tillägg 2026-11-21 (b): löparna har fått varianter, så nycklarna låses. En gren tas bort och «Ordna nycklarna»
 * ger grenen E bokstaven D. Vid nästa «Överför till tävlingen» får löparen med AE koden AD och behåller sina kontroller (står
 * inte i beskedet); bara löparen vars gren togs bort (AD) står där och får en ny variant, fast koden AD finns bland de nya.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_nycklar_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_nycklar_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function race() {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `gren.${suffix}@test.o-tid.se`, displayName: "Banläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Stockholm by Night", raceName: "Natt", raceDate: "2026-12-09",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}
type Proof = Awaited<ReturnType<typeof race>>;

/** Banläggningen: Natt = S 31 [A:41 | B:42] 50 [C:61 | D:63 | E:64] 70 M för klassen "Natt lång". */
function nightDocument() {
  let document: CourseSettingDocument = emptyDocument({ title: "Stockholm by Night", mapScale: 10000 });
  const edit = (value: CourseSettingEdit) => { const result = applyEdit(document, value); document = result.document; return result.created ?? ""; };
  const control = (kind: "START" | "NORMAL" | "FINISH", x: number, y: number, code?: string) =>
    edit({ type: "ADD_CONTROL", kind, at: { x, y }, ...(code ? { code } : {}) });
  const start = control("START", 0, 0), finish = control("FINISH", 200, 0);
  const codes = Object.fromEntries(["31", "41", "42", "50", "61", "63", "64", "70"].map((code, index) => [code, control("NORMAL", 20 + index * 20, index % 2 * 10, code)]));
  const course = edit({ type: "ADD_COURSE", name: "Natt" });
  edit({ type: "UPDATE_COURSE", course, changes: { secondaryTitle: "Natt lång" } });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: start });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: finish });
  const at31 = edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["31"]! });
  const at50 = edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["50"]! });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["70"]! });
  edit({ type: "ADD_SPLIT", course, at: at31, kind: "FORK", branches: 2 });
  const first = document.courseControls[at31]!.split!.branches;
  edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["41"]!, after: first[0]! });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["42"]!, after: first[1]! });
  edit({ type: "ADD_SPLIT", course, at: at50, kind: "FORK", branches: 3 });
  const second = document.courseControls[at50]!.split!.branches;
  for (const [index, code] of ["61", "63", "64"].entries()) edit({ type: "INSERT_COURSE_CONTROL", course, control: codes[code]!, after: second[index]! });
  return { document, course, second };
}

async function save(proof: Proof, document: CourseSettingDocument, expectedVersion: number) {
  const saved = await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion, document,
    fileName: "natt.ppen", ppen: writePpen(document) } });
  expect(saved.status).toBe("ok");
}

async function preview(proof: Proof, version: number) {
  const result = await previewCourseSettingTransferAsAdmin(db, { ...proof, request: { formatVersion: 1, version } });
  if (result.status !== "ok") throw new Error(`Förhandsvisningen saknas: ${result.status}`);
  return result.response;
}

async function apply(proof: Proof, snapshotId: string, confirmResultChanges: boolean) {
  const requestId = randomUUID();
  return applySyncAsAdmin(db, { ...proof, idempotencyKey: `source-sync:${requestId}`, request: { formatVersion: 1, requestId, snapshotId,
    excludedRowIds: [], confirmResultChanges } });
}

const setting = async (raceId: string) => (await pool.query<{ version: number; document: CourseSettingDocument }>(
  "select version, document from course_setting where race_id = $1", [raceId])).rows[0]!;

const raceVariants = async (raceId: string) => (await pool.query<{ code: string }>(`select cv.code from course_variant cv
  join course_version v on v.id = cv.course_version_id join course c on c.id = v.course_id
  where c.race_id = $1 and c.name = 'Natt' and v.version = (select max(version) from course_version where course_id = c.id) order by cv.sequence`,
[raceId])).rows.map(row => row.code);

const entryCodes = async (raceId: string) => Object.fromEntries((await pool.query<{ given_name: string; course_variant_code: string | null }>(
  "select given_name, course_variant_code from entry where race_id = $1", [raceId])).rows.map(row => [row.given_name, row.course_variant_code]));

async function register(proof: Proof, given: string, code: string) {
  const classes = await listEntryRegistrationClassesAsAdmin(db, proof);
  if (classes.status !== "ok") throw new Error("Klasserna saknas");
  const nattLang = classes.response.classes.find(row => row.name === "Natt lång")!;
  const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: { formatVersion: 1,
    classId: nattLang.id, expectedCourseVersionId: nattLang.courseVersionId, expectedStartRule: nattLang.startRule, givenName: given,
    familyName: "Natt", organisationName: "OK Natt", cardNumber: null, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  const current = (await pool.query<{ version: number; course_variant_code: string | null }>("select version, course_variant_code from entry where id = $1",
    [registered.response.entryId])).rows[0]!;
  if (current.course_variant_code === code) return;
  const requestId = randomUUID();
  const changed = await changeEntryVariantAsAdmin(db, { ...proof, idempotencyKey: `entry-variant:${requestId}`, request: { formatVersion: 1,
    requestId, expectedEntryVersion: current.version, entryId: registered.response.entryId, variantCode: code, confirmResultChanges: true } });
  expect(changed.status).toBe("changed");
}

const variantControls = async (raceId: string, code: string) => (await pool.query<{ codes: number[] }>(`select array_agg(ct.code order by cvc.sequence) as codes
  from course_variant cv join course_variant_control cvc on cvc.course_variant_id = cv.id join control ct on ct.id = cvc.control_id
  join course_version v on v.id = cv.course_version_id join course c on c.id = v.course_id
  where c.race_id = $1 and c.name = 'Natt' and cv.code = $2 and v.version = (select max(version) from course_version where course_id = c.id)`,
[raceId, code])).rows[0]?.codes;

describe("nycklarna: lås, «Ordna nycklarna» och översättningen vid Överför (tillägg 2026-11-21 b)", () => {
  it("en löpare vars kod bytts får den nya koden med samma kontroller; bara den vars gren försvann står i beskedet", async () => {
    const proof = await race();
    const { document, course, second } = nightDocument();
    await save(proof, document, 0);
    const first = await preview(proof, 1);
    expect((await apply(proof, first.snapshotId, true)).status).toBe("saved");
    // Överföringen sparade grenarnas bokstäver i banläggningen; banan är fortfarande utkast.
    let current = await setting(proof.raceId);
    const transferred = current.document.courses.find(row => row.id === course)!;
    expect(Object.values(transferred.transferredLetters ?? {}).sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect(transferred.forkLetterLock).toBeUndefined();

    for (const [given, code] of [["Ada", "AC"], ["Bo", "AD"], ["Cia", "AE"]] as const) await register(proof, given, code);
    expect(await entryCodes(proof.raceId)).toMatchObject({ Ada: "AC", Bo: "AD", Cia: "AE" });
    // Varianterna gavs vid anmälan; låset sätts senast när editorn läser dokumentet.
    expect((await readCourseSettingAsAdmin(db, proof)).status).toBe("ok");
    current = await setting(proof.raceId);
    expect(current.document.courses.find(row => row.id === course)!.forkLetterLock?.reason).toBe("ASSIGNED");
    const facts = await readForkLetterFactsAsAdmin(db, proof);
    if (facts.status !== "ok") throw new Error("Det som berörs saknas");
    expect(facts.response.courses).toEqual([{ course, printedMaps: null, startListPublished: false, runnerCount: 3,
      runners: [{ name: "Ada Natt", className: "Natt lång", code: "AC" }, { name: "Bo Natt", className: "Natt lång", code: "AD" },
        { name: "Cia Natt", className: "Natt lång", code: "AE" }] }]);

    // I editorn (servern spelar upp samma ändringar): D (63) tas bort, sedan «Ordna nycklarna»: E (64) blir D.
    const saved = await saveCourseSettingEditsAsAdmin(db, { ...proof, request: { formatVersion: 1, requestId: randomUUID(), baseVersion: current.version,
      edits: [{ type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! }, { type: "RENUMBER_FORK_LETTERS", course }] } });
    if (saved.status !== "ok") throw new Error(`Sparandet misslyckades: ${saved.status}`);
    expect(saved.response.applied).toBe(2);

    const transfer = await preview(proof, saved.response.version);
    expect(transfer.consequence.variantChanges!.map(row => [row.displayName, row.code, row.afterControls, row.reassigned ?? false]))
      .toEqual([["Bo Natt", "AD", null, true]]);
    expect((await apply(proof, transfer.snapshotId, true)).status).toBe("saved");
    expect(await raceVariants(proof.raceId)).toEqual(["AC", "AD", "BC", "BD"]);
    expect(await variantControls(proof.raceId, "AD")).toEqual([31, 41, 50, 64, 70]);
    const after = await entryCodes(proof.raceId);
    expect(after).toMatchObject({ Ada: "AC", Cia: "AD" });
    // Bo hade grenen 63 som inte finns: en ny variant (den minst använda), inte den nya AD.
    expect(["BC", "BD"]).toContain(after.Bo);

    // Bokstäverna efter överföringen är sparade: en ny överföring ändrar ingenting.
    current = await setting(proof.raceId);
    const again = await preview(proof, current.version);
    expect(again.rows).toEqual([]);
  }, 180_000);
});
