import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { listEntryRegistrationCandidatesAsAdmin } from "../../src/entry-registration-candidates";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/hash";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-12T14:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function auth(raceId: string, capability: "MANAGE_RACE" | "REGISTER_ENTRY" | "VIEW_START_LIST" = "MANAGE_RACE") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Synthetic recalculation",
    expiresAt: new Date(now.getTime() + 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { expectedRaceId: raceId, expectedCapability: capability, now });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken, actorId: installation.credentialId };
}
async function fixture() {
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
  const payload = { cardNumber: "12345", startPunchedAt: "2026-09-12T10:00:00Z", finishPunchedAt: "2026-09-12T10:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T10:10:00Z" }] };
  const deviceId = randomUUID();
  const ingested = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:21:00Z",
      transport: "simulator", payload, contentHash: contentHash(payload) }] });
  expect(ingested.acknowledgements[0]?.status).toBe("stored");
  return { raceId, entryId, classId, courseVersionId, administrator: await auth(raceId) };
}

function search(f: Awaited<ReturnType<typeof fixture>>, cardNumber: string | null = null) {
  return { ...f.administrator, request: { formatVersion: 1, expectedSnapshotVersion: 1,
    givenName: " ADA ", familyName: "Synthetic", cardNumber } };
}
async function footprint(raceId: string) {
  const entry = (await pool.query("SELECT * FROM entry WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const cards = (await pool.query("SELECT * FROM card_assignment WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const race = (await pool.query("SELECT * FROM race WHERE id=$1", [raceId])).rows;
  const audit = (await pool.query("SELECT * FROM audit_event WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const journal = (await pool.query("SELECT * FROM entry_registration_request WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  const results = (await pool.query("SELECT * FROM result_revision WHERE race_id=$1 ORDER BY id", [raceId])).rows;
  return JSON.stringify({ entry, cards, race, audit, journal, results });
}
describe("TASK036 administrator registration candidates", () => {
  it("finds normalized names across classes/clubs and prioritizes inactive historical card ownership with exact total and max20", async () => {
    const f = await fixture(), other = await fixture();
    const otherClass = randomUUID();
    await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Synthetic other class',$3,'PUNCH')",
      [otherClass, f.raceId, f.courseVersionId]);
    for (let i = 0; i < 22; i++) {
      await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name,organisation_name) VALUES($1,$2,$3,' Ada  ','SYNTHETIC','Other club')",
        [randomUUID(), f.raceId, otherClass]);
    }
    await pool.query("UPDATE card_assignment SET active=false WHERE race_id=$1", [f.raceId]);
    const before = await footprint(f.raceId);
    const result = await listEntryRegistrationCandidatesAsAdmin(db, search(f, "12345"), now);
    if (result.status !== "ok") throw new Error("Candidate read failed");
    expect(result.response.totalMatches).toBe(23); expect(result.response.candidates).toHaveLength(20);
    expect(result.response.candidates[0]).toMatchObject({ entryId: f.entryId, reasons: ["SAME_NAME", "CARD_ALREADY_ASSIGNED"] });
    expect(result.response.candidates.some(row => row.entryId === other.entryId)).toBe(false);
    expect(result.response.candidates.some(row => row.classId === otherClass && row.organisationName === "Other club")).toBe(true);
    const ids = result.response.candidates.slice(1).map(row => row.entryId);
    expect(ids).toEqual([...ids].sort());
    expect(await footprint(f.raceId)).toBe(before);
    // Canonical composition, whitespace collapse and Swedish lowercasing are advisory only.
    await pool.query("UPDATE entry SET given_name='Åsa  Maria',family_name='Öberg' WHERE id=$1", [f.entryId]);
    expect(await listEntryRegistrationCandidatesAsAdmin(db, { ...search(f), request: { ...search(f).request,
      givenName: "A\u030Asa Maria", familyName: "öberg" } }, now))
      .toMatchObject({ status: "ok", response: { totalMatches: 1, candidates: [{ entryId: f.entryId, reasons: ["SAME_NAME"] }] } });
  });

  it("requires CSRF and registration authority, rejects stale scope, and returns honest zero matches without writes", async () => {
    const f = await fixture(), limited = await auth(f.raceId, "REGISTER_ENTRY"), reader = await auth(f.raceId, "VIEW_START_LIST");
    const input = search(f), before = await footprint(f.raceId);
    expect((await listEntryRegistrationCandidatesAsAdmin(db, { ...input, ...limited }, now)).status).toBe("ok");
    expect((await listEntryRegistrationCandidatesAsAdmin(db, { ...input, ...reader }, now)).status).toBe("forbidden");
    expect((await listEntryRegistrationCandidatesAsAdmin(db, { ...input, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await listEntryRegistrationCandidatesAsAdmin(db, { ...input, request: { ...input.request, expectedSnapshotVersion: 2 } }, now)).status).toBe("conflict");
    expect(await listEntryRegistrationCandidatesAsAdmin(db, { ...input, request: { ...input.request, givenName: "Absent" } }, now))
      .toMatchObject({ status: "ok", response: { totalMatches: 0, candidates: [] } });
    expect(await footprint(f.raceId)).toBe(before);
  });

  it("fails closed on cross-race class and historical card-owner relations instead of omitting rows", async () => {
    const f = await fixture(), other = await fixture();
    await pool.query("UPDATE entry SET class_id=$1 WHERE id=$2", [other.classId, f.entryId]);
    await expect(listEntryRegistrationCandidatesAsAdmin(db, search(f), now)).rejects.toThrow("klassrelation");
    await pool.query("UPDATE entry SET class_id=$1 WHERE id=$2", [f.classId, f.entryId]);
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number,active) VALUES($1,$2,'99999',false)", [f.raceId, other.entryId]);
    await expect(listEntryRegistrationCandidatesAsAdmin(db, search(f, "99999"), now)).rejects.toThrow("koppling");
  });
});

