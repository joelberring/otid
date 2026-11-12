import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import type { CourseForking } from "@o-tid/domain";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { listCoursesForEditAsAdmin, previewCourseEditAsAdmin, editCourseAsAdmin } from "../../src/course-edit";
import { changeEntryVariantAsAdmin, distributeClassVariantsAsAdmin } from "../../src/course-variant-assignment";
import { accountOnRace } from "./accounts";

/**
 * Användartestet 2026-11-12 (ADR-0175 beslut 3, tillägg 2026-11-12): en rättad kontrollkod i ett gafflingsalternativ ger
 * inte löparna nya varianter. Kartorna är tryckta med koden, så löparna behåller sin kod och avlästa räknas om mot kodens
 * nya kontroller. Bara löpare vars kod försvinner (ett alternativ tas bort) får en ny variant.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_gaffelkod_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixture = (name: string) => readFileSync(new URL(`../../../../fixtures/iof/${name}`, import.meta.url));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_gaffelkod_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `kod.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbtävling", raceName: "Lördag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await accountOnRace(db, { ...accountProof, raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function importFile(proof: Proof, name: string) {
  const result = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: fixture(name) });
  if (result.status !== "stored") throw new Error(`Importen misslyckades: ${result.status}`);
}

const snapshot = async (raceId: string) =>
  (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;

async function entries(raceId: string) {
  return (await pool.query<{ id: string; given_name: string; course_variant_code: string | null; version: number; class_id: string }>(
    "select id, given_name, course_variant_code, version, class_id from entry where race_id = $1 order by given_name", [raceId])).rows;
}

async function variants(raceId: string): Promise<Record<string, string | null>> {
  return Object.fromEntries((await entries(raceId)).map(row => [row.given_name, row.course_variant_code]));
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
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

async function effective(proof: Proof, entryId: string) {
  const result = await getAdministratorEffectiveResult(db, { ...proof, entryId });
  if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Gällande resultat saknas");
  return { status: result.response.result.status, current: result.response.resultCurrent };
}

async function edit(proof: Proof, courseId: string, forking: CourseForking) {
  const requestId = randomUUID();
  const result = await editCourseAsAdmin(db, { ...proof, idempotencyKey: `course-edit:${requestId}`, request: { formatVersion: 1,
    requestId, courseId, forking, confirmResultChanges: true } });
  expect(result.status).toBe("edited");
}

/** Löparen får varianten genom "Byt variant" (som admin gör före tryck). */
async function setVariant(proof: Proof, givenName: string, code: string) {
  const entry = (await entries(proof.raceId)).find(row => row.given_name === givenName)!;
  if (entry.course_variant_code === code) return;
  const requestId = randomUUID();
  const result = await changeEntryVariantAsAdmin(db, { ...proof, idempotencyKey: `entry-variant:${requestId}`, request: { formatVersion: 1,
    requestId, expectedEntryVersion: entry.version, entryId: entry.id, variantCode: code, confirmResultChanges: true } });
  expect(result.status).toBe("changed");
}

const control = (code: number) => ({ kind: "CONTROL" as const, code });
const fork = (...branches: number[][]) => ({ kind: "FORK" as const, branches });
// Banan ur användartestet: 31 40 [A:41 | B:42] 50 60 [C:61 62 | D:63 | E:64] 70 100.
const course = (second: number[][]): CourseForking =>
  ({ items: [control(31), control(40), fork([41], [42]), control(50), control(60), fork(...second), control(70), control(100)] });

describe("gafflad bana: rättad kontrollkod i ett alternativ (användartestet 2026-11-12)", () => {
  it("löparna behåller sin variantkod, avlästa räknas om; bara ett borttaget alternativs löpare får ny variant", async () => {
    const proof = await race();
    await importFile(proof, "course-data-forked.xml");
    await importFile(proof, "entry-list-forked.xml");
    await importFile(proof, "course-assignment-forked.xml");
    const listed = await listCoursesForEditAsAdmin(db, proof);
    if (listed.status !== "ok") throw new Error("Banlistan saknas");
    const courseId = listed.response.courses.find(row => row.name === "Lång")!.courseId;

    // Banan blir först en vanlig bana (som i användartestet), sedan två enkla gafflingar (sex varianter, A–E); alla i H21
    // får en variant och sedan en bestämd variant per löpare.
    await edit(proof, courseId, { items: [31, 40, 41, 50, 60, 61, 62, 70, 100].map(control) });
    await edit(proof, courseId, course([[61, 62], [63], [64]]));
    const h21 = (await entries(proof.raceId)).find(row => row.given_name === "Ada")!.class_id;
    const distributionId = randomUUID();
    expect((await distributeClassVariantsAsAdmin(db, { ...proof, idempotencyKey: `variant-distribution:${distributionId}`,
      request: { formatVersion: 1, requestId: distributionId, classId: h21 } })).status).toBe("distributed");
    const planned = { Ada: "AC", Bo: "AD", Cia: "AE", Dan: "BC", Eva: "BD", Fia: "BE" } as const;
    for (const [name, code] of Object.entries(planned)) await setVariant(proof, name, code);
    expect(await variants(proof.raceId)).toEqual({ ...planned, Gun: null });

    // Cia springer AE (64) och Dan BC; båda godkända.
    const ids = Object.fromEntries((await entries(proof.raceId)).map(row => [row.given_name, row.id]));
    await readout(proof, "8101003", [31, 40, 41, 50, 60, 64, 70, 100]);
    await readout(proof, "8101004", [31, 40, 42, 50, 60, 61, 62, 70, 100]);
    expect(await effective(proof, ids.Cia!)).toMatchObject({ status: "OK" });
    expect(await effective(proof, ids.Dan!)).toMatchObject({ status: "OK" });

    // Kodrättning: E ändras från 64 till 65. Inga varianter försvinner och ingen får ny variant; AE och BE får nya kontroller
    // och Cia, som stämplade 64, blir felstämplad (väntat: det är vad rättningen ger).
    const fixed = course([[61, 62], [63], [65]]);
    const preview = await previewCourseEditAsAdmin(db, { ...proof, courseId, request: { formatVersion: 1, forking: fixed } });
    expect(preview).toMatchObject({ status: "ok", response: { readOutCount: 2, becomesMispunchedCount: 1, unchangedCount: 1,
      requiresConfirmation: true, forking: { removedCodes: [], changedCodes: ["AE", "BE"], renamedEntryCount: 0, reassignedEntryCount: 0 } } });
    if (preview.status !== "ok") throw new Error("Beskedet saknas");
    expect(preview.response.changes.map(row => [row.displayName.includes("Cia"), row.before, row.after])).toEqual([[true, "OK", "MP"]]);
    // Utan bekräftelse sparas inget.
    const unconfirmedId = randomUUID();
    expect((await editCourseAsAdmin(db, { ...proof, idempotencyKey: `course-edit:${unconfirmedId}`, request: { formatVersion: 1,
      requestId: unconfirmedId, courseId, forking: fixed, confirmResultChanges: false } })).status).toBe("confirmation-required");
    await edit(proof, courseId, fixed);
    expect(await variants(proof.raceId)).toEqual({ ...planned, Gun: null });
    expect(await effective(proof, ids.Cia!)).toMatchObject({ status: "MP", current: true });
    expect(await effective(proof, ids.Dan!)).toMatchObject({ status: "OK", current: true });
    const relisted = await listCoursesForEditAsAdmin(db, proof);
    if (relisted.status !== "ok") throw new Error("Banlistan saknas");
    expect(relisted.response.courses.find(row => row.courseId === courseId)!.variants.find(variant => variant.code === "AE")!.controlCodes)
      .toEqual([31, 40, 41, 50, 60, 65, 70, 100]);
    const audit = (await pool.query<{ after: { removedCodes: string[]; changedCodes: string[]; reassignedEntryCount: number } }>(
      "select after from audit_event where entity_id = $1 and action = 'COURSE_EDITED_BY_ADMIN' order by created_at desc limit 1", [courseId])).rows[0]!;
    expect(audit.after).toMatchObject({ removedCodes: [], changedCodes: ["AE", "BE"], reassignedEntryCount: 0 });

    // Alternativ D (63) tas bort (tillägg 2026-11-12 b i ADR-0175): E står kvar som E (A, C, E med lucka), så Cias karta
    // "AE" betyder samma sak. Bara de som hade D (Bo, Eva) får en ny variant och står med namn i beskedet.
    const removed = course([[61, 62], [65]]);
    const removal = await previewCourseEditAsAdmin(db, { ...proof, courseId, request: { formatVersion: 1, forking: removed } });
    expect(removal).toMatchObject({ status: "ok", response: { forking: { removedCodes: ["AD", "BD"], renamedEntryCount: 0, reassignedEntryCount: 2 } } });
    if (removal.status !== "ok") throw new Error("Beskedet saknas");
    expect(removal.response.forking!.changedCodes).toBeUndefined();
    expect(removal.response.forking!.variants.map(variant => variant.code)).toEqual(["AC", "AE", "BC", "BE"]);
    expect(removal.response.forking!.entryChanges!.map(row => [row.displayName.split(" ")[0], row.className, row.before, row.after, row.newControls]))
      .toEqual([["Bo", "H21", "AD", null, true], ["Eva", "H21", "BD", null, true]]);
    const removalId = randomUUID();
    const saved = await editCourseAsAdmin(db, { ...proof, idempotencyKey: `course-edit:${removalId}`, request: { formatVersion: 1,
      requestId: removalId, courseId, forking: removed, confirmResultChanges: true } });
    if (saved.status !== "edited") throw new Error("Ändringen sparades inte");
    const after = await variants(proof.raceId);
    expect(after).toMatchObject({ Ada: "AC", Cia: "AE", Dan: "BC", Fia: "BE", Gun: null });
    expect(["AC", "AE", "BC", "BE"]).toEqual(expect.arrayContaining([after.Bo, after.Eva]));
    // Kvittot och historiken säger vilka som bytte variant, före och efter.
    expect(saved.response.variantChanges!.map(row => [row.displayName.split(" ")[0], row.before, row.after]))
      .toEqual([["Bo", "AD", after.Bo], ["Eva", "BD", after.Eva]]);
    const history = (await pool.query<{ entity_id: string; before: { courseVariantCode: string }; after: { courseVariantCode: string } }>(
      "select entity_id, before, after from audit_event where race_id = $1 and action = 'ENTRY_COURSE_VARIANT_CHANGED_BY_COURSE_EDIT' and request_id = $2",
      [proof.raceId, removalId])).rows;
    expect(history.map(row => [row.entity_id, row.before.courseVariantCode, row.after.courseVariantCode]).sort())
      .toEqual([[ids.Bo, "AD", after.Bo], [ids.Eva, "BD", after.Eva]].sort());
    expect(await effective(proof, ids.Cia!)).toMatchObject({ status: "MP", current: true });
    expect(await effective(proof, ids.Dan!)).toMatchObject({ status: "OK", current: true });

    // Ett nytt alternativ (som editorn skickar det: bokstäverna följer med, det nya utan bokstav) får F, inte D, och
    // ingen byter variant.
    const stored = await listCoursesForEditAsAdmin(db, proof);
    if (stored.status !== "ok") throw new Error("Banlistan saknas");
    const view = stored.response.courses.find(row => row.courseId === courseId)!.forking!;
    expect(view.retiredLetters).toEqual(["D"]);
    const second = view.items[5]!;
    if (second.kind !== "FORK") throw new Error("Gafflingen saknas");
    expect(second.letters).toEqual(["C", "E"]);
    const added = { items: view.items.map((item, index) => index === 5 && item.kind === "FORK"
      ? { ...item, branches: [...item.branches, [66]], letters: [...(item.letters ?? []), null] } : item) };
    const addition = await previewCourseEditAsAdmin(db, { ...proof, courseId, request: { formatVersion: 1, forking: added } });
    if (addition.status !== "ok") throw new Error("Beskedet saknas");
    expect(addition.response.forking!.variants.map(variant => variant.code)).toEqual(["AC", "AE", "AF", "BC", "BE", "BF"]);
    expect(addition.response.forking!.entryChanges).toBeUndefined();
    await edit(proof, courseId, added);
    expect(await variants(proof.raceId)).toEqual(after);
  }, 180_000);
});
