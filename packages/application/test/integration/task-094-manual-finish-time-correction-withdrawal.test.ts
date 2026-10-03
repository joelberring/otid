import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { correctManualFinishTimeAsAdministrator, previewManualFinishTimeCorrectionAsAdministrator } from "../../src/manual-finish-time-correction";
import { previewManualFinishTimeCorrectionWithdrawalAsAdministrator, withdrawManualFinishTimeCorrectionAsAdministrator } from "../../src/manual-finish-time-correction-withdrawal";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";
import { getReadoutHistoryAsAdmin } from "../../src/readout-result-history";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T17:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK094','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK094','2026-09-19')", [raceId, eventId]);
  const credential = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK094", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const historyCredential = await issuePairingAdminAccessCredential(db, { raceId, capability: "VIEW_READOUT_RESULT_HISTORY", label: "TASK094 history", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const historyLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: historyCredential.accessCredential }, { expectedRaceId: raceId, expectedCapability: "VIEW_READOUT_RESULT_HISTORY", now });
  if (historyLogin.status !== "authenticated") throw new Error("Synthetic history login failed");
  const historyAuth = { raceId, sessionToken: historyLogin.sessionToken };
  const classRequestId = randomUUID();
  const created = await createManualCourseClassAsAdministrator(db, { ...auth, idempotencyKey: `manual-course-class-create:${classRequestId}`,
    request: { formatVersion: 1, requestId: classRequestId, expectedSnapshotVersion: 1, courseName: "TASK094", className: "Öppen", startRule: "PUNCH", controlCodes: [31, 42] } }, now);
  if (created.status !== "created") throw new Error("Fixture class failed");
  const entryId = randomUUID();
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','TASK094')", [entryId, raceId, created.response.classId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'94001')", [raceId, entryId]);
  const payload = { cardNumber: "94001", startPunchedAt: "2026-09-19T12:00:00Z", finishPunchedAt: "2026-09-19T12:20:00Z", punches: [
    { code: 31, punchedAt: "2026-09-19T12:05:00Z" }, { code: 42, punchedAt: "2026-09-19T12:10:00Z" }
  ] };
  await ingestDeviceBatch(db, raceId, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: 2, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T12:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  const readoutId = (await pool.query<{ id: string }>("SELECT id FROM card_readout WHERE race_id=$1", [raceId])).rows[0]?.id;
  if (!readoutId) throw new Error("Synthetic readout missing");
  const correctionCandidate = await previewManualFinishTimeCorrectionAsAdministrator(db, { ...auth, entryId }, now);
  if (correctionCandidate.status !== "ok") throw new Error("Correction candidate missing");
  const correctionRequest = { formatVersion: 1 as const, requestId: randomUUID(), entryId, expectedEntryVersion: correctionCandidate.response.entryVersion,
    expectedClassId: correctionCandidate.response.classId, expectedCourseVersionId: correctionCandidate.response.source.courseVersionId,
    expectedSnapshotVersion: correctionCandidate.response.snapshotVersion, expectedBasisHash: correctionCandidate.response.basisHash,
    expectedSourceResultRevisionId: correctionCandidate.response.source.resultRevisionId, expectedSourceResultRevision: correctionCandidate.response.source.resultRevision,
    expectedReadoutId: correctionCandidate.response.source.readoutId, expectedSourceFinishTime: correctionCandidate.response.source.finishTime,
    correctedFinishTime: "2026-09-19T12:21:00+00:00", acknowledgedCorrection: true as const };
  const correction = await correctManualFinishTimeAsAdministrator(db, { ...auth, idempotencyKey: `manual-finish-time-correction:${correctionRequest.requestId}`, request: correctionRequest }, now);
  if (correction.status !== "corrected") throw new Error("Correction failed");
  return { raceId, entryId, auth, historyAuth, readoutId, correction };
}

it("TASK094 appends an exact source restoration and exact retry without raw mutation", async () => {
  const f = await fixture();
  const correctedList = await listEntryTransfersAsAdministrator(db, f.auth, now);
  expect(correctedList.status).toBe("ok");
  if (correctedList.status === "ok") expect(correctedList.response.entries.find(entry => entry.id === f.entryId)?.resultRevisionMarker)
    .toBe("MANUAL_FINISH_TIME_CORRECTION");
  const candidate = await previewManualFinishTimeCorrectionWithdrawalAsAdministrator(db, { ...f.auth, entryId: f.entryId }, now);
  expect(candidate.status).toBe("ok");
  if (candidate.status !== "ok") return;
  const request = { formatVersion: 1 as const, requestId: randomUUID(), entryId: f.entryId, expectedEntryVersion: candidate.response.entryVersion,
    expectedClassId: candidate.response.classId, expectedCourseVersionId: candidate.response.courseVersionId, expectedSnapshotVersion: candidate.response.snapshotVersion,
    expectedBasisHash: candidate.response.basisHash, expectedCorrectionId: candidate.response.correctionId,
    expectedSource: { id: candidate.response.source.id, revision: candidate.response.source.revision },
    expectedCorrected: { id: candidate.response.corrected.id, revision: candidate.response.corrected.revision },
    expectedAbsoluteHead: candidate.response.absoluteHead, acknowledgedWithdrawal: true as const };
  const withdrawn = await withdrawManualFinishTimeCorrectionAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-finish-time-correction-withdrawal:${request.requestId}`, request }, now);
  expect(withdrawn.status).toBe("withdrawn");
  if (withdrawn.status !== "withdrawn") return;
  expect(withdrawn.response).toMatchObject({ cause: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", created: { revision: 3, finishTime: "2026-09-19T12:20:00.000Z" } });
  expect((await pool.query<{ cause: string; revision: number }>("SELECT cause,revision FROM result_revision WHERE entry_id=$1 ORDER BY revision", [f.entryId])).rows)
    .toEqual([{ cause: "CARD_READOUT", revision: 1 }, { cause: "MANUAL_FINISH_TIME_CORRECTION", revision: 2 }, { cause: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", revision: 3 }]);
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM card_readout WHERE race_id=$1", [f.raceId])).rows[0]?.count).toBe("1");
  const withdrawnList = await listEntryTransfersAsAdministrator(db, f.auth, now);
  expect(withdrawnList.status).toBe("ok");
  if (withdrawnList.status === "ok") expect(withdrawnList.response.entries.find(entry => entry.id === f.entryId)?.resultRevisionMarker)
    .toBe("MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL");
  const history = await getReadoutHistoryAsAdmin(db, { ...f.historyAuth, readoutId: f.readoutId, limit: 50 }, now);
  expect(history.status).toBe("ok");
  if (history.status === "ok") expect(history.response).toMatchObject({ formatVersion: 12, history: { items: [
    { revision: 1, source: { kind: "READOUT_RESULT" } },
    { revision: 2, source: { kind: "MANUAL_FINISH_TIME_CORRECTION" } },
    { revision: 3, source: { kind: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", manualFinishTimeCorrectionId: request.expectedCorrectionId } }
  ] } });
  expect(await withdrawManualFinishTimeCorrectionAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-finish-time-correction-withdrawal:${request.requestId}`, request }, now))
    .toEqual({ status: "withdrawn", response: { ...withdrawn.response, replayed: true } });
});
