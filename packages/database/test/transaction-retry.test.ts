import { describe, expect, it } from "vitest";
import { isTransactionConflict, retryTopLevelTransactions } from "../src/index";

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
});
