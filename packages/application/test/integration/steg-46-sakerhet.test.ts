import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import {
  changePartyAsAdmin, getPublicStartList, previewSelfRegistrationCleanupAsAdmin, readPartyAsAdmin, readPublicParty, selfRegisterCard,
  setPartyGuestAsAdmin, strikeSelfRegisteredAsAdmin, throttleKeyHash
} from "../../src";
import { SELF_REGISTRATIONS_PER_RACE_AND_DAY } from "../../src/self-registration";
import { auth, ingest, NOW, run, seedRace } from "./steg-25-fixtures";

/** PLAN.md steg 46: rättelser efter genomlysningen, säkerhet och integritet. Påhittade namn, adresser och brickor. */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
// Lösenorden (scrypt) och många skrivningar tar tid när maskinen är belastad.
vi.setConfig({ testTimeout: 120_000 });

const card = () => String(7_000_000 + Math.floor(Math.random() * 2_000_000));

async function openRace(party = false) {
  const seeded = await seedRace(db, pool);
  await pool.query("UPDATE race SET self_registration=true, published_at=$2, race_type=$3, start_list_live=true WHERE id=$1",
    [seeded.ids.race, NOW, party ? "PARTY" : "STANDARD"]);
  return seeded;
}

function register(raceId: string, body: Record<string, unknown>, clientKey = randomUUID(), now = NOW) {
  return selfRegisterCard(db, { raceId, clientKey, request: { formatVersion: 1, givenName: "Sigge", familyName: "Själv", club: null, ...body } }, now);
}

describe("steg 46: fest – namn på den publika sidan", () => {
  it("en ny fest visar inga namn; en sparad inställning gäller och behålls", async () => {
    const { ids } = await openRace(true);
    const admin = await auth(db, ids.race, "ADMIN");
    const number = card();
    await ingest(db, ids.race, [run(number, "11:00:00", 20)]);
    expect((await register(ids.race, { cardNumber: number, givenName: "Påhitta", familyName: "Festsson", displayName: "Hitta" })).status).toBe("ok");
    const state = await readPartyAsAdmin(db, admin, NOW);
    expect(state.status === "ok" && state.response.showPublicNames).toBe(false);
    const anonymous = await readPublicParty(db, ids.race, NOW);
    expect(anonymous?.showNames).toBe(false);
    expect(JSON.stringify(anonymous)).not.toMatch(/Hitta|Påhitta|Festsson/);

    const change = (showPublicNames: boolean) => changePartyAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(),
      change: { kind: "settings", startsAt: "2026-09-19T08:00:00.000Z", showPublicNames, doublePunchSeconds: 5 } } }, NOW);
    expect((await change(true)).status).toBe("ok");
    expect((await readPublicParty(db, ids.race, NOW))?.showNames).toBe(true);
    // En befintlig fest med sparat val (här på) behåller det, oavsett förvalet.
    const [row] = await db.select().from(schema.partySettings).where(eq(schema.partySettings.raceId, ids.race));
    expect(row?.showPublicNames).toBe(true);
  });

  it("bardiskens namn och klubb normaliseras som i självregistreringen", async () => {
    const { ids } = await openRace(true);
    const functionary = await auth(db, ids.race, "FUNCTIONARY");
    const number = card();
    const save = (name: string, club: string | null) => setPartyGuestAsAdmin(db, { ...functionary,
      request: { formatVersion: 1, cardNumber: number, name, club } }, NOW);
    expect(await save("  Festa\u0000  <b>Påhittsson</b> ", " Påhittade\tOK ")).toEqual({ status: "ok" });
    const [guest] = await db.select().from(schema.partyGuests).where(eq(schema.partyGuests.cardNumber, number));
    expect(guest).toMatchObject({ name: "Festa b Påhittsson b", club: "Påhittade OK" });
    expect(await save("!!!", null)).toEqual({ status: "invalid-request" });
  });
});

describe("steg 46: självregistrerade i tävling", () => {
  it("märks i den publika startlistan; dygnsgränsen är 100", async () => {
    expect(SELF_REGISTRATIONS_PER_RACE_AND_DAY).toBe(100);
    const { ids } = await openRace();
    expect((await register(ids.race, { cardNumber: card(), classId: ids.free, givenName: "Sigrid" })).status).toBe("ok");
    const list = await getPublicStartList(db, ids.race, NOW);
    if (list.status !== "published") throw new Error("Startlistan saknas");
    const entries = list.response.content.classes.flatMap(row => row.entries);
    expect(entries.find(row => row.displayName === "Sigrid Själv")?.selfRegistered).toBe(true);
    expect(entries.find(row => row.displayName === "Ada Ek")).not.toHaveProperty("selfRegistered");

    // Gränsen per tävling och dygn: rad 100 går, rad 101 spärras.
    const updated = await pool.query("UPDATE account_request_throttle SET attempts=$2 WHERE scope='SELF_REGISTRATION_RACE' AND key_hash=$1",
      [throttleKeyHash("SELF_REGISTRATION_RACE", ids.race), SELF_REGISTRATIONS_PER_RACE_AND_DAY - 1]);
    expect(updated.rowCount).toBe(1);
    expect((await register(ids.race, { cardNumber: card(), classId: ids.free })).status).toBe("ok");
    expect(await register(ids.race, { cardNumber: card(), classId: ids.free })).toEqual({ status: "rate-limited" });
  });

  it("stryk alla självregistrerade som inte läst ut: förhandsvisning, bara de bekräftade, en gång", async () => {
    const { ids } = await openRace();
    const admin = await auth(db, ids.race, "ADMIN");
    const [ran, idle, late] = [card(), card(), card()];
    expect((await register(ids.race, { cardNumber: ran, classId: ids.free, givenName: "Läste" })).status).toBe("ok");
    expect((await register(ids.race, { cardNumber: idle, classId: ids.free, givenName: "Spam" })).status).toBe("ok");
    await ingest(db, ids.race, [run(ran, "11:00:00", 30)]);

    const preview = await previewSelfRegistrationCleanupAsAdmin(db, admin, NOW);
    if (preview.status !== "ok") throw new Error(preview.status);
    expect(preview.response.entries.map(row => [row.name, row.cardNumber])).toEqual([["Spam Själv", idle]]);
    // Funktionären får inte.
    expect((await previewSelfRegistrationCleanupAsAdmin(db, await auth(db, ids.race, "FUNCTIONARY"), NOW)).status).toBe("forbidden");

    // Någon registrerar sig efter förhandsvisningen: den strykes inte, eftersom arrangören inte såg den.
    expect((await register(ids.race, { cardNumber: late, classId: ids.free, givenName: "Sen" })).status).toBe("ok");
    const requestId = randomUUID();
    const request = { formatVersion: 1, requestId, entryIds: [...preview.response.entries.map(row => row.entryId), ids.ada] };
    const strike = () => strikeSelfRegisteredAsAdmin(db, { ...admin, idempotencyKey: `self-registration-cleanup:${requestId}`, request }, NOW);
    const first = await strike();
    if (first.status !== "saved") throw new Error(first.status);
    expect(first.response).toMatchObject({ replayed: false, struckEntryIds: [preview.response.entries[0]!.entryId], skippedCount: 1 });
    const again = await strike();
    expect(again.status === "saved" && again.response).toMatchObject({ replayed: true, struckEntryIds: [preview.response.entries[0]!.entryId] });

    const rows = (await pool.query<{ given_name: string; struck: boolean; active: boolean }>(`SELECT e.given_name, e.struck_at IS NOT NULL AS struck,
      EXISTS(SELECT 1 FROM card_assignment c WHERE c.entry_id=e.id AND c.active) AS active FROM entry e WHERE e.race_id=$1
      AND e.given_name IN ('Läste','Spam','Sen','Ada') ORDER BY e.given_name`, [ids.race])).rows;
    expect(rows).toEqual([{ given_name: "Ada", struck: false, active: true }, { given_name: "Läste", struck: false, active: true },
      { given_name: "Sen", struck: false, active: true }, { given_name: "Spam", struck: true, active: false }]);
    const audit = (await pool.query("SELECT action, after FROM audit_event WHERE race_id=$1 AND request_id=$2", [ids.race, requestId])).rows;
    expect(audit).toEqual([{ action: "ENTRY_STRUCK_BY_ADMIN", after: { outcome: "STRUCK", source: "SELF_REGISTRATION_CLEANUP" } }]);
    // Fel nyckel ger ogiltig begäran.
    expect((await strikeSelfRegisteredAsAdmin(db, { ...admin, idempotencyKey: "self-registration-cleanup:fel", request }, NOW)).status)
      .toBe("invalid-request");
  });
});
