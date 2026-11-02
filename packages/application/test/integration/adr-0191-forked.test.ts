import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";

/**
 * ADR-0191 beslut 5: steg två för FORKED (ADR-0188 beslut 5, ADR-0185 beslut 1). Migration 0047 skriver om befintliga
 * tävlingar med FORKED till STANDARD; journalen över skapade tävlingar behåller begäran som den kom, och värdet finns kvar i
 * databasens tillåtna värden (steg tre i en senare driftsättning).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0191-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0191_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const migrations = new URL("../../../database/migrations", import.meta.url);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: migrations.pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0191_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function race(raceType: string): Promise<string> {
  const account = await registerUserAccount(db, { formatVersion: 1, email: `forked.${randomUUID().slice(0, 8)}@test.o-tid.se`,
    displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const created = await createOrganizerEvent(db, { sessionToken: account.sessionToken, csrfCookie: account.csrfToken,
    csrfHeader: account.csrfToken, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Gafflad klubbtävling", raceName: "", raceDate: "2027-10-07",
      timeZone: "Europe/Stockholm", raceType }) });
  if (created.status !== "created") throw new Error(created.status);
  return created.response.raceId;
}

describe("ADR-0191 beslut 5: migration 0047 skriver om FORKED till STANDARD", () => {
  it("skriver om tävlingarna men inte journalen, och värdet är fortfarande tillåtet", async () => {
    const forked = await race("FORKED"), training = await race("TRAINING");
    // En tävling från före ADR-0188 (då FORKED sparades som det var).
    await pool.query("update race set race_type = 'FORKED' where id = $1", [forked]);
    await pool.query(await readFile(new URL("0047_forked_till_standard.sql", `${migrations.href}/`), "utf8"));
    const types = await pool.query<{ id: string; race_type: string }>("select id, race_type from race where id = any($1)", [[forked, training]]);
    expect(Object.fromEntries(types.rows.map(row => [row.id, row.race_type]))).toEqual({ [forked]: "STANDARD", [training]: "TRAINING" });
    expect((await pool.query("select 1 from race where race_type = 'FORKED'")).rowCount).toBe(0);
    // Journalen sparar begäran som den kom (omsändning jämförs med den).
    const journal = await pool.query<{ race_type: string }>("select race_type from user_account_event_creation_request where race_id = $1", [forked]);
    expect(journal.rows[0]!.race_type).toBe("FORKED");
    // Steg tre (senare driftsättning): värdet tas bort ur race_type_check. Än så länge går det att skriva.
    await expect(pool.query("update race set race_type = 'FORKED' where id = $1", [forked])).resolves.toBeDefined();
  });
});
