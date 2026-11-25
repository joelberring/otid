import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { readHistory } from "../../src/server-status";
import { readVisitorWeek, recordVisit, rollupVisitorDays } from "../../src/visitor-stats";

/** Processens minne av dygnets salt (`visitor-stats.ts`); tas bort för att låtsas vara en annan process. */
const forgetVisitorSalt = () => { delete (globalThis as { oTidVisitorSalt?: unknown }).oTidVisitorSalt; };
/** Så länge antalen sparas (`VISITOR_KEEP_DAYS` i `visitor-stats.ts`). */
const VISITOR_KEEP_DAYS = 400;
import { registerTestAccount } from "./accounts";

/**
 * Besöksstatistiken (ägaren 2026-11-22, migration 0138): registreringen räknar unika per dygn och steg, dygnet räknas ihop till
 * antal när det är slut, och hasharna och saltet tas bort. IP-adressen finns aldrig i databasen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_besok_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_besok_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile Safari/604.1";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
// Lördag 21 november 23.30 och söndag 22 november 00.10 svensk tid (UTC+1).
const saturday = new Date("2026-11-21T22:30:00Z");
const sunday = new Date("2026-11-22T00:10:00+01:00");
type Row = { day: unknown; step: string; hash?: string; salt?: string; visitors?: number };
const rows = async (table: string): Promise<Row[]> => (await pool.query<Row>(`select * from ${table} order by 1, 2`)).rows;

describe("besöksstatistiken", () => {
  it("räknar unika per dygn och steg, räknar ihop dygnet och tar bort hasharna och saltet", async () => {
    forgetVisitorSalt();
    await recordVisit(db, { step: "HOME", address: "203.0.113.5", userAgent: SAFARI, now: saturday });
    await recordVisit(db, { step: "HOME", address: "203.0.113.5", userAgent: SAFARI, now: saturday });
    await recordVisit(db, { step: "HOME", address: "203.0.113.5", userAgent: FIREFOX, now: saturday });
    await recordVisit(db, { step: "HOME", address: "198.51.100.7", userAgent: SAFARI, now: saturday });
    await recordVisit(db, { step: "DEMO_RACE", address: "203.0.113.5", userAgent: SAFARI, now: saturday });
    // En annan process (ny cache) använder samma salt: samma besökare räknas inte igen.
    forgetVisitorSalt();
    await recordVisit(db, { step: "DEMO_RACE", address: "203.0.113.5", userAgent: SAFARI, now: saturday });

    const hits = await rows("visitor_hit");
    expect(hits).toHaveLength(4);
    expect(JSON.stringify(hits)).not.toMatch(/203\.0|198\.51|Safari|Firefox/);
    expect(await rows("visitor_day_salt")).toHaveLength(1);
    const saturdayHashes = new Set(hits.map(row => row.hash));

    // Dygnet räknas med i veckan medan det pågår.
    let week = await readVisitorWeek(db, saturday);
    expect(week.today).toBe("2026-11-21");
    expect(week.days.at(-1)).toMatchObject({ day: "2026-11-21", steps: { HOME: 3, DEMO_RACE: 1, GUEST_DEMO: 0, SIGN_IN: 0 } });

    // Första besökaren efter midnatt: lördagens hashar räknas ihop och tas bort; gårdagens salt behålls ett dygn för klockskillnad kring midnatt.
    await recordVisit(db, { step: "SIGN_IN", address: "203.0.113.5", userAgent: SAFARI, now: sunday });
    expect((await rows("visitor_hit")).map(row => row.step)).toEqual(["SIGN_IN"]);
    const salts = await rows("visitor_day_salt");
    expect(salts).toHaveLength(2);
    expect((await rows("visitor_day_count")).map(row => [row.step, row.visitors])).toEqual([["DEMO_RACE", 1], ["HOME", 3]]);
    const days = (await pool.query<{ day: string }>("select to_char(day, 'YYYY-MM-DD') as day from visitor_day_count group by 1")).rows;
    expect(days).toEqual([{ day: "2026-11-21" }]);

    // Samma besökare på söndagen får en annan kod än på lördagen (nytt salt), samma kod i alla steg under dygnet.
    await recordVisit(db, { step: "HOME", address: "203.0.113.5", userAgent: SAFARI, now: sunday });
    const sundayHashes = new Set((await rows("visitor_hit")).map(row => row.hash));
    expect(sundayHashes.size).toBe(1);
    expect(saturdayHashes.has([...sundayHashes][0])).toBe(false);

    // Nya konton (inte gästkonton) räknas per svenskt dygn.
    await registerTestAccount(db, undefined, sunday);
    week = await readVisitorWeek(db, sunday);
    expect(week.days).toHaveLength(7);
    expect(week.days[0]!.day).toBe("2026-11-16");
    expect(week.days.at(-2)).toMatchObject({ day: "2026-11-21", steps: { HOME: 3, DEMO_RACE: 1 }, accounts: 0 });
    expect(week.days.at(-1)).toMatchObject({ day: "2026-11-22", steps: { HOME: 1, SIGN_IN: 1 }, accounts: 1 });
    expect((await readHistory(db, sunday)).visitors?.days).toHaveLength(7);

    // Underhållet nästa dag (ingen trafik): söndagen räknas ihop, lördagens salt tas bort och bara gårdagens (söndagens) salt står kvar ett dygn.
    const monday = new Date("2026-11-23T10:00:00Z");
    expect(await rollupVisitorDays(db, monday)).toEqual({ days: 1, hits: 2 });
    expect(await rollupVisitorDays(db, monday)).toEqual({ days: 0, hits: 0 });
    expect(await rows("visitor_hit")).toEqual([]);
    expect(await rows("visitor_day_salt")).toHaveLength(1);
    expect((await readVisitorWeek(db, monday)).days.at(-2)).toMatchObject({ day: "2026-11-22", steps: { HOME: 1, SIGN_IN: 1 } });

    // Ett dygn senare tas också söndagens salt bort.
    const tuesday = new Date("2026-11-24T10:00:00Z");
    expect(await rollupVisitorDays(db, tuesday)).toEqual({ days: 0, hits: 0 });
    expect(await rows("visitor_day_salt")).toEqual([]);

    // Antal äldre än VISITOR_KEEP_DAYS tas bort.
    await rollupVisitorDays(db, new Date(monday.getTime() + (VISITOR_KEEP_DAYS + 2) * 24 * 3_600_000));
    expect(await rows("visitor_day_count")).toEqual([]);
  });
});
