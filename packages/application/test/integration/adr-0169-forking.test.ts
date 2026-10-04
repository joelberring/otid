import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { raceSnapshotSchema, type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator, readReadoutPackageAsAdministrator } from "../../src/readout-station";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { listCoursesForEditAsAdministrator, previewCourseEditAsAdministrator, editCourseAsAdministrator } from "../../src/course-edit";
import {
  changeEntryVariantAsAdministrator, distributeClassVariantsAsAdministrator, previewEntryVariantAsAdministrator
} from "../../src/course-variant-assignment";
import { commitStartDrawAsAdministrator } from "../../src/start-draw";
import { publicResults } from "../../src/results";
import { exportIofResultListAsAdmin } from "../../src/result-list-export";
import { listResultFinalizationCandidatesAsAdmin } from "../../src/result-finalization";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0169-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0169_fork_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_adr0169_fork_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

// Fjärilarna i course-data-forked.xml: centrum 50 med slingorna A (41 42) och B (43 44), centrum 60 med C (61 62) och D (63 64).
const loops = { A: [50, 41, 42], B: [50, 43, 44], C: [60, 61, 62], D: [60, 63, 64] } as const;
function variantCodes(code: "AC" | "AD" | "BC" | "BD"): number[] {
  const first = code[0] as "A" | "B", second = code[1] as "C" | "D";
  return [31, ...loops[first], ...loops[first === "A" ? "B" : "A"], 50, 32, ...loops[second], ...loops[second === "C" ? "D" : "C"], 60, 33];
}

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, loginName: `gaffel.${suffix}`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  return { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function importFile(proof: Proof, name: string) {
  const result = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: fixture(name) });
  if (result.status !== "stored") throw new Error(`Importen misslyckades: ${result.status}`);
  return result.response.report;
}

async function entryIds(raceId: string): Promise<Record<string, string>> {
  const rows = (await pool.query<{ id: string; given_name: string }>("select id, given_name from entry where race_id = $1", [raceId])).rows;
  return Object.fromEntries(rows.map(row => [row.given_name, row.id]));
}

async function variants(raceId: string): Promise<Record<string, string | null>> {
  const rows = (await pool.query<{ given_name: string; course_variant_code: string | null }>(
    "select given_name, course_variant_code from entry where race_id = $1", [raceId])).rows;
  return Object.fromEntries(rows.map(row => [row.given_name, row.course_variant_code]));
}

async function readout(proof: Proof, cardNumber: string, codes: readonly number[]) {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: "2026-10-08T16:00:00.000Z", finishPunchedAt: "2026-10-08T17:00:00.000Z",
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(Date.parse("2026-10-08T16:01:00.000Z") + index * 60_000).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(proof.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T17:01:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

async function effective(proof: Proof, entryId: string) {
  const result = await getAdministratorEffectiveResult(db, { ...proof, entryId });
  if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Gällande resultat saknas");
  return { status: result.response.result.status, current: result.response.resultCurrent };
}

const revisions = async (entryId: string) => (await pool.query<{ status: string; cause: string }>(
  "select status, cause from result_revision where entry_id = $1 order by revision", [entryId])).rows;

describe("ADR-0169 gafflingar", () => {
  it("importerar gafflad bana med tilldelningar, bedömer mot löparens variant, byter variant och fördelar resten jämnt", async () => {
    const proof = await race();
    expect(await importFile(proof, "course-data-forked.xml")).toMatchObject({ kind: "CourseData", imported: { courses: 2, classes: 2, variants: 4 } });
    expect(await importFile(proof, "entry-list-forked.xml")).toMatchObject({ kind: "EntryList", imported: { entries: 7 } });
    expect(await importFile(proof, "course-assignment-forked.xml")).toMatchObject({ kind: "CourseData", imported: { courses: 0, personAssignments: 4 } });
    expect(await variants(proof.raceId)).toEqual({ Ada: null, Bo: null, Cia: "AD", Dan: "BC", Eva: "AC", Fia: "BD", Gun: null });
    const ids = await entryIds(proof.raceId);

    // Avläsningspaketet bär varianterna och löparnas koder och följer kontraktet.
    const pkg = await readReadoutPackageAsAdministrator(db, proof);
    if (pkg.status !== "ok") throw new Error("Paketet saknas");
    raceSnapshotSchema.parse(pkg.response.raceSnapshot);
    const forked = pkg.response.raceSnapshot.courses.find(course => course.name === "Lång")!.versions.at(-1)!;
    expect(forked.controls).toEqual([]);
    expect(forked.variants?.map(variant => variant.code)).toEqual(["AC", "AD", "BC", "BD"]);
    expect(pkg.response.raceSnapshot.entries.find(entry => entry.id === ids.Cia)?.courseVariantCode).toBe("AD");

    // Banor: varianter per bana, gafflingskontroll utan varning och klassens saknade varianter.
    const listed = await listCoursesForEditAsAdministrator(db, proof);
    if (listed.status !== "ok") throw new Error("Banlistan saknas");
    const lang = listed.response.courses.find(course => course.name === "Lång")!;
    expect(lang.variants.map(variant => [variant.code, variant.entryCount])).toEqual([["AC", 1], ["AD", 1], ["BC", 1], ["BD", 1]]);
    expect(lang.variants[1]!.controlCodes).toEqual(variantCodes("AD"));
    expect(lang.unevenLegs).toEqual([]);
    expect(listed.response.classes.find(row => row.name === "H21")).toMatchObject({ variantCount: 4, missingVariantCount: 2 });
    expect(listed.response.classes.find(row => row.name === "D21")).toMatchObject({ variantCount: 0, missingVariantCount: 0 });

    // Bedömning mot löparens variant: AD:s kontroller är godkända för Cia (AD) men felstämplade för Eva (AC).
    await readout(proof, "8101003", variantCodes("AD"));
    await readout(proof, "8101005", variantCodes("AD"));
    await readout(proof, "8101006", variantCodes("BD"));
    expect(await effective(proof, ids.Cia!)).toEqual({ status: "OK", current: true });
    expect(await effective(proof, ids.Eva!)).toEqual({ status: "MP", current: true });

    // Underlaget omfattar löparens variant: en ändrad variant gör resultatet inaktuellt.
    await pool.query("update entry set course_variant_code = 'AC' where id = $1", [ids.Fia]);
    expect(await effective(proof, ids.Fia!)).toEqual({ status: "OK", current: false });
    await pool.query("update entry set course_variant_code = 'BD' where id = $1", [ids.Fia]);
    expect(await effective(proof, ids.Fia!)).toEqual({ status: "OK", current: true });

    // Byt Evas variant till AD: besked, bekräftelse och omräkning i samma transaktion.
    const preview = await previewEntryVariantAsAdministrator(db, { ...proof, entryId: ids.Eva!, request: { formatVersion: 1,
      expectedSnapshotVersion: await snapshot(proof.raceId), expectedEntryVersion: 2, variantCode: "AD" } });
    expect(preview).toMatchObject({ status: "ok", response: { currentVariantCode: "AC", variantCode: "AD", readOutCount: 1, becomesOkCount: 1,
      requiresConfirmation: true, changes: [{ displayName: "Eva Sjö", before: "MP", after: "OK" }] } });
    const change = async (confirmResultChanges: boolean) => {
      const requestId = randomUUID();
      return changeEntryVariantAsAdministrator(db, { ...proof, idempotencyKey: `entry-variant:${requestId}`, request: { formatVersion: 1,
        requestId, expectedSnapshotVersion: await snapshot(proof.raceId), expectedEntryVersion: 2, entryId: ids.Eva, variantCode: "AD",
        confirmResultChanges } });
    };
    expect((await change(false)).status).toBe("confirmation-required");
    const changed = await change(true);
    if (changed.status !== "changed") throw new Error(`Bytet sparades inte: ${changed.status}`);
    expect(changed.response).toMatchObject({ previousVariantCode: "AC", entryVersionAfter: 3, recalculated: [{ entryId: ids.Eva }] });
    expect(await effective(proof, ids.Eva!)).toEqual({ status: "OK", current: true });
    expect((await revisions(ids.Eva!)).map(row => row.status)).toEqual(["MP", "OK"]);

    // Bo har läst ut utan variant: bedöms mot varianten som stämplingarna passar (BC).
    await readout(proof, "8101002", variantCodes("BC"));
    expect(await effective(proof, ids.Bo!)).toEqual({ status: "OK", current: true });

    // "Fördela gafflingar": Bo får sin stämplade variant, Ada den minst använda; resultatet ändras inte.
    const requestId = randomUUID();
    const distributed = await distributeClassVariantsAsAdministrator(db, { ...proof, idempotencyKey: `variant-distribution:${requestId}`,
      request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), classId: (await pool.query<{ id: string }>(
        "select id from class where race_id = $1 and name = 'H21'", [proof.raceId])).rows[0]!.id } });
    if (distributed.status !== "distributed") throw new Error(`Fördelningen sparades inte: ${distributed.status}`);
    expect(distributed.response).toMatchObject({ assignedCount: 2, recalculatedCount: 1 });
    const after = await variants(proof.raceId);
    expect(after).toMatchObject({ Bo: "BC", Ada: "AC", Gun: null });
    const counts = ["AC", "AD", "BC", "BD"].map(code => Object.entries(after).filter(([name, value]) => name !== "Gun" && value === code).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(await effective(proof, ids.Bo!)).toEqual({ status: "OK", current: true });

    // Efteranmäld i den gafflade klassen får den minst använda varianten.
    const classRow = (await pool.query<{ id: string; course_version_id: string }>(
      "select id, course_version_id from class where race_id = $1 and name = 'H21'", [proof.raceId])).rows[0]!;
    const late = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
      formatVersion: 1, classId: classRow.id, expectedCourseVersionId: classRow.course_version_id, expectedStartRule: "PUNCH",
      expectedSnapshotVersion: await snapshot(proof.raceId), givenName: "Hugo", familyName: "Sen", organisationName: null,
      cardNumber: "8101009", fixedStartTime: null } });
    expect(late.status).toBe("registered");
    expect((await variants(proof.raceId)).Hugo).toBe("AC");

    // Redigera en variant: beskedet gäller löparna på varianten; banan behåller alla varianter.
    const courseId = lang.courseId;
    const withoutControl = variantCodes("BD").filter(code => code !== 63);
    expect((await previewCourseEditAsAdministrator(db, { ...proof, courseId, request: { formatVersion: 1,
      expectedSnapshotVersion: await snapshot(proof.raceId), controlCodes: withoutControl } })).status).toBe("invalid-request");
    const coursePreview = await previewCourseEditAsAdministrator(db, { ...proof, courseId, request: { formatVersion: 1,
      expectedSnapshotVersion: await snapshot(proof.raceId), controlCodes: withoutControl, variantCode: "BD" } });
    expect(coursePreview).toMatchObject({ status: "ok", response: { variantCode: "BD", currentControlCodes: variantCodes("BD"),
      readOutCount: 1, unchangedCount: 1, requiresConfirmation: false } });
    const editId = randomUUID();
    const edited = await editCourseAsAdministrator(db, { ...proof, idempotencyKey: `course-edit:${editId}`, request: { formatVersion: 1,
      requestId: editId, expectedSnapshotVersion: await snapshot(proof.raceId), courseId, controlCodes: withoutControl, variantCode: "BD",
      confirmResultChanges: false } });
    if (edited.status !== "edited") throw new Error(`Banan sparades inte: ${edited.status}`);
    const relisted = await listCoursesForEditAsAdministrator(db, proof);
    if (relisted.status !== "ok") throw new Error("Banlistan saknas");
    const edLang = relisted.response.courses.find(course => course.name === "Lång")!;
    expect(edLang.variants.map(variant => variant.code)).toEqual(["AC", "AD", "BC", "BD"]);
    expect(edLang.variants[3]!.controlCodes).toEqual(withoutControl);
    // BD saknar nu sträckorna 60–63, 63–64 som de andra varianterna har.
    expect(edLang.unevenLegs.map(leg => `${leg.from}-${leg.to}`)).toEqual(expect.arrayContaining(["60-63", "60-64"]));
    for (const name of ["Cia", "Eva", "Fia", "Bo"]) expect(await effective(proof, ids[name]!)).toMatchObject({ current: true });
    expect(await effective(proof, ids.Fia!)).toEqual({ status: "OK", current: true });

    // Publika resultat visar varianten.
    const published = await publicResults(db, proof.raceId);
    const cia = published.results.find(result => result.givenName === "Cia");
    expect(cia).toMatchObject({ status: "OK", courseVariantCode: "AD" });

    // IOF-export och fastställande använder löparens variants kontroller.
    const exported = await exportIofResultListAsAdmin(db, { raceId: proof.raceId, sessionToken: proof.sessionToken });
    if (exported.status !== "ok") throw new Error(`Exporten misslyckades: ${exported.status}`);
    const xml = new TextDecoder().decode(exported.bytes);
    expect(xml).toContain("<Family>Holm</Family>");
    expect(xml).toContain("<ControlCode>63</ControlCode>");
    await readout(proof, "8101001", variantCodes("AC"));
    await readout(proof, "8101004", variantCodes("BC"));
    await readout(proof, "8101009", variantCodes("AC"));
    const candidates = await listResultFinalizationCandidatesAsAdmin(db, proof);
    if (candidates.status !== "ok") throw new Error("Fastställandet saknas");
    const h21Candidate = candidates.response.classes.find(row => row.className === "H21");
    expect(h21Candidate?.blockerCodes).toEqual([]);
  });

  it("lottningen fördelar varianter jämnt och deterministiskt på löpare utan variant", async () => {
    const proof = await race();
    await importFile(proof, "course-data-forked.xml");
    await importFile(proof, "entry-list-forked.xml");
    const classes = (await pool.query<{ id: string; name: string }>("select id, name from class where race_id = $1", [proof.raceId])).rows;
    const h21 = classes.find(row => row.name === "H21")!.id;
    const requestId = randomUUID();
    const drawn = await commitStartDrawAsAdministrator(db, { ...proof, idempotencyKey: `start-draw:${requestId}`, request: {
      formatVersion: 1, requestId, seed: 12345, expectedSnapshotVersion: await snapshot(proof.raceId),
      firstStartTime: "2026-10-08T16:00:00.000Z", clubSeparation: false, confirmChanges: false,
      classes: [{ classId: h21, method: "MINUTE", intervalMinutes: 2, vacancies: { kind: "COUNT", value: 0 } }] } });
    if (drawn.status !== "drawn") throw new Error(`Lottningen sparades inte: ${drawn.status}`);
    const assigned = await variants(proof.raceId);
    expect(assigned.Gun).toBeNull();
    const h21Codes = Object.entries(assigned).filter(([name]) => name !== "Gun").map(([, code]) => code);
    expect(h21Codes.every(code => code !== null)).toBe(true);
    const counts = ["AC", "AD", "BC", "BD"].map(code => h21Codes.filter(value => value === code).length).sort();
    expect(counts).toEqual([1, 1, 2, 2]);
  });
});
