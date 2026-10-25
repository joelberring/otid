import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { changePartyAsAdmin, readPartyAsAdmin, readPublicParty, readSelfRegistrationInfo, selfRegisterCard, setPartyGuestAsAdmin } from "../../src";
import { auth, ingest, NOW, RACE_DATE, run, seedRace } from "./steg-25-fixtures";

/**
 * PLAN.md steg 41: självregistrering på tävlingsdagen, utan inloggning. Påhittade namn och bricknummer.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

const card = () => String(7_000_000 + Math.floor(Math.random() * 2_000_000));

async function openRace(options: { party?: boolean; enabled?: boolean; published?: boolean } = {}) {
  const seeded = await seedRace(db, pool);
  await pool.query("UPDATE race SET self_registration=$2, published_at=$3, race_type=$4 WHERE id=$1", [seeded.ids.race,
    options.enabled ?? true, options.published === false ? null : NOW, options.party ? "PARTY" : "STANDARD"]);
  return seeded;
}

function register(raceId: string, body: Record<string, unknown>, options: { now?: Date; clientKey?: string } = {}) {
  return selfRegisterCard(db, { raceId, clientKey: options.clientKey ?? randomUUID(), request: { formatVersion: 1, givenName: "Nils",
    familyName: "Ny", club: null, ...body } }, options.now ?? NOW);
}

describe("självregistrering på tävlingsdagen (PLAN.md steg 41)", () => {
  it("tävling: på tävlingsdagen skapas en deltagare i vald klass med brickan, märkt som självregistrerad, med auditpost utan IP", async () => {
    const { ids } = await openRace();
    const info = await readSelfRegistrationInfo(db, ids.race, NOW);
    expect(info).toMatchObject({ open: true, kind: "RACE" });
    expect(info?.classes.map(row => row.name)).toEqual(["H21", "Öppen"]);
    const number = card();
    const result = await register(ids.race, { cardNumber: number, classId: ids.free, givenName: "  nils ", familyName: "Ny<script>", club: "OK Påhitt" },
      { clientKey: "203.0.113.7" });
    expect(result).toEqual({ status: "ok", response: { formatVersion: 1, cardNumber: number, name: "nils Ny script", className: "Öppen" } });
    const entry = (await pool.query<{ id: string }>("SELECT e.id, e.given_name, e.organisation_name, e.self_registered_at IS NOT NULL AS self FROM entry e " +
      "JOIN card_assignment c ON c.entry_id=e.id AND c.active WHERE c.race_id=$1 AND c.card_number=$2", [ids.race, number])).rows[0]!;
    expect(entry).toMatchObject({ given_name: "nils", organisation_name: "OK Påhitt", self: true });
    const audit = (await pool.query("SELECT action, actor_kind, after FROM audit_event WHERE entity_id=$1", [entry.id])).rows;
    expect(audit).toMatchObject([{ action: "ENTRY_SELF_REGISTERED", actor_kind: null, after: { source: "PUBLIC_SELF_REGISTRATION" } }]);
    expect(JSON.stringify(audit)).not.toContain("203.0.113.7");
  });

  it("dagen före och dagen efter avvisas; avstängd inställning avvisas; opublicerat lopp ger not-found", async () => {
    const { ids } = await openRace();
    const dayBefore = new Date(`2026-09-18T12:00:00Z`), dayAfter = new Date(`2026-09-20T12:00:00Z`);
    expect(await register(ids.race, { cardNumber: card(), classId: ids.free }, { now: dayBefore })).toEqual({ status: "closed" });
    expect(await register(ids.race, { cardNumber: card(), classId: ids.free }, { now: dayAfter })).toEqual({ status: "closed" });
    expect((await readSelfRegistrationInfo(db, ids.race, dayAfter))?.open).toBe(false);
    // Midnatt i tävlingens tidszon: 22:30 UTC dagen före är 00:30 svensk tid på tävlingsdagen.
    expect((await register(ids.race, { cardNumber: card(), classId: ids.free }, { now: new Date("2026-09-18T22:30:00Z") })).status).toBe("ok");
    const off = await openRace({ enabled: false });
    expect(await register(off.ids.race, { cardNumber: card(), classId: off.ids.free })).toEqual({ status: "closed" });
    const hidden = await openRace({ published: false });
    expect(await register(hidden.ids.race, { cardNumber: card(), classId: hidden.ids.free })).toEqual({ status: "not-found" });
    expect(await readSelfRegistrationInfo(db, hidden.ids.race, NOW)).toBeUndefined();
  });

  it("upptagen bricka avvisas och ingenting skrivs över", async () => {
    const { ids } = await openRace();
    const evas = card();
    await pool.query("INSERT INTO card_assignment(race_id,entry_id,card_number) VALUES($1,$2,$3)", [ids.race, ids.eva, evas]);
    expect(await register(ids.race, { cardNumber: evas, classId: ids.free, givenName: "Annan" })).toEqual({ status: "card-taken" });
    const owner = (await pool.query("SELECT e.given_name FROM entry e JOIN card_assignment c ON c.entry_id=e.id AND c.active " +
      "WHERE c.race_id=$1 AND c.card_number=$2", [ids.race, evas])).rows;
    expect(owner).toEqual([{ given_name: "Eva" }]);
    const number = card();
    expect((await register(ids.race, { cardNumber: number, classId: ids.free })).status).toBe("ok");
    expect(await register(ids.race, { cardNumber: number, classId: ids.fixed, givenName: "Igen" })).toEqual({ status: "card-taken" });
  });

  it("okänd avläsning på brickan bedöms direkt mot den nya deltagaren", async () => {
    const { ids } = await openRace();
    const number = card();
    const [ack] = await ingest(db, ids.race, [run(number, "11:00:00", 30)]);
    expect(ack).toMatchObject({ serverResult: { status: "UNKNOWN_CARD" } });
    expect((await register(ids.race, { cardNumber: number, classId: ids.free })).status).toBe("ok");
    const revisions = (await pool.query("SELECT r.cause, r.status FROM result_revision r JOIN card_assignment c ON c.entry_id=r.entry_id " +
      "WHERE c.race_id=$1 AND c.card_number=$2", [ids.race, number])).rows;
    expect(revisions).toEqual([{ cause: "UNKNOWN_READOUT_RESOLUTION", status: "OK" }]);
  });

  it("fest: okänd gäst (avläst utan namn) får namn, en namngiven gäst skrivs inte över, natten efter är öppen till kl 06", async () => {
    const { ids } = await openRace({ party: true });
    const admin = await auth(db, ids.race, "ADMIN");
    expect(await readSelfRegistrationInfo(db, ids.race, NOW)).toMatchObject({ open: true, kind: "PARTY", classes: [] });
    const number = card();
    await ingest(db, ids.race, [run(number, "11:00:00", 30)]);
    expect(await register(ids.race, { cardNumber: number, givenName: "Gun", familyName: "Gäst" }))
      .toEqual({ status: "ok", response: { formatVersion: 1, cardNumber: number, name: "Gun Gäst", displayName: "Gun G" } });
    const state = await readPartyAsAdmin(db, admin, NOW);
    expect(state.status === "ok" && state.response.guests.find(guest => guest.cardNumber === number)).toMatchObject({ name: "Gun Gäst" });
    expect(await register(ids.race, { cardNumber: number, givenName: "Annan" })).toEqual({ status: "card-taken" });
    expect((await pool.query("SELECT name, self_registered_at IS NOT NULL AS self FROM party_guest WHERE race_id=$1 AND card_number=$2",
      [ids.race, number])).rows).toEqual([{ name: "Gun Gäst", self: true }]);
    // Visningsnamnet: valt smeknamn, normaliserat, högst 40 tecken. Det publika kontraktet har aldrig fullt namn.
    const nick = card();
    await ingest(db, ids.race, [run(nick, "11:10:00", 30)]);
    expect(await register(ids.race, { cardNumber: nick, givenName: "Oskar", familyName: "Karlberg", displayName: " Oskar  K! " }))
      .toMatchObject({ status: "ok", response: { displayName: "Oskar K" } });
    expect(await register(ids.race, { cardNumber: card(), displayName: "x".repeat(41) }))
      .toEqual({ status: "invalid-request", fields: ["displayName"] });
    const published = JSON.stringify(await readPublicParty(db, ids.race, NOW));
    expect(published).toContain("Gun G");
    expect(published).toContain("Oskar K");
    expect(published).not.toMatch(/Gäst|Karlberg/);
    // 01:30 svensk tid natten efter: öppet. 12:00 dagen efter: stängt.
    expect((await register(ids.race, { cardNumber: card() }, { now: new Date("2026-09-19T23:30:00Z") })).status).toBe("ok");
    expect(await register(ids.race, { cardNumber: card() }, { now: new Date("2026-09-20T10:00:00Z") })).toEqual({ status: "closed" });
  });

  it("spärr per IP, fälla mot robotar, ogiltiga fält", async () => {
    const { ids } = await openRace({ party: true });
    const clientKey = `198.51.100.${Math.floor(Math.random() * 250)}`;
    for (let index = 0; index < 20; index += 1) {
      expect((await register(ids.race, { cardNumber: card() }, { clientKey })).status).toBe("ok");
    }
    expect(await register(ids.race, { cardNumber: card() }, { clientKey })).toEqual({ status: "rate-limited" });
    expect((await register(ids.race, { cardNumber: card() }, { clientKey, now: new Date(NOW.getTime() + 11 * 60_000) })).status).toBe("ok");
    const trapped = card();
    expect((await register(ids.race, { cardNumber: trapped, website: "https://exempel.invalid" })).status).toBe("ok");
    expect((await pool.query("SELECT 1 FROM party_guest WHERE race_id=$1 AND card_number=$2", [ids.race, trapped])).rowCount).toBe(0);
    expect(await register(ids.race, { cardNumber: "12a" })).toMatchObject({ status: "invalid-request", fields: ["cardNumber"] });
    expect(await register(ids.race, { cardNumber: "10000000" })).toMatchObject({ status: "invalid-request" });
    expect(await register(ids.race, { cardNumber: card(), givenName: "!!!" })).toEqual({ status: "invalid-request", fields: ["givenName"] });
    expect(await register(ids.race, { cardNumber: card(), givenName: "x".repeat(61) })).toEqual({ status: "invalid-request", fields: ["givenName"] });
    expect(RACE_DATE).toBe("2026-09-19");
  });

  it("steg 44: en festpinne som redan har köp men saknar namn namnges inte via formuläret, men i bardisken", async () => {
    const { ids } = await openRace({ party: true });
    const admin = await auth(db, ids.race, "ADMIN");
    const change = (value: Record<string, unknown>) => changePartyAsAdmin(db, { ...admin, request: { formatVersion: 1,
      requestId: randomUUID(), change: value } }, NOW);
    expect((await change({ kind: "settings", startsAt: `${RACE_DATE}T00:00:00.000Z`, showPublicNames: true, doublePunchSeconds: 5 })).status)
      .toBe("ok");
    expect((await change({ kind: "item-add", code: 31, name: "Öl", priceOre: 4_000 })).status).toBe("ok");
    const number = card();
    await ingest(db, ids.race, [run(number, "11:00:00", 30)]);
    expect(await register(ids.race, { cardNumber: number, givenName: "Någon", familyName: "Annan" }))
      .toEqual({ status: "card-has-purchases" });
    expect((await pool.query("SELECT 1 FROM party_guest WHERE race_id=$1 AND card_number=$2", [ids.race, number])).rowCount).toBe(0);
    // Personalen i bardisken namnger pinnen som förut.
    const functionary = await auth(db, ids.race, "FUNCTIONARY");
    expect((await setPartyGuestAsAdmin(db, { ...functionary, request: { formatVersion: 1, cardNumber: number, name: "Gun Gäst",
      club: null } }, NOW)).status).toBe("ok");
    // En pinne utan köp går fortfarande att registrera.
    expect((await register(ids.race, { cardNumber: card() })).status).toBe("ok");
  });
});
