import { describe, expect, it, vi } from "vitest";
import { createDatabase, isTransactionConflict, OutsideTransactionWork, retryTopLevelTransactions } from "../src/index";

/** Översynen 2026-11-02: poolens transaktioner görs om vid 40001 och 40P01. */
describe("transaktioner som PostgreSQL avbröt", () => {
  function fake(codes: readonly (string | undefined)[]) {
    let calls = 0;
    const db = { transaction: async (run: (tx: string) => Promise<string>) => {
      const code = codes[calls++];
      if (code) throw Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("pg"), { code }) });
      return run("tx");
    } };
    retryTopLevelTransactions(db as never);
    return { db, calls: () => calls };
  }

  it("gör om 40P01 och 40001, högst tre försök", async () => {
    const ok = fake(["40P01", "40001"]);
    expect(await ok.db.transaction(async (tx) => `klar ${tx}`)).toBe("klar tx");
    expect(ok.calls()).toBe(3);
    const stuck = fake(["40P01", "40P01", "40P01", "40P01"]);
    await expect(stuck.db.transaction(async () => "aldrig")).rejects.toThrow("Failed query");
    expect(stuck.calls()).toBe(3);
  });

  it("gör inte om andra fel", async () => {
    const other = fake(["23505"]);
    await expect(other.db.transaction(async () => "aldrig")).rejects.toThrow();
    expect(other.calls()).toBe(1);
    expect(isTransactionConflict({ code: "23505" })).toBe(false);
  });

  it("kör arbete utanför transaktionen och gör sedan om den (granskningen runda 2, A)", async () => {
    const log: string[] = [];
    let uploaded = false;
    const db = { transaction: async (run: (tx: string) => Promise<string>) => {
      log.push("begin");
      try { const result = await run("tx"); log.push("commit"); return result; } catch (error) { log.push("rollback"); throw error; }
    } };
    retryTopLevelTransactions(db as never);
    const result = await db.transaction(async () => {
      if (!uploaded) throw new OutsideTransactionWork(async () => { log.push("upload"); uploaded = true; });
      return "sparad";
    });
    expect(result).toBe("sparad");
    expect(log).toEqual(["begin", "rollback", "upload", "begin", "commit"]);
  });

  it("ett fel i arbetet utanför går vidare, och arbetet begärs inte i all oändlighet", async () => {
    const db = { transaction: async (run: (tx: string) => Promise<string>) => run("tx") };
    retryTopLevelTransactions(db as never);
    await expect(db.transaction(async () => { throw new OutsideTransactionWork(async () => { throw new Error("nätet är borta"); }); }))
      .rejects.toThrow("nätet är borta");
    let rounds = 0;
    await expect(db.transaction(async () => { throw new OutsideTransactionWork(async () => { rounds += 1; }); }))
      .rejects.toThrow("för många gånger");
    expect(rounds).toBe(6);
  });
});

describe("createDatabase pool-härdning", () => {
  it("fångar vilande poolfel utan unhandled error och skickar vidare tidsgränser", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { pool } = createDatabase("postgresql://test:test@127.0.0.1:1/test", {
      max: 5,
      connectionTimeoutMillis: 8_000,
      idleInTransactionTimeoutMs: 60_000,
      applicationName: "otid-test"
    });
    try {
      expect(pool.listenerCount("error")).toBeGreaterThanOrEqual(1);
      expect(pool.options.connectionTimeoutMillis).toBe(8_000);
      expect(pool.options.idle_in_transaction_session_timeout).toBe(60_000);
      expect(() => pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
      expect(spy).toHaveBeenCalledWith("[database:otid-test] Fel på vilande databasanslutning:", "terminating connection due to administrator command");
    } finally {
      spy.mockRestore();
      await pool.end();
    }
  });
});
