import { disqualifyResultAsAdmin } from "../../src/result-disqualification";
import { withdrawResultDisqualificationAsAdmin, listResultDisqualificationWithdrawalsAsAdmin } from "../../src/result-disqualification-withdrawal";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
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
async function auth(raceId: string, capability: "MANAGE_RACE" | "DISQUALIFY_RESULT" | "VIEW_START_LIST" | "WITHDRAW_DISQUALIFICATION" = "MANAGE_RACE") {
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

describe("TASK042 administrator DSQ and restoration", () => {
  it("does not fabricate DSQ without a technical result and preserves limited-role and CSRF boundaries", async () => {
    const f = await fixture(false), reader = await auth(f.raceId, "VIEW_START_LIST");
    const input = { ...f.administrator, entryId: f.entryId, idempotencyKey: `manual-disqualification:${randomUUID()}`,
      request: { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: f.classId,
        expectedCourseVersionId: f.courseVersionId, expectedSnapshotVersion: 1,
        expectedResultRevision: { id: randomUUID(), revision: 1, status: "OK" }, policyVersion: "manual-disqualification-v1" } };
    expect((await disqualifyResultAsAdmin(db, input, now)).status).toBe("conflict");
    expect((await disqualifyResultAsAdmin(db, { ...input, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await disqualifyResultAsAdmin(db, { ...input, ...reader }, now)).status).toBe("forbidden");
    expect((await pool.query("SELECT * FROM result_revision WHERE race_id=$1", [f.raceId])).rowCount).toBe(0);
  });
  it("preserves later technical ingest beneath DSQ, exact source restoration, genuine actors and retries", async () => {
    for (const admin of [true, false]) {
      const f = await fixture(), actor = admin ? f.administrator : await auth(f.raceId, "DISQUALIFY_RESULT");
      const withdrawalActor = admin ? actor : await auth(f.raceId, "WITHDRAW_DISQUALIFICATION");
      const source = (await pool.query<{ id: string; revision: number }>("SELECT id,revision FROM result_revision WHERE race_id=$1", [f.raceId])).rows[0]!;
      const common = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: f.classId,
        expectedCourseVersionId: f.courseVersionId, expectedSnapshotVersion: 1 };
      const input = { ...actor, entryId: f.entryId, idempotencyKey: `manual-disqualification:${randomUUID()}`,
        request: { ...common, expectedResultRevision: { ...source, status: "OK" }, policyVersion: "manual-disqualification-v1" } };
      const decided = await disqualifyResultAsAdmin(db, input, now);
      if (decided.status !== "disqualified") throw new Error("DSQ failed");
      const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:30:00Z",
        punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
      const deviceId = randomUUID();
      await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
        firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:31:00Z",
          transport: "simulator", payload, contentHash: contentHash(payload) }] });
      expect(await getAdministratorEffectiveResult(db, { ...f.administrator, entryId: f.entryId }, now))
        .toMatchObject({ status: "ok", response: { result: { status: "DSQ", revision: 2 }, selectedRevision: { revision: 3 } } });
      const listed = await listResultDisqualificationWithdrawalsAsAdmin(db, withdrawalActor, now);
      if (listed.status !== "ok") throw new Error("Withdrawal list failed");
      const candidate = listed.response.entries.find(row => row.id === f.entryId)!;
      const withdraw = { ...withdrawalActor, entryId: f.entryId, idempotencyKey: `manual-disqualification-withdrawal:${randomUUID()}`,
        request: { ...common, expectedResultDisqualificationDecisionId: candidate.resultDisqualificationDecisionId,
          expectedTargetResultRevision: candidate.targetResultRevision, expectedDisqualifiedResultRevision: candidate.disqualifiedResultRevision,
          expectedAbsoluteResultRevision: candidate.absoluteResultRevision, expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
          policyVersion: "manual-disqualification-withdrawal-v1" } };
      const history = (await pool.query<{ evaluation: unknown }>("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY revision", [f.raceId])).rows;
      const raw = (await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [f.raceId])).rows;
      const withdrawn = await withdrawResultDisqualificationAsAdmin(db, withdraw, now);
      if (withdrawn.status !== "withdrawn") throw new Error("Withdrawal failed");
      const after = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY revision", [f.raceId])).rows;
      expect(after).toHaveLength(4); expect(after.slice(0, 3)).toEqual(history);
      expect(after[3]).toMatchObject({ cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL", readout_id: null, evaluation: history[2]!.evaluation });
      expect(await disqualifyResultAsAdmin(db, input, now)).toEqual({ ...decided, response: { ...decided.response, replayed: true } });
      expect(await withdrawResultDisqualificationAsAdmin(db, withdraw, now)).toEqual({ ...withdrawn, response: { ...withdrawn.response, replayed: true } });
      const other = await auth(f.raceId);
      expect((await disqualifyResultAsAdmin(db, { ...input, ...other }, now)).status).toBe("conflict");
      expect((await withdrawResultDisqualificationAsAdmin(db, { ...withdraw, ...other }, now)).status).toBe("conflict");
      expect((await pool.query("SELECT * FROM raw_device_message WHERE race_id=$1 ORDER BY id", [f.raceId])).rows).toEqual(raw);
      expect((await pool.query("SELECT snapshot_version FROM race WHERE id=$1", [f.raceId])).rows).toEqual([{ snapshot_version: 1 }]);
      expect((await pool.query("SELECT version FROM entry WHERE id=$1", [f.entryId])).rows).toEqual([{ version: 1 }]);
      expect((await pool.query("SELECT actor_kind,actor_id FROM audit_event WHERE race_id=$1 AND action='RESULT_DISQUALIFIED'", [f.raceId])).rows)
        .toEqual([{ actor_kind: admin ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "RESULT_DISQUALIFICATION_ACCESS_CREDENTIAL", actor_id: actor.actorId }]);
      expect((await pool.query("SELECT actor_kind,actor_id FROM audit_event WHERE race_id=$1 AND action='RESULT_DISQUALIFICATION_WITHDRAWN'", [f.raceId])).rows)
        .toEqual([{ actor_kind: admin ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "RESULT_DISQUALIFICATION_WITHDRAWAL_ACCESS_CREDENTIAL", actor_id: withdrawalActor.actorId }]);
    }
  });
});
