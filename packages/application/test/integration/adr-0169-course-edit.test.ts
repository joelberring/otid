import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { RESULT_DISQUALIFICATION_POLICY_VERSION, type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator } from "../../src/readout-station";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { disqualifyResultAsAdmin } from "../../src/result-disqualification";
import { editCourseAsAdministrator, listCoursesForEditAsAdministrator, previewCourseEditAsAdministrator } from "../../src/course-edit";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0169-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0169_edit_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0169_edit_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type Race = { proof: Proof; raceId: string; classId: string; courseId: string };

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function courseVersionOf(classId: string): Promise<string> {
  return (await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [classId])).rows[0]!.course_version_id;
}

async function race(controlCodes: number[]): Promise<Race> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, loginName: `bana.${suffix}`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const requestId = randomUUID();
  const course = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(raceId), courseName: "Lång",
      className: "H21", startRule: "PUNCH", controlCodes } });
  if (course.status !== "created") throw new Error(`Banan kunde inte skapas: ${course.status}`);
  return { proof, raceId, classId: course.response.classId, courseId: course.response.courseId };
}

async function register(f: Race, givenName: string, cardNumber: string): Promise<string> {
  const registered = await registerEntryAsAdmin(db, { ...f.proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: f.classId, expectedCourseVersionId: await courseVersionOf(f.classId), expectedStartRule: "PUNCH",
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

async function edit(f: Race, controlCodes: number[], confirmResultChanges: boolean, expectedSnapshotVersion?: number) {
  const requestId = randomUUID();
  const request = { formatVersion: 1, requestId, expectedSnapshotVersion: expectedSnapshotVersion ?? await snapshot(f.raceId),
    courseId: f.courseId, controlCodes, confirmResultChanges };
  return { request, result: await editCourseAsAdministrator(db, { ...f.proof, idempotencyKey: `course-edit:${requestId}`, request }) };
}

const revisions = async (entryId: string) => (await pool.query<{ revision: number; status: string; cause: string }>(
  "select revision, status, cause from result_revision where entry_id = $1 order by revision", [entryId])).rows;

describe("ADR-0169 Redigera bana", () => {
  it("stryker en kontroll efter avläsning: besked, bekräftelse och omräkning i samma transaktion", async () => {
    const f = await race([31, 32, 33]);
    const ada = await register(f, "Ada", "7001");
    const bo = await register(f, "Bo", "7002");
    await register(f, "Cecilia", "7003");
    await readout(f, "7001", [31, 32, 33]);
    await readout(f, "7002", [31, 33]);
    expect(await effective(f, bo)).toEqual({ status: "MP", current: true });
    const readoutsBefore = (await pool.query("select * from card_readout where race_id = $1 order by id", [f.raceId])).rows;

    const listed = await listCoursesForEditAsAdministrator(db, f.proof);
    if (listed.status !== "ok") throw new Error("Banlistan saknas");
    expect(listed.response.courses).toEqual([{ courseId: f.courseId, courseVersionId: await courseVersionOf(f.classId), name: "Lång", controlCodes: [31, 32, 33],
      classes: [{ classId: f.classId, name: "H21" }], entryCount: 3, readOutCount: 2 }]);

    const preview = await previewCourseEditAsAdministrator(db, { ...f.proof, courseId: f.courseId,
      request: { formatVersion: 1, expectedSnapshotVersion: await snapshot(f.raceId), controlCodes: [31, 33] } });
    if (preview.status !== "ok") throw new Error(`Beskedet saknas: ${preview.status}`);
    expect(preview.response).toMatchObject({ readOutCount: 2, becomesOkCount: 1, becomesMispunchedCount: 0, unchangedCount: 1,
      notRecalculatedCount: 0, requiresConfirmation: true,
      changes: [{ entryId: bo, displayName: "Bo Löpare", className: "H21", before: "MP", after: "OK" }] });

    const unconfirmed = await edit(f, [31, 33], false);
    expect(unconfirmed.result.status).toBe("confirmation-required");
    const before = await snapshot(f.raceId);
    const previousVersion = await courseVersionOf(f.classId);
    const saved = await edit(f, [31, 33], true);
    if (saved.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(saved.result.response.recalculated.map(item => item.entryId).sort()).toEqual([ada, bo].sort());
    expect(await snapshot(f.raceId)).toBe(before + 1);
    expect(await courseVersionOf(f.classId)).not.toBe(previousVersion);

    expect(await effective(f, ada)).toEqual({ status: "OK", current: true });
    expect(await effective(f, bo)).toEqual({ status: "OK", current: true });
    expect(await revisions(bo)).toEqual([{ revision: 1, status: "MP", cause: "CARD_READOUT" },
      { revision: 2, status: "OK", cause: "EXPLICIT_RECALCULATION" }]);
    expect((await pool.query("select * from card_readout where race_id = $1 order by id", [f.raceId])).rows).toEqual(readoutsBefore);

    // Samma begäran igen ger samma kvitto utan nya revisioner.
    const replay = await editCourseAsAdministrator(db, { ...f.proof, idempotencyKey: `course-edit:${saved.request.requestId}`, request: saved.request });
    expect(replay).toEqual({ status: "edited", response: { ...saved.result.response, replayed: true } });
    expect(await revisions(bo)).toHaveLength(2);
  });

  it("sparar direkt när ingen har läst ut", async () => {
    const f = await race([31, 32, 33]);
    await register(f, "Ada", "7101");
    const preview = await previewCourseEditAsAdministrator(db, { ...f.proof, courseId: f.courseId,
      request: { formatVersion: 1, expectedSnapshotVersion: await snapshot(f.raceId), controlCodes: [33, 32, 31, 34] } });
    if (preview.status !== "ok") throw new Error("Beskedet saknas");
    expect(preview.response).toMatchObject({ readOutCount: 0, requiresConfirmation: false, changes: [] });
    const saved = await edit(f, [33, 32, 31, 34], false);
    if (saved.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(saved.result.response.recalculated).toEqual([]);
    const codes = await pool.query<{ code: number }>(`select ctl.code from course_control cc join control ctl on ctl.id = cc.control_id
      where cc.course_version_id = $1 order by cc.sequence`, [await courseVersionOf(f.classId)]);
    expect(codes.rows.map(row => row.code)).toEqual([33, 32, 31, 34]);
    // Oförändrad kontrollföljd är ingen ändring.
    expect((await edit(f, [33, 32, 31, 34], false)).result.status).toBe("invalid-request");
  });

  it("avvisar en ändring mot en äldre tävlingsversion", async () => {
    const f = await race([31, 32, 33]);
    const stale = await snapshot(f.raceId);
    await register(f, "Ada", "7201");
    expect((await previewCourseEditAsAdministrator(db, { ...f.proof, courseId: f.courseId,
      request: { formatVersion: 1, expectedSnapshotVersion: stale, controlCodes: [31, 33] } })).status).toBe("conflict");
    expect((await edit(f, [31, 33], true, stale)).result.status).toBe("conflict");
    expect((await pool.query("select id from course_version where course_id = $1", [f.courseId])).rowCount).toBe(1);
  });

  it("ett manuellt diskbeslut gäller fortsatt efter ändringen", async () => {
    const f = await race([31, 32, 33]);
    const ada = await register(f, "Ada", "7301");
    await readout(f, "7301", [31, 32, 33]);
    const [source] = (await pool.query<{ id: string; revision: number }>("select id, revision from result_revision where entry_id = $1", [ada])).rows;
    const disqualified = await disqualifyResultAsAdmin(db, { ...f.proof, entryId: ada, idempotencyKey: `manual-disqualification:${randomUUID()}`,
      request: { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: f.classId, expectedCourseVersionId: await courseVersionOf(f.classId),
        expectedSnapshotVersion: await snapshot(f.raceId), expectedResultRevision: { id: source!.id, revision: source!.revision, status: "OK" },
        policyVersion: RESULT_DISQUALIFICATION_POLICY_VERSION } });
    expect(disqualified.status).toBe("disqualified");
    expect(await effective(f, ada)).toMatchObject({ status: "DSQ" });

    // Ada stämplade inte 34, men disken gäller ändå: inget resultat byter status, så det sparas utan bekräftelse.
    const preview = await previewCourseEditAsAdministrator(db, { ...f.proof, courseId: f.courseId,
      request: { formatVersion: 1, expectedSnapshotVersion: await snapshot(f.raceId), controlCodes: [31, 32, 33, 34] } });
    if (preview.status !== "ok") throw new Error("Beskedet saknas");
    expect(preview.response).toMatchObject({ readOutCount: 1, unchangedCount: 1, requiresConfirmation: false });
    const saved = await edit(f, [31, 32, 33, 34], false);
    if (saved.result.status !== "edited") throw new Error(`Ändringen sparades inte: ${saved.result.status}`);
    expect(saved.result.response.recalculated).toHaveLength(1);
    expect(await effective(f, ada)).toMatchObject({ status: "DSQ" });
    // Den tekniska revisionen under disken är omräknad mot den nya banan.
    expect((await revisions(ada)).at(-1)).toMatchObject({ status: "MP", cause: "EXPLICIT_RECALCULATION" });
    const [basis] = (await pool.query<{ current: boolean }>(`select basis_hash = otid_result_basis_hash(entry_id) as current
      from result_revision where entry_id = $1 order by revision desc limit 1`, [ada])).rows;
    expect(basis?.current).toBe(true);
  });
});
