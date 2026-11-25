import { beforeEach, describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import type { DbExecutor } from "../src/snapshot";
import { recordVisit, rollupVisitorDays } from "../src/visitor-stats";

const globalSalt = globalThis as typeof globalThis & {
  oTidVisitorSalt?: unknown;
  oTidVisitorSaltFlight?: unknown;
};

function sqlText(query: SQL): string {
  const chunks = (query as unknown as { queryChunks: unknown[] }).queryChunks;
  return chunks.map(chunk => typeof chunk === "object" && chunk !== null && "value" in chunk ? String((chunk as { value: unknown }).value) : "?").join("");
}

function sqlParams(query: SQL): unknown[] {
  const chunks = (query as unknown as { queryChunks: unknown[] }).queryChunks;
  return chunks.filter(chunk => !(typeof chunk === "object" && chunk !== null && "value" in chunk));
}

describe("visitor-stats: enhetstester för salt, sammanslagning och frekvensskydd", () => {
  beforeEach(() => {
    delete globalSalt.oTidVisitorSalt;
    delete globalSalt.oTidVisitorSaltFlight;
  });

  it("sammanför samtidiga saltfrågor (in-flight coalescing) och kör bara rollup en gång", async () => {
    let saltInserts = 0, saltSelects = 0, rollups = 0, hitInserts = 0;
    const db = {
      execute: async (query: SQL) => {
        const text = sqlText(query);
        if (text.includes("insert into visitor_day_salt")) {
          saltInserts += 1;
          await new Promise(resolve => setTimeout(resolve, 15));
          return { rows: [] };
        }
        if (text.includes("select salt from visitor_day_salt")) {
          saltSelects += 1;
          return { rows: [{ salt: "a".repeat(64) }] };
        }
        if (text.includes("delete from visitor_hit")) {
          rollups += 1;
          return { rows: [{ days: 0, hits: 0 }] };
        }
        if (text.includes("insert into visitor_hit")) {
          hitInserts += 1;
          return { rows: [] };
        }
        return { rows: [] };
      }
    } as unknown as DbExecutor;

    const now = new Date("2026-11-25T10:00:00Z");
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      recordVisit(db, { step: "HOME", address: `198.51.100.${i + 1}`, userAgent: "Mozilla/5.0", now })
    ));
    expect(saltInserts).toBe(1);
    expect(saltSelects).toBe(1);
    expect(rollups).toBe(1);
    expect(hitInserts).toBe(10);
  });

  it("behåller gårdagens salt vid rollup (raderar bara day < idag - 1)", async () => {
    let deletedBefore: unknown;
    const db = {
      execute: async (query: SQL) => {
        const text = sqlText(query);
        if (text.includes("delete from visitor_day_salt")) {
          deletedBefore = sqlParams(query)[0];
        }
        return { rows: [{ days: 0, hits: 0 }] };
      }
    } as unknown as DbExecutor;

    await rollupVisitorDays(db, new Date("2026-11-25T00:00:05Z"));
    expect(deletedBefore).toBe("2026-11-24");
  });

  it("deduplicerar upprepade träffar och begränsar en IP som roterar User-Agent", async () => {
    let hitInserts = 0;
    const db = {
      execute: async (query: SQL) => {
        const text = sqlText(query);
        if (text.includes("select salt from visitor_day_salt")) return { rows: [{ salt: "b".repeat(64) }] };
        if (text.includes("insert into visitor_hit")) { hitInserts += 1; return { rows: [] }; }
        return { rows: [{ days: 0, hits: 0 }] };
      }
    } as unknown as DbExecutor;

    const now = new Date("2026-11-25T12:00:00Z");
    // Samma (steg, IP, UA) tre gånger -> bara en databasskrivning.
    await recordVisit(db, { step: "HOME", address: "203.0.113.10", userAgent: "SameUA", now });
    await recordVisit(db, { step: "HOME", address: "203.0.113.10", userAgent: "SameUA", now });
    await recordVisit(db, { step: "HOME", address: "203.0.113.10", userAgent: "SameUA", now });
    expect(hitInserts).toBe(1);

    // En IP som roterar 100 unika User-Agents stannas vid maxgränsen (32 totalt för IP:n).
    for (let i = 0; i < 100; i += 1) {
      await recordVisit(db, { step: "HOME", address: "203.0.113.10", userAgent: `Bot/${i}`, now });
    }
    expect(hitInserts).toBe(32);

    // En annan IP påverkas inte.
    await recordVisit(db, { step: "HOME", address: "203.0.113.11", userAgent: "Mozilla/5.0", now });
    expect(hitInserts).toBe(33);
  });
});
