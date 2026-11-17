import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createOrganizerEvent } from "../../src/organizer-events";
import { createTrainingGroup } from "../../src/training-groups";
import { GROUP_CODE_MISSES_PER_HOUR } from "../../src/training-group-public";
import { resolveJoinCode } from "../../src/join-code";
import { registerTestAccount, setRacePublished } from "./accounts";

/**
 * Översynen av startsidan 2026-11-17: "Har du en kod?" leder till tävlingen, festen eller gruppen. En opublicerad tävling
 * svarar som en okänd kod (utom för den som får förhandsvisa), och missarna delar gruppsidans spärr per IP-adress.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet av startsidans kodfält kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_startsidan_kod_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_startsidan_kod_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = Awaited<ReturnType<typeof registerTestAccount>>["proof"];

async function createRace(proof: Proof, eventName: string) {
  const created = await createOrganizerEvent(db, { ...proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName, raceName: "Torsdag", raceDate: "2026-11-19", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error(`Tävlingen kunde inte skapas: ${created.status}`);
  const raceId = created.response.raceId;
  const [race] = await db.select({ shortCode: schema.races.shortCode }).from(schema.races).where(eq(schema.races.id, raceId));
  return { raceId, shortCode: race!.shortCode };
}

const resolve = (code: string, options: { sessionToken?: string | null; clientKey?: string } = {}) =>
  resolveJoinCode(db, { code, sessionToken: options.sessionToken ?? null, clientKey: options.clientKey ?? `ip-${randomUUID()}` });

describe("startsidans kodfält", () => {
  it("leder till tävlingen, festen och gruppen, också från en hel adress med versaler", async () => {
    const owner = await registerTestAccount(db);
    const race = await createRace(owner.proof, "Kodtävlingen");
    await setRacePublished(db, owner.proof, race.raceId, true);
    expect(await resolve(race.shortCode)).toEqual({ status: "found", target: { kind: "race", code: race.shortCode } });
    expect(await resolve(` https://otid.berring.se/t/${race.shortCode.toUpperCase()} `))
      .toEqual({ status: "found", target: { kind: "race", code: race.shortCode } });

    const party = await createRace(owner.proof, "Kodfesten");
    await db.update(schema.races).set({ raceType: "PARTY" }).where(eq(schema.races.id, party.raceId));
    await setRacePublished(db, owner.proof, party.raceId, true);
    expect(await resolve(party.shortCode)).toEqual({ status: "found", target: { kind: "party", code: party.shortCode } });

    const group = await createTrainingGroup(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Ungdom", code: "ungdom" } });
    if (group.status !== "created") throw new Error(`Gruppen skapades inte: ${group.status}`);
    expect(await resolve(`otid.berring.se/g/${group.group.code.toUpperCase()}`))
      .toEqual({ status: "found", target: { kind: "group", code: group.group.code } });
  });

  it("en opublicerad tävling är som en okänd kod, utom för den som får förhandsvisa", async () => {
    const owner = await registerTestAccount(db);
    const stranger = await registerTestAccount(db);
    const race = await createRace(owner.proof, "Hemlig");
    expect(await resolve(race.shortCode)).toEqual({ status: "not-found" });
    expect(await resolve(race.shortCode, { sessionToken: stranger.proof.sessionToken })).toEqual({ status: "not-found" });
    expect(await resolve(race.shortCode, { sessionToken: owner.proof.sessionToken }))
      .toEqual({ status: "found", target: { kind: "race", code: race.shortCode } });
    expect(await resolve("zzzzzz")).toEqual({ status: "not-found" });
    expect(await resolve("inte en kod alls!")).toEqual({ status: "not-found" });
  });

  it("missar delar gruppsidans spärr per IP-adress; därefter svarar också en riktig kod 'för många försök'", async () => {
    const owner = await registerTestAccount(db);
    const race = await createRace(owner.proof, "Spärren");
    await setRacePublished(db, owner.proof, race.raceId, true);
    const clientKey = `ip-${randomUUID()}`;
    for (let index = 0; index < GROUP_CODE_MISSES_PER_HOUR; index += 1) {
      expect((await resolve(`gissning-${index}-abcdefgh`, { clientKey })).status).toBe("not-found");
    }
    expect(await resolve(race.shortCode, { clientKey })).toEqual({ status: "rate-limited" });
    expect((await resolve(race.shortCode, { clientKey: `${clientKey}-annan` })).status).toBe("found");
    // En träff räknas inte som en miss.
    const other = `ip-${randomUUID()}`;
    for (let index = 0; index < GROUP_CODE_MISSES_PER_HOUR + 5; index += 1) expect((await resolve(race.shortCode, { clientKey: other })).status).toBe("found");
  });
});
