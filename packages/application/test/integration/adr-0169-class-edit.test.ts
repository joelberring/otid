import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator } from "../../src/readout-station";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { listCoursesForEditAsAdministrator } from "../../src/course-edit";
import { editClassAsAdministrator, previewClassEditAsAdministrator } from "../../src/class-edit";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0169-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0169_class_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0169_class_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type Race = { proof: Proof; raceId: string; classId: string; longId: string; shortId: string };

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function classRow(classId: string) {
  return (await pool.query<{ name: string; start_rule: string; course_id: string }>(`select c.name, c.start_rule, cv.course_id
    from class c join course_version cv on cv.id = c.course_version_id where c.id = $1`, [classId])).rows[0]!;
}

async function courseClass(proof: Proof, courseName: string, className: string, controlCodes: number[]) {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), courseName, className,
      startRule: "PUNCH", controlCodes } });
  if (created.status !== "created") throw new Error(`Banan kunde inte skapas: ${created.status}`);
  return created.response;
}

async function race(): Promise<Race> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, loginName: `klass.${suffix}`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const long = await courseClass(proof, "Lång", "H21", [31, 32, 33]);
  const short = await courseClass(proof, "Kort", "D21", [31, 33]);
  return { proof, raceId, classId: long.classId, longId: long.courseId, shortId: short.courseId };
}

async function register(f: Race, givenName: string, cardNumber: string): Promise<string> {
  const { course_version_id: courseVersionId } = (await pool.query<{ course_version_id: string }>(
    "select course_version_id from class where id = $1", [f.classId])).rows[0]!;
  const registered = await registerEntryAsAdmin(db, { ...f.proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: f.classId, expectedCourseVersionId: courseVersionId, expectedStartRule: "PUNCH",
    expectedSnapshotVersion: await snapshot(f.raceId), givenName, familyName: "Löpare", organisationName: null,
    cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  return registered.response.entryId;
}

async function readout(f: Race, cardNumber: string, codes: number[]) {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: "2026-10-08T16:00:00.000Z", finishPunchedAt: "2026-10-08T16:30:00.000Z",
    punches: codes.map((code, index) => ({ code, punchedAt: `2026-10-08T16:${String(5 + index * 5).padStart(2, "0")}:00.000Z` })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(f.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T16:31:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...f.proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

async function effective(f: Race, entryId: string) {
  const result = await getAdministratorEffectiveResult(db, { ...f.proof, entryId });
  if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Gällande resultat saknas");
  return { status: result.response.result.status, current: result.response.resultCurrent };
}

async function edit(f: Race, change: { className?: string; courseId?: string; startRule?: "PUNCH" | "FIXED" },
  confirmResultChanges: boolean, expectedSnapshotVersion?: number) {
  const current = await classRow(f.classId);
  const requestId = randomUUID();
  const request = { formatVersion: 1, requestId, expectedSnapshotVersion: expectedSnapshotVersion ?? await snapshot(f.raceId),
    classId: f.classId, className: change.className ?? current.name, courseId: change.courseId ?? current.course_id,
    startRule: change.startRule ?? current.start_rule, confirmResultChanges };
  return { request, result: await editClassAsAdministrator(db, { ...f.proof, idempotencyKey: `class-edit:${requestId}`, request }) };
}

async function preview(f: Race, courseId: string, startRule: "PUNCH" | "FIXED") {
  const previewed = await previewClassEditAsAdministrator(db, { ...f.proof, classId: f.classId,
    request: { formatVersion: 1, expectedSnapshotVersion: await snapshot(f.raceId), courseId, startRule } });
  if (previewed.status !== "ok") throw new Error(`Beskedet saknas: ${previewed.status}`);
  return previewed.response;
}

const revisions = async (entryId: string) => (await pool.query<{ revision: number; status: string; cause: string }>(
  "select revision, status, cause from result_revision where entry_id = $1 order by revision", [entryId])).rows;

describe("ADR-0169 Redigera klass", () => {
  it("byter bana efter avläsning: besked, bekräftelse och omräkning i samma transaktion", async () => {
    const f = await race();
    const ada = await register(f, "Ada", "8101");
    const bo = await register(f, "Bo", "8102");
    await readout(f, "8101", [31, 32, 33]);
    await readout(f, "8102", [31, 33]);
    expect(await effective(f, bo)).toEqual({ status: "MP", current: true });

    const listed = await listCoursesForEditAsAdministrator(db, f.proof);
    if (listed.status !== "ok") throw new Error("Banlistan saknas");
    expect(listed.response.classes).toHaveLength(2);
    expect(listed.response.classes).toMatchObject([
      { name: "D21", courseId: f.shortId, startRule: "PUNCH", entryCount: 0, readOutCount: 0,
        resultCount: 0, missingStartTimeCount: 0, renamable: true },
      { classId: f.classId, name: "H21", courseId: f.longId, startRule: "PUNCH", entryCount: 2, readOutCount: 2,
        resultCount: 2, missingStartTimeCount: 0, renamable: true }]);

    expect(await preview(f, f.shortId, "PUNCH")).toMatchObject({ className: "H21", courseName: "Kort", readOutCount: 2,
      becomesOkCount: 1, becomesMispunchedCount: 0, unchangedCount: 1, requiresConfirmation: true, clearedStartTimeCount: 0,
      changes: [{ entryId: bo, displayName: "Bo Löpare", className: "H21", before: "MP", after: "OK" }] });
    expect((await edit(f, { courseId: f.shortId }, false)).result.status).toBe("confirmation-required");
    const before = await snapshot(f.raceId);
    const saved = await edit(f, { courseId: f.shortId }, true);
    if (saved.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(saved.result.response.recalculated.map(item => item.entryId).sort()).toEqual([ada, bo].sort());
    expect(await snapshot(f.raceId)).toBe(before + 1);
    expect((await classRow(f.classId)).course_id).toBe(f.shortId);
    expect(await effective(f, bo)).toEqual({ status: "OK", current: true });
    expect(await effective(f, ada)).toEqual({ status: "OK", current: true });
    expect(await revisions(bo)).toEqual([{ revision: 1, status: "MP", cause: "CARD_READOUT" },
      { revision: 2, status: "OK", cause: "EXPLICIT_RECALCULATION" }]);

    const replay = await editClassAsAdministrator(db, { ...f.proof, idempotencyKey: `class-edit:${saved.request.requestId}`, request: saved.request });
    expect(replay).toEqual({ status: "edited", response: { ...saved.result.response, replayed: true } });
    expect(await revisions(bo)).toHaveLength(2);
  });

  it("byter namn direkt utan omräkning, och avvisar en ändring som inte ändrar något", async () => {
    const f = await race();
    const ada = await register(f, "Ada", "8201");
    await readout(f, "8201", [31, 32, 33]);
    const saved = await edit(f, { className: "Herrar 21" }, false);
    if (saved.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(saved.result.response).toMatchObject({ previousClassName: "H21", recalculated: [] });
    expect((await classRow(f.classId)).name).toBe("Herrar 21");
    expect(await effective(f, ada)).toEqual({ status: "OK", current: true });
    expect((await edit(f, {}, false)).result.status).toBe("invalid-request");
  });

  it("byte av startsätt räknar om och resultatet förblir aktuellt", async () => {
    const f = await race();
    const ada = await register(f, "Ada", "8301");
    await readout(f, "8301", [31, 32, 33]);
    // Fast starttid utan tilldelade tider: Ada saknar starttid och blir felstämplad. Det kräver bekräftelse.
    expect(await preview(f, f.longId, "FIXED")).toMatchObject({ readOutCount: 1, becomesMispunchedCount: 1, requiresConfirmation: true });
    const toFixed = await edit(f, { startRule: "FIXED" }, true);
    if (toFixed.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${toFixed.result.status}`);
    expect(await effective(f, ada)).toEqual({ status: "MP", current: true });
    const toPunch = await edit(f, { startRule: "PUNCH" }, true);
    if (toPunch.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${toPunch.result.status}`);
    expect(await effective(f, ada)).toEqual({ status: "OK", current: true });
    expect((await classRow(f.classId)).start_rule).toBe("PUNCH");
  });

  it("avvisar en ändring mot en äldre tävlingsversion", async () => {
    const f = await race();
    const stale = await snapshot(f.raceId);
    await register(f, "Ada", "8401");
    expect((await previewClassEditAsAdministrator(db, { ...f.proof, classId: f.classId,
      request: { formatVersion: 1, expectedSnapshotVersion: stale, courseId: f.shortId, startRule: "PUNCH" } })).status).toBe("conflict");
    expect((await edit(f, { courseId: f.shortId }, true, stale)).result.status).toBe("conflict");
    expect((await classRow(f.classId)).course_id).toBe(f.longId);
  });
});
