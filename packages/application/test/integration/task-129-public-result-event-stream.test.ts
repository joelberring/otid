import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "@o-tid/database";
import { readPublicResultEventStream } from "../../src/public-result-event-stream";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för en uttryckligen isolerad testdatabas");
const { db, pool } = createDatabase(url);

beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function publicResultFixture() {
  const eventId = randomUUID();
  const raceId = randomUUID();
  const courseId = randomUUID();
  const courseVersionId = randomUUID();
  const classId = randomUUID();
  const entryId = randomUUID();
  const rawMessageId = randomUUID();
  const readoutId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'TASK129','2026-09-22','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'TASK129','2026-09-22')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'TASK129')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'Öppen',$3,'FIXED')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Ada','Signal')", [entryId, raceId, classId]);
  await pool.query(
    "INSERT INTO raw_device_message(id,race_id,device_id,session_id,local_sequence,package_version,station_received_at,transport,raw_payload,content_hash) VALUES($1,$2,$3,$4,1,1,'2026-09-22T10:00:00Z','test','{}',$5)",
    [rawMessageId, raceId, randomUUID(), randomUUID(), "a".repeat(64)]
  );
  await pool.query(
    "INSERT INTO card_readout(id,race_id,raw_message_id,card_number,finish_punched_at,punches,read_at) VALUES($1,$2,$3,'12901','2026-09-22T10:10:00Z','[]','2026-09-22T10:10:00Z')",
    [readoutId, raceId, rawMessageId]
  );
  return { raceId, courseVersionId, entryId, readoutId };
}

async function insertResult(input: { raceId: string; courseVersionId: string; entryId: string; readoutId: string; revision: number; published: boolean }) {
  await pool.query(
    "INSERT INTO result_revision(id,race_id,entry_id,readout_id,revision,cause,status,reason,evaluation,engine_version,snapshot_version,course_version_id,published) VALUES($1,$2,$3,$4,$5,'CARD_READOUT','OK','COMPLETE','{}','task129',1,$6,$7)",
    [randomUUID(), input.raceId, input.entryId, input.readoutId, input.revision, input.courseVersionId, input.published]
  );
}

it("TASK129 records and notifies one ordered no-PII wake-up only for published result revisions", async () => {
  const fixture = await publicResultFixture();
  const listener = await pool.connect();
  try {
    await listener.query("LISTEN otid_public_result_update");
    const notification = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("TASK129-NOTIFY timeout")), 3_000);
      listener.on("notification", (message) => {
        if (message.channel === "otid_public_result_update") {
          clearTimeout(timeout);
          resolve(message.payload ?? "");
        }
      });
    });
    await insertResult({ ...fixture, revision: 1, published: false });
    expect((await pool.query("SELECT event_sequence FROM public_result_update_event WHERE race_id=$1", [fixture.raceId])).rows).toEqual([]);

    await insertResult({ ...fixture, revision: 2, published: true });
    const first = (await pool.query<{ event_sequence: string }>("SELECT event_sequence FROM public_result_update_event WHERE race_id=$1", [fixture.raceId])).rows;
    expect(first).toHaveLength(1);
    expect(await notification).toBe(`${fixture.raceId}:${first[0]!.event_sequence}`);

    await insertResult({ ...fixture, revision: 3, published: true });
    const state = await readPublicResultEventStream(db, fixture.raceId, first[0]!.event_sequence);
    expect(state).toMatchObject({ status: "ready" });
    if (state.status === "ready") expect(state.eventSequences).toHaveLength(1);
    expect(await readPublicResultEventStream(db, fixture.raceId, "0")).toEqual({ status: "invalid-cursor" });
    expect(await readPublicResultEventStream(db, randomUUID(), null)).toEqual({ status: "not-found" });
  } finally {
    listener.release();
  }
});
