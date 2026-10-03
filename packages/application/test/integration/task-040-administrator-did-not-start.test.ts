import { DID_NOT_START_DECISION_POLICY_VERSION } from "@o-tid/contracts";
import { decideDidNotStartAsAdmin } from "../../src/did-not-start";
import { withdrawDidNotStartAsAdmin } from "../../src/did-not-start-withdrawal";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T14:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, capability: "MANAGE_RACE" | "RECALCULATE_RESULT" | "DISQUALIFY_RESULT" | "VIEW_START_LIST" | "DECIDE_DID_NOT_START" | "WITHDRAW_DID_NOT_START" | "DECIDE_WITHOUT_TIMING" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic recalculation",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken, actorId: installation.credentialId };
}
async function fixture(withReadout = true) {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), entryId = randomUUID(), controlId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Synthetic recalculation','2026-09-12','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Synthetic recalculation','2026-09-12')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Synthetic course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,31)", [controlId, raceId]);
  await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,1)", [courseVersionId, controlId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic class',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Synthetic')", [entryId, raceId, classId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'12345')", [raceId, entryId]);
  if (withReadout) {
  const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
  const deviceId = randomUUID();
  const ingested = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:21:00Z",
      transport: "simulator", payload, contentHash: contentHash(payload) }] });
  expect(ingested.acknowledgements[0]?.status).toBe("stored");
  }
  return { raceId, entryId, classId, courseVersionId, administrator: await auth(raceId) };
}

function input(f: Awaited<ReturnType<typeof fixture>>) {
  return { ...f.administrator, entryId: f.entryId, idempotencyKey: `did-not-start:${randomUUID()}`, request: {
    formatVersion: 1, expectedEntryVersion: 1, expectedClassId: f.classId, expectedCourseVersionId: f.courseVersionId,
    expectedSnapshotVersion: 1, expectedLatestResultRevision: null, policyVersion: DID_NOT_START_DECISION_POLICY_VERSION } };
}
async function preserved(raceId: string) {
  const entry = (await pool.query("SELECT * FROM entry WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const race = (await pool.query("SELECT * FROM race WHERE id=$1", [raceId])).rows;
  const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const readouts = (await pool.query("SELECT * FROM card_readout WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ entry, race, raw, readouts });
}
describe("TASK040 administrator manual DNS and withdrawal", () => {
  it("records true admin and limited actors, preserves DNS revision and exact old responses", async () => {
    for (const useAdmin of [true, false]) {
      const f = await fixture(false), request = input(f);
      const decider = useAdmin ? f.administrator : await auth(f.raceId, "DECIDE_DID_NOT_START");
      const withdrawer = useAdmin ? f.administrator : await auth(f.raceId, "WITHDRAW_DID_NOT_START");
      const before = await preserved(f.raceId);
      const original = { ...request, ...decider };
      const decided = await decideDidNotStartAsAdmin(db, original, now);
      if (decided.status !== "decided") throw new Error("DNS failed");
      const revisions = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [f.raceId])).rows;
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({ revision: 1, readout_id: null, status: "DNS" });
      const withdrawal = { ...withdrawer, entryId: f.entryId, idempotencyKey: `did-not-start-withdrawal:${randomUUID()}`,
        request: { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: f.classId,
          expectedCourseVersionId: f.courseVersionId, expectedSnapshotVersion: 1,
          expectedDidNotStartDecisionId: decided.response.didNotStartDecisionId,
          expectedResultRevision: { id: decided.response.resultRevisionId, revision: 1 },
          policyVersion: "did-not-start-withdrawal-v1" } };
      const withdrawn = await withdrawDidNotStartAsAdmin(db, withdrawal, now);
      if (withdrawn.status !== "withdrawn") throw new Error("Withdrawal failed");
      expect(await decideDidNotStartAsAdmin(db, original, now)).toEqual({ ...decided, response: { ...decided.response, replayed: true } });
      expect(await withdrawDidNotStartAsAdmin(db, withdrawal, now)).toEqual({ ...withdrawn, response: { ...withdrawn.response, replayed: true } });
      const other = await auth(f.raceId);
      expect((await decideDidNotStartAsAdmin(db, { ...original, ...other }, now)).status).toBe("conflict");
      expect((await withdrawDidNotStartAsAdmin(db, { ...withdrawal, ...other }, now)).status).toBe("conflict");
      expect((await decideDidNotStartAsAdmin(db, { ...original, idempotencyKey: `did-not-start:${randomUUID()}` }, now)).status).toBe("conflict");
      expect(await getAdministratorEffectiveResult(db, { ...f.administrator, entryId: f.entryId }, now))
        .toMatchObject({ status: "ok", response: { state: "NO_ACTIVE_RESULT" } });
      expect((await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [f.raceId])).rows).toEqual(revisions);
      expect(await preserved(f.raceId)).toBe(before);
      expect((await pool.query("SELECT actor_kind,actor_id FROM audit_event WHERE race_id=$1 AND action='DID_NOT_START_DECIDED'", [f.raceId])).rows)
        .toEqual([{ actor_kind: useAdmin ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "DID_NOT_START_ACCESS_CREDENTIAL", actor_id: decider.actorId }]);
      expect((await pool.query("SELECT actor_kind,actor_id FROM audit_event WHERE race_id=$1 AND action='DID_NOT_START_WITHDRAWN'", [f.raceId])).rows)
        .toEqual([{ actor_kind: useAdmin ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL", actor_id: withdrawer.actorId }]);
      expect((await pool.query("SELECT * FROM did_not_start_withdrawal WHERE race_id=$1", [f.raceId])).rowCount).toBe(1);
    }
  });
  it("rejects existing technical history, stale intent, missing CSRF and unrelated limited roles", async () => {
    const f = await fixture(), original = input(f), reader = await auth(f.raceId, "VIEW_START_LIST");
    const before = await preserved(f.raceId);
    expect((await decideDidNotStartAsAdmin(db, original, now)).status).toBe("conflict");
    expect((await decideDidNotStartAsAdmin(db, { ...original, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await decideDidNotStartAsAdmin(db, { ...original, ...reader }, now)).status).toBe("forbidden");
    const empty = await fixture(false), stale = input(empty);
    expect((await decideDidNotStartAsAdmin(db, { ...stale, request: { ...stale.request, expectedSnapshotVersion: 2 } }, now)).status).toBe("conflict");
    expect((await pool.query("SELECT * FROM did_not_start_decision WHERE race_id=$1", [f.raceId])).rowCount).toBe(0);
    expect(await preserved(f.raceId)).toBe(before);
  });
});

