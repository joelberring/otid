import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { consumeAccountRequestAllowance, loginUserAccount, throttleKeyHash, throttleSecret } from "../../src";
import { MAX_FAILED_ATTEMPTS_PER_CLIENT } from "../../src/user-account";
import { registerTestAccount, TEST_PASSWORD } from "./accounts";

/** PLAN.md steg 46: spärrarnas nycklar (HMAC med serverns hemlighet), rensning och inloggningsspärr per IP. Påhittade adresser. */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
// Lösenorden (scrypt) och många skrivningar tar tid när maskinen är belastad.
vi.setConfig({ testTimeout: 120_000 });

describe("steg 46: spärrarnas hash och inloggningen", () => {
  it("nyckeln är HMAC med serverns hemlighet, inte en osaltad SHA-256; gamla rader rensas vid skrivning", async () => {
    const secret = throttleSecret();
    expect(throttleSecret({ OTID_THROTTLE_SECRET: "egen-hemlighet", DATABASE_URL: "postgresql://x" })).toBe("egen-hemlighet");
    expect(throttleSecret({ DATABASE_URL: "postgresql://x" })).toContain("postgresql://x");
    const address = `203.0.113.${Math.floor(Math.random() * 250)}`;
    const now = new Date();
    expect(await db.transaction(tx => consumeAccountRequestAllowance(tx, { scope: "REGISTER_IP", key: address, limit: 5 }, now))).toBe(true);
    const plain = createHash("sha256").update(`REGISTER_IP\u0000${address}`).digest("hex");
    const stored = (await pool.query<{ key_hash: string }>("SELECT key_hash FROM account_request_throttle WHERE scope='REGISTER_IP' AND key_hash=$1",
      [throttleKeyHash("REGISTER_IP", address, secret)])).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.key_hash).not.toBe(plain);
    expect((await pool.query("SELECT 1 FROM account_request_throttle WHERE key_hash=$1", [plain])).rowCount).toBe(0);

    const stale = "a".repeat(63) + "b";
    await pool.query("INSERT INTO account_request_throttle(scope,key_hash,window_started_at,attempts) VALUES('RESET_IP',$1,$2,3) ON CONFLICT DO NOTHING",
      [stale, new Date(now.getTime() - 3 * 24 * 3_600_000)]);
    await pool.query("INSERT INTO user_account_login_throttle(login_key_hash,window_started_at,failed_attempts) VALUES($1,$2,2) ON CONFLICT DO NOTHING",
      [stale, new Date(now.getTime() - 3 * 24 * 3_600_000)]);
    await db.transaction(tx => consumeAccountRequestAllowance(tx, { scope: "REGISTER_IP", key: address, limit: 5 }, now));
    expect((await pool.query("SELECT 1 FROM account_request_throttle WHERE key_hash=$1", [stale])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM user_account_login_throttle WHERE login_key_hash=$1", [stale])).rowCount).toBe(0);
  });

  it("inloggningen spärras per IP efter många fel, oavsett konto, och spärren går ut", async () => {
    const victim = await registerTestAccount(db);
    const clientKey = `198.51.100.${Math.floor(Math.random() * 250)}`;
    const now = new Date();
    const login = (email: string, password: string, key = clientKey, at = now) =>
      loginUserAccount(db, { formatVersion: 1, email, password }, { now: at, clientKey: key });
    for (let index = 0; index < MAX_FAILED_ATTEMPTS_PER_CLIENT; index += 1) {
      expect((await login(`okand.${index}.${randomUUID().slice(0, 6)}@exempel.invalid`, "fel-lösen-1")).status).toBe("unauthorized");
    }
    // Rätt lösenord från samma adress spärras också; från en annan adress går det.
    expect((await login(victim.email, TEST_PASSWORD)).status).toBe("rate-limited");
    expect((await login(victim.email, TEST_PASSWORD, "192.0.2.10")).status).toBe("authenticated");
    // Spärren är tidsbegränsad (15 minuter).
    expect((await login(victim.email, TEST_PASSWORD, clientKey, new Date(now.getTime() + 16 * 60_000))).status).toBe("authenticated");
  });

  it("spärren per e-post är tidsbegränsad", async () => {
    const account = await registerTestAccount(db);
    const now = new Date();
    for (let index = 0; index < 5; index += 1) {
      await loginUserAccount(db, { formatVersion: 1, email: account.email, password: "fel-lösen-1" }, { now, clientKey: randomUUID() });
    }
    expect((await loginUserAccount(db, { formatVersion: 1, email: account.email, password: TEST_PASSWORD }, { now, clientKey: randomUUID() })).status)
      .toBe("rate-limited");
    expect((await loginUserAccount(db, { formatVersion: 1, email: account.email, password: TEST_PASSWORD },
      { now: new Date(now.getTime() + 16 * 60_000), clientKey: randomUUID() })).status).toBe("authenticated");
  });
});
