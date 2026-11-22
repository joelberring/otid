import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { selfRegisterCard, throttleKeyHash } from "../../src";
import { SELF_REGISTRATIONS_PER_RACE_AND_DAY } from "../../src/self-registration";
import { NOW, seedRace } from "./steg-25-fixtures";

/** Granskningen 2.5: tävlingens dagskvot för självregistrering dras bara när en anmälan faktiskt skapas. */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

const card = () => String(7_000_000 + Math.floor(Math.random() * 2_000_000));
const attempts = async (raceId: string) => Number((await pool.query<{ attempts: number }>(
  "SELECT attempts FROM account_request_throttle WHERE scope='SELF_REGISTRATION_RACE' AND key_hash=$1", [throttleKeyHash("SELF_REGISTRATION_RACE", raceId)])).rows[0]?.attempts ?? 0);

describe("granskning 2.5: självregistreringens dagskvot per tävling", () => {
  it("robotfällan, ogiltiga begäranden, upptagen bricka och full klass drar ingen kvot", async () => {
    const { ids } = await seedRace(db, pool);
    await pool.query("UPDATE race SET self_registration=true, published_at=$2, race_type='STANDARD' WHERE id=$1", [ids.race, NOW]);
    const register = (body: Record<string, unknown>) => selfRegisterCard(db, { raceId: ids.race, clientKey: randomUUID(), request: {
      formatVersion: 1, givenName: "Nils", familyName: "Ny", club: null, classId: ids.free, ...body } }, NOW);
    const taken = card();
    expect((await register({ cardNumber: taken })).status).toBe("ok");
    expect(await attempts(ids.race)).toBe(1);

    expect((await register({ cardNumber: card(), website: "http://spam.example" })).status).toBe("ok");
    expect((await register({ cardNumber: card(), givenName: "!!!" })).status).toBe("invalid-request");
    expect((await register({ cardNumber: card(), classId: undefined })).status).toBe("invalid-request");
    expect((await register({ cardNumber: taken })).status).toBe("card-taken");
    expect(await attempts(ids.race)).toBe(1);

    // Bara en plats kvar: en riktig anmälan tar den, nästa spärras.
    await pool.query("UPDATE account_request_throttle SET attempts=$2 WHERE scope='SELF_REGISTRATION_RACE' AND key_hash=$1",
      [throttleKeyHash("SELF_REGISTRATION_RACE", ids.race), SELF_REGISTRATIONS_PER_RACE_AND_DAY - 1]);
    expect((await register({ cardNumber: card(), website: "x" })).status).toBe("ok");
    expect((await register({ cardNumber: taken })).status).toBe("card-taken");
    expect((await register({ cardNumber: card() })).status).toBe("ok");
    expect((await register({ cardNumber: card() })).status).toBe("rate-limited");
  });
});
