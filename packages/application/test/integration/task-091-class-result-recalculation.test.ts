import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import {
  listClassResultRecalculationCandidatesAsAdministrator,
  recalculateClassResultsAsAdministrator
} from "../../src/class-result-recalculation";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { contentHash } from "../../src/hash";
import { ingestDeviceBatch } from "../../src/ingest";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-19T15:00:00.000Z");

beforeAll(async () => migrate(db, {
  migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname
}));
afterAll(async () => pool.end());

async function administrator(raceId: string) {
  const issued = await issuePairingAdminAccessCredential(db, {
    raceId, capability: "MANAGE_RACE", label: "Synthetic class recalculation",
    expiresAt: new Date(now.getTime() + 3_600_000)
  }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, {
    expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now
  });
  if (login.status !== "authenticated") throw new Error("Synthetic administrator login failed");
  return {
    raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken,
    csrfHeader: login.csrfToken, actorId: issued.credentialId
  };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), classId = randomUUID();
  const courseId = randomUUID(), courseVersionId = randomUUID(), controlId = randomUUID();
  const entryIds = [randomUUID(), randomUUID()].sort();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK091 synthetic','2026-09-19','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK091 synthetic','2026-09-19')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'TASK091 course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,31)", [controlId, raceId]);
  await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,1)", [courseVersionId, controlId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'H21',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  for (const [index, entryId] of entryIds.entries()) {
    const cardNumber = String(123450 + index);
    await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,$4,$5)", [entryId, raceId, classId, `Ada${index}`, "Synthetic"]);
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,$3)", [raceId, entryId, cardNumber]);
    const payload = { cardNumber, startPunchedAt: "2026-09-19T10:00:00Z", finishPunchedAt: `2026-09-19T10:2${index}:00Z`, punches: [{ code: 31, punchedAt: "2026-09-19T10:10:00Z" }] };
    const deviceId = randomUUID();
    const result = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: `2026-09-19T10:3${index}:00Z`, transport: "simulator", payload, contentHash: contentHash(payload) }] });
    expect(result.acknowledgements[0]?.status).toBe("stored");
  }
  // The initial immutable card results are snapshot 1. A later package version
  // makes them deliberately stale without altering raw data or revisions.
  await pool.query("UPDATE race SET snapshot_version=2 WHERE id=$1", [raceId]);
  return { raceId, classId, entryIds, administrator: await administrator(raceId) };
}

async function intent(f: Awaited<ReturnType<typeof fixture>>) {
  const listed = await listClassResultRecalculationCandidatesAsAdministrator(db, {
    ...f.administrator, classId: f.classId
  }, now);
  if (listed.status !== "ok") throw new Error("Class candidates unavailable");
  expect(listed.response.entries.map((entry) => entry.readiness)).toEqual(["READY", "READY"]);
  return { formatVersion: 1 as const, classId: f.classId, snapshotVersion: listed.response.snapshotVersion,
    engineVersion: listed.response.engineVersion, manifestHash: listed.response.manifestHash, entryIds: f.entryIds };
}

describe("TASK091 atomic class result recalculation", () => {
  it("appends exactly one technical revision per selected entry, immutable group evidence and exact retry", async () => {
    const f = await fixture(), request = await intent(f);
    const [firstEntry, secondEntry] = f.entryIds;
    if (!firstEntry || !secondEntry) throw new Error("Synthetic entries missing");
    const input = { ...f.administrator, idempotencyKey: `class-result-recalculation:${randomUUID()}`, request };
    const before = await pool.query<{ id: string; revision: number }>("SELECT id,revision FROM result_revision WHERE race_id=$1 ORDER BY entry_id,revision", [f.raceId]);
    const saved = await recalculateClassResultsAsAdministrator(db, input, now);
    if (saved.status !== "recalculated") throw new Error(`Group recalculation failed: ${saved.status}`);
    expect(saved.response.replayed).toBe(false);
    expect(saved.response.classId).toBe(f.classId);
    expect(saved.response.snapshotVersion).toBe(2);
    expect(saved.response.items).toHaveLength(2);
    expect(saved.response.items.some((item) => item.entryId === firstEntry && item.revision === 2)).toBe(true);
    expect(saved.response.items.some((item) => item.entryId === secondEntry && item.revision === 2)).toBe(true);
    expect(await recalculateClassResultsAsAdministrator(db, input, now)).toEqual({ status: "recalculated", response: { ...saved.response, replayed: true } });
    expect((await recalculateClassResultsAsAdministrator(db, { ...input, request: { ...request, manifestHash: "b".repeat(64) } }, now)).status).toBe("conflict");
    const revisions = await pool.query<{ id: string; entry_id: string; revision: number; cause: string }>("SELECT id,entry_id,revision,cause FROM result_revision WHERE race_id=$1 ORDER BY entry_id,revision", [f.raceId]);
    expect(revisions.rows).toHaveLength(4);
    // Rows are ordered by participant first, so each old revision must still
    // exist even though its successor is immediately adjacent to it.
    for (const original of before.rows) {
      expect(revisions.rows).toContainEqual(expect.objectContaining(original));
    }
    expect(revisions.rows.slice(2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ revision: 2, cause: "EXPLICIT_RECALCULATION" })
    ]));
    expect((await pool.query("SELECT * FROM class_result_recalculation WHERE race_id=$1", [f.raceId])).rowCount).toBe(1);
    expect((await pool.query("SELECT * FROM class_result_recalculation_item WHERE race_id=$1", [f.raceId])).rowCount).toBe(2);
    await expect(pool.query("UPDATE class_result_recalculation SET recalculated_at=recalculated_at WHERE race_id=$1", [f.raceId])).rejects.toThrow();
  });

  it("rejects a stale reviewed manifest after a new selected-entry ingest without a partial group write", async () => {
    const f = await fixture(), request = await intent(f), entryId = f.entryIds[0];
    if (!entryId) throw new Error("Synthetic entry missing");
    const cardRow = (await pool.query<{ card_number: string }>("SELECT card_number FROM card_assignment WHERE entry_id=$1", [entryId])).rows[0];
    if (!cardRow) throw new Error("Synthetic card missing");
    const card = cardRow.card_number;
    const payload = { cardNumber: card, startPunchedAt: "2026-09-19T11:00:00Z", finishPunchedAt: "2026-09-19T11:20:00Z", punches: [{ code: 31, punchedAt: "2026-09-19T11:10:00Z" }] };
    const deviceId = randomUUID();
    await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 2, firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: "2026-09-19T11:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
    const result = await recalculateClassResultsAsAdministrator(db, { ...f.administrator,
      idempotencyKey: `class-result-recalculation:${randomUUID()}`, request }, now);
    expect(result.status).toBe("conflict");
    expect((await pool.query("SELECT * FROM class_result_recalculation WHERE race_id=$1", [f.raceId])).rowCount).toBe(0);
    const revisions = await pool.query<{ entry_id: string; revision: number; cause: string }>("SELECT entry_id,revision,cause FROM result_revision WHERE race_id=$1 ORDER BY entry_id,revision", [f.raceId]);
    expect(revisions.rows).toHaveLength(3);
    expect(revisions.rows.filter((row) => row.cause === "EXPLICIT_RECALCULATION")).toHaveLength(0);
  });
});
