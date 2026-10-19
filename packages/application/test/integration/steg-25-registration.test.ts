import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { registerReadoutCard } from "../../src/readout-registration";
import { listUnknownReadoutResolutionCandidatesAsAdmin } from "../../src/unknown-readout-resolution";
import { auth, ingest, NOW, run, seedRace } from "./steg-25-fixtures";

/**
 * PLAN.md steg 25 punkt 2: direktanmälan av okänd bricka från avläsningssidan, även offline. Avläsningen och anmälan kan
 * komma till servern i vilken ordning som helst; en bricka som anmälts någon annanstans under tiden gäller.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

function request(raceId: string, classId: string, cardNumber: string, name = { givenName: "Nils", familyName: "Ny" }) {
  const requestId = randomUUID();
  return { idempotencyKey: `readout-registration:${requestId}`, request: { formatVersion: 1 as const, requestId, cardNumber, classId,
    ...name, organisationName: null } };
}

/** Löparens revisioner: orsak, status och om de bygger på en avläsning. */
async function revisions(entryId: string) {
  return (await pool.query<{ cause: string; status: string; from_readout: boolean }>(
    "SELECT cause,status,readout_id IS NOT NULL AS from_readout FROM result_revision WHERE entry_id=$1 ORDER BY revision", [entryId])).rows;
}

describe("direktanmälan på avläsningssidan (PLAN.md steg 25)", () => {
  it("offline: anmälan först, sedan avläsningen – avläsningen bedöms mot den nya löparen som vanligt", async () => {
    const { ids } = await seedRace(db, pool);
    const functionary = await auth(db, ids.race, "FUNCTIONARY");
    const card = "7900101";
    const registration = request(ids.race, ids.free, card);
    const first = await registerReadoutCard(db, { ...functionary, ...registration }, NOW);
    if (first.status !== "registered") throw new Error(first.status);
    expect(first.response).toMatchObject({ outcome: "CREATED", entryName: "Nils Ny", className: "Öppen", linkedResult: null });
    const [ack] = await ingest(db, ids.race, [run(card, "11:00:00", 30)]);
    expect(ack).toMatchObject({ status: "stored", serverResult: { status: "OK" } });
    expect(await revisions(first.response.entryId)).toEqual([{ cause: "CARD_READOUT", status: "OK", from_readout: true }]);
    // Samma begäran igen (kön skickar om efter ett tappat svar): samma kvitto, ingen ny deltagare.
    const replay = await registerReadoutCard(db, { ...functionary, ...registration }, NOW);
    expect(replay).toEqual({ status: "registered", response: { ...first.response, replayed: true } });
    expect((await pool.query("SELECT 1 FROM entry WHERE race_id=$1 AND given_name='Nils'", [ids.race])).rowCount).toBe(1);
    expect((await pool.query("SELECT action FROM audit_event WHERE request_id=$1", [registration.request.requestId])).rows)
      .toEqual([{ action: "READOUT_CARD_REGISTERED" }]);
  });

  it("avläsningen först (okänd bricka), sedan anmälan – servern bedömer avläsningen mot löparen", async () => {
    const { ids, admin } = await seedRace(db, pool);
    const card = "7900102";
    const [ack] = await ingest(db, ids.race, [run(card, "11:00:00", 30)]);
    expect(ack).toMatchObject({ serverResult: { status: "UNKNOWN_CARD" } });
    const listed = await listUnknownReadoutResolutionCandidatesAsAdmin(db, admin, NOW);
    expect(listed.status === "ok" && listed.response.readouts.map((row) => row.cardNumber)).toEqual([card]);
    const registered = await registerReadoutCard(db, { ...await auth(db, ids.race, "FUNCTIONARY"), ...request(ids.race, ids.free, card) }, NOW);
    if (registered.status !== "registered") throw new Error(registered.status);
    expect(registered.response).toMatchObject({ outcome: "CREATED", linkedResult: { status: "OK", revision: 1 } });
    expect(await revisions(registered.response.entryId)).toEqual([{ cause: "UNKNOWN_READOUT_RESOLUTION", status: "OK", from_readout: true }]);
    // Avläsningen är inte längre okänd, och den ursprungliga observationen är orörd.
    const after = await listUnknownReadoutResolutionCandidatesAsAdmin(db, admin, NOW);
    expect(after.status === "ok" && after.response.readouts).toEqual([]);
    expect((await pool.query("SELECT server_result->>'status' AS status FROM device_ingest_outcome o JOIN card_readout c ON c.raw_message_id=o.raw_message_id WHERE c.race_id=$1 AND c.card_number=$2", [ids.race, card])).rows)
      .toEqual([{ status: "UNKNOWN_CARD" }]);
  });

  it("brickan anmäld någon annanstans under tiden: ingen ny deltagare, den anmälan gäller", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    // Ada har brickan; avläsningspaketet på enheten var gammalt och visade den som okänd.
    const [ack] = await ingest(db, ids.race, [run(cards.ada, "10:02:00", 40)]);
    expect(ack).toMatchObject({ serverResult: { status: "OK" } });
    const registered = await registerReadoutCard(db, { ...admin, ...request(ids.race, ids.free, cards.ada) }, NOW);
    if (registered.status !== "registered") throw new Error(registered.status);
    expect(registered.response).toMatchObject({ outcome: "EXISTING", entryId: ids.ada, entryName: "Ada Ek", className: "H21", linkedResult: null });
    expect((await pool.query("SELECT 1 FROM entry WHERE race_id=$1 AND given_name='Nils'", [ids.race])).rowCount).toBe(0);
    expect(await revisions(ids.ada)).toHaveLength(1);
  });

  it("anmäld någon annanstans efter den okända avläsningen: avläsningen bedöms mot den deltagaren", async () => {
    const { ids } = await seedRace(db, pool);
    const card = "7900104";
    await ingest(db, ids.race, [run(card, "11:00:00", 30)]);
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,$3)", [ids.race, ids.eva, card]);
    const registered = await registerReadoutCard(db, { ...await auth(db, ids.race, "FUNCTIONARY"), ...request(ids.race, ids.free, card) }, NOW);
    if (registered.status !== "registered") throw new Error(registered.status);
    expect(registered.response).toMatchObject({ outcome: "EXISTING", entryId: ids.eva, linkedResult: { status: "OK" } });
    expect(await revisions(ids.eva)).toEqual([{ cause: "UNKNOWN_READOUT_RESOLUTION", status: "OK", from_readout: true }]);
  });

  it("full klass avvisas; en ändrad begäran med samma id är en konflikt", async () => {
    const { ids, admin } = await seedRace(db, pool);
    await pool.query("UPDATE class SET max_entries=3 WHERE id=$1", [ids.free]);
    expect((await registerReadoutCard(db, { ...admin, ...request(ids.race, ids.free, "7900105") }, NOW)).status).toBe("conflict");
    await pool.query("UPDATE class SET max_entries=NULL WHERE id=$1", [ids.free]);
    const registration = request(ids.race, ids.free, "7900105");
    expect((await registerReadoutCard(db, { ...admin, ...registration }, NOW)).status).toBe("registered");
    expect((await registerReadoutCard(db, { ...admin, ...registration, request: { ...registration.request, givenName: "Annan" } }, NOW)).status)
      .toBe("conflict");
    expect((await registerReadoutCard(db, { ...admin, ...registration, idempotencyKey: "readout-registration:fel" }, NOW)).status)
      .toBe("invalid-request");
  });
});
