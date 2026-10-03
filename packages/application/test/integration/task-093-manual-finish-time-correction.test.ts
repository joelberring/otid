import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { correctManualFinishTimeAsAdministrator, previewManualFinishTimeCorrectionAsAdministrator } from "../../src/manual-finish-time-correction";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";
import { getReadoutHistoryAsAdmin } from "../../src/readout-result-history";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T16:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK093','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK093','2026-09-19')", [raceId, eventId]);
  const credential = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK093", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const historyCredential = await issuePairingAdminAccessCredential(db, { raceId, capability: "VIEW_READOUT_RESULT_HISTORY", label: "TASK093 historia", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const historyLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: historyCredential.accessCredential }, { expectedRaceId: raceId, expectedCapability: "VIEW_READOUT_RESULT_HISTORY", now });
  if (historyLogin.status !== "authenticated") throw new Error("Synthetic history login failed");
  const historyAuth = { raceId, sessionToken: historyLogin.sessionToken };
  const classRequestId = randomUUID();
  const created = await createManualCourseClassAsAdministrator(db, { ...auth, idempotencyKey: `manual-course-class-create:${classRequestId}`,
    request: { formatVersion: 1, requestId: classRequestId, expectedSnapshotVersion: 1, courseName: "TASK093", className: "Öppen", startRule: "PUNCH", controlCodes: [31, 42] } }, now);
  if (created.status !== "created") throw new Error("Fixture class failed");
  const entryId = randomUUID();
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','TASK093')", [entryId, raceId, created.response.classId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'93001')", [raceId, entryId]);
  const payload = { cardNumber: "93001", startPunchedAt: "2026-09-19T12:00:00Z", finishPunchedAt: "2026-09-19T12:20:00Z", punches: [
    { code: 31, punchedAt: "2026-09-19T12:05:00Z" }, { code: 42, punchedAt: "2026-09-19T12:10:00Z" }
  ] };
  await ingestDeviceBatch(db, raceId, { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: 2, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T12:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  const readoutId = (await pool.query<{ id: string }>("SELECT id FROM card_readout WHERE race_id=$1", [raceId])).rows[0]?.id;
  if (!readoutId) throw new Error("Synthetic readout missing");
  return { raceId, entryId, auth, historyAuth, readoutId };
}

it("TASK093 preserves the technical source, appends one exact correction, and replays", async () => {
  const f = await fixture();
  const candidate = await previewManualFinishTimeCorrectionAsAdministrator(db, { ...f.auth, entryId: f.entryId }, now);
  expect(candidate.status).toBe("ok");
  if (candidate.status !== "ok") return;
  const request = { formatVersion: 1 as const, requestId: randomUUID(), entryId: f.entryId,
    expectedEntryVersion: candidate.response.entryVersion, expectedClassId: candidate.response.classId,
    expectedCourseVersionId: candidate.response.source.courseVersionId, expectedSnapshotVersion: candidate.response.snapshotVersion,
    expectedBasisHash: candidate.response.basisHash, expectedSourceResultRevisionId: candidate.response.source.resultRevisionId,
    expectedSourceResultRevision: candidate.response.source.resultRevision, expectedReadoutId: candidate.response.source.readoutId,
    expectedSourceFinishTime: candidate.response.source.finishTime, correctedFinishTime: "2026-09-19T12:21:00+00:00",
    acknowledgedCorrection: true as const };
  const corrected = await correctManualFinishTimeAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-finish-time-correction:${request.requestId}`, request }, now);
  expect(corrected.status).toBe("corrected");
  if (corrected.status !== "corrected") return;
  expect(corrected.response).toMatchObject({ previousFinishTime: "2026-09-19T12:20:00.000Z", correctedFinishTime: "2026-09-19T12:21:00.000Z", elapsedMs: 1_260_000, createdResultRevision: 2 });
  expect((await pool.query<{ count: string }>("SELECT count(*) FROM card_readout WHERE race_id=$1", [f.raceId])).rows[0]?.count).toBe("1");
  expect((await pool.query<{ cause: string; revision: number }>("SELECT cause,revision FROM result_revision WHERE entry_id=$1 ORDER BY revision", [f.entryId])).rows)
    .toEqual([{ cause: "CARD_READOUT", revision: 1 }, { cause: "MANUAL_FINISH_TIME_CORRECTION", revision: 2 }]);
  const history = await getReadoutHistoryAsAdmin(db, { ...f.historyAuth, readoutId: f.readoutId, limit: 50 }, now);
  expect(history.status).toBe("ok");
  if (history.status === "ok") expect(history.response).toMatchObject({ formatVersion: 12, history: { items: [
    { revision: 1, source: { kind: "READOUT_RESULT" } },
    { revision: 2, source: { kind: "MANUAL_FINISH_TIME_CORRECTION", manualFinishTimeCorrectionId: request.requestId,
      sourceResultRevision: 1, sourceReadoutId: candidate.response.source.readoutId,
      correctedFinishTime: "2026-09-19T12:21:00.000Z" } }
  ] } });
  expect(await correctManualFinishTimeAsAdministrator(db, { ...f.auth,
    idempotencyKey: `manual-finish-time-correction:${request.requestId}`, request }, now))
    .toEqual({ status: "corrected", response: { ...corrected.response, replayed: true } });
});
