import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { changeEntryCardAsAdmin, listEntryCardsAsAdmin } from "../../src/entry-card";
import { listEntryRegistrationClassesAsAdmin, registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestDeviceBatch } from "../../src/ingest";
import { contentHash } from "../../src/serialization";
import { raceLogin } from "./accounts";

/**
 * Översynen 2026-11-02, punkt 3 och 4: brickbyte mellan två löpare, inaktiv historik som inte hindrar, och en avläsning
 * som redan finns för brickan kopplas och räknas när brickan ges till en löpare (Byt bricka och Ny deltagare).
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs för vald isolerad testdatabas");
const { db, pool } = createDatabase(url);
const now = new Date("2026-12-09T20:00:00Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function auth(raceId: string) {
  const login = await raceLogin(db, raceId, "ADMIN", now);
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const classId = randomUUID(), controlId = randomUUID();
  const [anna, bo, cia] = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,'Natt','2026-12-09','Europe/Stockholm')", [eventId]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,'Natt','2026-12-09')", [raceId, eventId]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'Bana 1')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO control(id,race_id,code) VALUES($1,$2,31)", [controlId, raceId]);
  await pool.query("INSERT INTO course_control(course_version_id,control_id,sequence) VALUES($1,$2,1)", [courseVersionId, controlId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,'H21',$3,'PUNCH')", [classId, raceId, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$4,$5,'Anna','Andersson'),($2,$4,$5,'Bo','Berg'),($3,$4,$5,'Cia','Ek')",
    [anna, bo, cia, raceId, classId]);
  await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,'2001001'),($1,$3,'2001002')", [raceId, anna, bo]);
  return { raceId, classId, courseVersionId, anna, bo, cia, admin: await auth(raceId) };
}

async function readOut(raceId: string, cardNumber: string, finish: string) {
  const payload = { cardNumber, startPunchedAt: "2026-12-09T19:00:00Z", finishPunchedAt: finish,
    punches: [{ code: 31, punchedAt: "2026-12-09T19:10:00Z" }] };
  const deviceId = randomUUID();
  const ack = await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: finish, transport: "simulator", payload, contentHash: contentHash(payload) }] });
  expect(ack.acknowledgements[0]?.status).toBe("stored");
}

async function cardRequest(f: Awaited<ReturnType<typeof fixture>>, entryId: string, cardNumber: string, swapWith?: string) {
  const listed = await listEntryCardsAsAdmin(db, f.admin, now);
  if (listed.status !== "ok") throw new Error("Listan saknas");
  const entry = listed.response.entries.find((row) => row.id === entryId)!;
  const other = swapWith ? listed.response.entries.find((row) => row.id === swapWith)! : undefined;
  return { ...f.admin, entryId, idempotencyKey: `entry-card-change:${randomUUID()}`, request: { formatVersion: 1,
    expectedEntryVersion: entry.version, expectedClassId: entry.classId, expectedAssignment: entry.activeAssignment, cardNumber,
    ...(other ? { swapWith: { entryId: other.id, expectedEntryVersion: other.version, expectedClassId: other.classId,
      expectedAssignment: other.activeAssignment } } : {}) } };
}

async function latest(entryId: string) {
  const { rows } = await pool.query<{ status: string; card_number: string | null; cause: string }>(`SELECT r.status, c.card_number, r.cause
    FROM result_revision r LEFT JOIN card_readout c ON c.id = r.readout_id WHERE r.entry_id = $1 ORDER BY r.revision DESC LIMIT 1`, [entryId]);
  return rows[0];
}

describe("brickor på tävlingsdagen (översynen 2026-11-02)", () => {
  it("en inaktiv koppling hos en annan löpare hindrar inte brickbytet", async () => {
    const f = await fixture();
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number,active) VALUES($1,$2,'7000007',false)", [f.raceId, f.bo]);
    const changed = await changeEntryCardAsAdmin(db, await cardRequest(f, f.anna, "7000007"), now);
    expect(changed.status).toBe("changed");
  });

  it("en bricka som är aktiv hos någon annan ger vem som har den, inte 'har ändrats under tiden'", async () => {
    const f = await fixture();
    const refused = await changeEntryCardAsAdmin(db, await cardRequest(f, f.anna, "2001002"), now);
    expect(refused).toMatchObject({ status: "card-in-use", holder: { entryId: f.bo, displayName: "Bo Berg", className: "H21",
      assignment: { cardNumber: "2001002" } } });
  });

  it("Byt bricka med …: två löpare som sprungit med varandras brickor rättas i en transaktion och resultaten följer brickan", async () => {
    const f = await fixture();
    // Bo sprang med Annas bricka och läses ut först: resultatet hamnar fel, hos Anna.
    await readOut(f.raceId, "2001001", "2026-12-09T19:30:00Z");
    expect(await latest(f.anna)).toMatchObject({ status: "OK", card_number: "2001001" });
    const input = await cardRequest(f, f.anna, "2001002", f.bo);
    const swapped = await changeEntryCardAsAdmin(db, input, now);
    if (swapped.status !== "changed") throw new Error(JSON.stringify(swapped));
    expect(swapped.response).toMatchObject({ activeAssignment: { cardNumber: "2001002" }, previousAssignment: { cardNumber: "2001001" },
      swappedWith: { entryId: f.bo, displayName: "Bo Berg", previousAssignment: { cardNumber: "2001002" }, activeAssignment: { cardNumber: "2001001" } },
      linkedReadouts: [{ entryId: f.bo, cardNumber: "2001001", status: "OK" }],
      staleResults: [{ entryId: f.anna, displayName: "Anna Andersson" }] });
    expect(await latest(f.bo)).toMatchObject({ status: "OK", card_number: "2001001", cause: "UNKNOWN_READOUT_RESOLUTION" });
    const { rows } = await pool.query<{ entry_id: string; card_number: string }>(
      "SELECT entry_id, card_number FROM card_assignment WHERE race_id=$1 AND active ORDER BY card_number", [f.raceId]);
    expect(rows).toEqual([{ entry_id: f.bo, card_number: "2001001" }, { entry_id: f.anna, card_number: "2001002" }]);
    // Anna läses ut med sin nya bricka: hennes resultat ersätts.
    await readOut(f.raceId, "2001002", "2026-12-09T19:45:00Z");
    expect(await latest(f.anna)).toMatchObject({ status: "OK", card_number: "2001002" });
    // Samma begäran igen ger samma kvitto; en ändrad begäran med samma id avvisas.
    expect(await changeEntryCardAsAdmin(db, input, now)).toEqual({ status: "changed", response: { ...swapped.response, replayed: true } });
    expect((await changeEntryCardAsAdmin(db, { ...input, request: { ...input.request, swapWith: undefined } }, now)).status).toBe("conflict");
    expect((await pool.query("SELECT 1 FROM audit_event WHERE race_id=$1 AND action='ENTRY_CARDS_SWAPPED_BY_ADMIN'", [f.raceId])).rowCount).toBe(1);
  });

  it("bytet avvisas om den andra löparen ändrats under tiden", async () => {
    const f = await fixture();
    const input = await cardRequest(f, f.anna, "2001002", f.bo);
    await pool.query("UPDATE entry SET version = version + 1 WHERE id=$1", [f.bo]);
    expect((await changeEntryCardAsAdmin(db, input, now)).status).toBe("conflict");
  });

  it("Byt bricka kopplar en okänd avläsning av den nya brickan och räknar resultatet", async () => {
    const f = await fixture();
    await readOut(f.raceId, "2001848", "2026-12-09T19:40:00Z");
    expect(await latest(f.cia)).toBeUndefined();
    const changed = await changeEntryCardAsAdmin(db, await cardRequest(f, f.cia, "2001848"), now);
    if (changed.status !== "changed") throw new Error(JSON.stringify(changed));
    expect(changed.response.linkedReadouts).toEqual([expect.objectContaining({ entryId: f.cia, cardNumber: "2001848", status: "OK" })]);
    expect(await latest(f.cia)).toMatchObject({ status: "OK", card_number: "2001848", cause: "UNKNOWN_READOUT_RESOLUTION" });
  });

  it("Ny deltagare kopplar en avläsning som redan finns, och brickans inaktiva historik hindrar inte", async () => {
    const f = await fixture();
    await readOut(f.raceId, "2001849", "2026-12-09T19:50:00Z");
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number,active) VALUES($1,$2,'2001849',false)", [f.raceId, f.cia]);
    const classes = await listEntryRegistrationClassesAsAdmin(db, f.admin, now);
    if (classes.status !== "ok") throw new Error("Klasserna saknas");
    const raceClass = classes.response.classes[0]!;
    const input = { ...f.admin, idempotencyKey: `entry-registration:${randomUUID()}`, request: { formatVersion: 1, classId: raceClass.id,
      expectedCourseVersionId: raceClass.courseVersionId, expectedStartRule: raceClass.startRule, givenName: "Efter", familyName: "Anmäld",
      organisationName: null, cardNumber: "2001849", fixedStartTime: null } };
    const registered = await registerEntryAsAdmin(db, input, now);
    if (registered.status !== "registered") throw new Error(JSON.stringify(registered));
    expect(registered.response.linkedReadout).toMatchObject({ cardNumber: "2001849", status: "OK" });
    expect(await latest(registered.response.entryId)).toMatchObject({ status: "OK", card_number: "2001849" });
    expect(await registerEntryAsAdmin(db, input, now)).toEqual({ status: "registered", response: { ...registered.response, replayed: true } });
  });
});
