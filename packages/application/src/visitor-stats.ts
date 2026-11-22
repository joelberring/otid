import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { localRaceDate } from "@o-tid/domain";
import type { DbExecutor } from "./snapshot";
import { TIME_ZONE } from "./server-report";
import { VISITOR_STEPS, visitorHash, type VisitorDay, type VisitorStep } from "./visitor-report";

/**
 * Besöksstatistiken (ägaren 2026-11-22, migration 0138). Under dygnet (svensk tid) sparas bara en HMAC av adress och webbläsare
 * med dygnets slumpade salt, per steg, för att räkna unika. När dygnet är slut räknas hasharna ihop till antal per dag och steg
 * och tas bort tillsammans med saltet (`rollupVisitorDays`): det görs när den första besökaren ett nytt dygn räknas i en
 * process och av underhållet varje timme. IP-adressen sparas aldrig.
 */
const DAY = 24 * 60 * 60_000;
/** Antalen per dag och steg sparas så här länge. */
const VISITOR_KEEP_DAYS = 400;

const today = (now: Date) => localRaceDate(now, TIME_ZONE);
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Dygnets salt i den här processen (en fråga per dygn och process); de tre webbinstanserna delar saltet via tabellen. */
const globalSalt = globalThis as typeof globalThis & { oTidVisitorSalt?: { day: string; salt: string } };

async function daySalt(db: DbExecutor, day: string): Promise<{ salt: string; fresh: boolean }> {
  const cached = globalSalt.oTidVisitorSalt;
  if (cached?.day === day) return { salt: cached.salt, fresh: false };
  await db.execute(sql`insert into visitor_day_salt (day, salt) values (${day}::date, ${randomBytes(32).toString("hex")})
    on conflict (day) do nothing`);
  const [row] = (await db.execute<{ salt: string }>(sql`select salt from visitor_day_salt where day = ${day}::date`)).rows;
  if (!row) throw new Error("Dygnets salt för besöksstatistiken saknas");
  globalSalt.oTidVisitorSalt = { day, salt: row.salt };
  return { salt: row.salt, fresh: true };
}

/**
 * Räknar en besökare i ett steg (en gång per dygn och steg). Adressen och webbläsaren används bara till hashen. Första gången
 * ett nytt dygn i processen räknas tidigare dygn ihop först, så att inga gamla hashar eller salt blir kvar.
 */
export async function recordVisit(db: DbExecutor, input: { step: VisitorStep; address: string; userAgent: string; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const day = today(now);
  const { salt, fresh } = await daySalt(db, day);
  if (fresh) await rollupVisitorDays(db, now);
  await db.execute(sql`insert into visitor_hit (day, step, hash) values (${day}::date, ${input.step}, ${visitorHash(salt, input.address, input.userAgent)})
    on conflict do nothing`);
}

/**
 * Räknar ihop dygnen före i dag till antal per dag och steg och tar bort deras hashar och salt; antal äldre än
 * `VISITOR_KEEP_DAYS` tas bort. Hasharna tas bort och räknas i samma sats, så två instanser räknar aldrig samma rad två gånger.
 */
export async function rollupVisitorDays(db: DbExecutor, now: Date): Promise<{ days: number; hits: number }> {
  const day = today(now);
  const moved = (await db.execute<{ days: number; hits: number }>(sql`with moved as (
      delete from visitor_hit where day < ${day}::date returning day, step
    ), counted as (
      insert into visitor_day_count (day, step, visitors)
      select day, step, count(*)::int from moved group by day, step
      on conflict (day, step) do update set visitors = visitor_day_count.visitors + excluded.visitors
      returning day
    )
    select (select count(distinct day)::int from counted) as days, (select count(*)::int from moved) as hits`)).rows[0];
  await db.execute(sql`delete from visitor_day_salt where day < ${day}::date`);
  await db.execute(sql`delete from visitor_day_count where day < ${shiftDay(day, -VISITOR_KEEP_DAYS)}::date`);
  return { days: moved?.days ?? 0, hits: moved?.hits ?? 0 };
}

/** De senaste sju dygnen (äldst först, i dag sist och hittills): unika per steg och nya konton (utan gästkonton). */
export async function readVisitorWeek(db: DbExecutor, now: Date): Promise<{ today: string; days: VisitorDay[] }> {
  const last = today(now);
  const first = shiftDay(last, -6);
  const counts = (await db.execute<{ day: string; step: string; visitors: number }>(sql`select to_char(day, 'YYYY-MM-DD') as day, step,
      sum(visitors)::int as visitors from (
        select day, step, visitors from visitor_day_count where day >= ${first}::date
        union all
        select day, step, count(*)::int from visitor_hit where day >= ${first}::date group by day, step
      ) s group by day, step`)).rows;
  const accounts = (await db.execute<{ day: string; accounts: number }>(sql`select
      to_char((created_at at time zone ${TIME_ZONE})::date, 'YYYY-MM-DD') as day, count(*)::int as accounts
      from user_account where guest_expires_at is null and created_at >= ${new Date(Date.parse(`${first}T00:00:00Z`) - DAY)}
      group by 1`)).rows;
  const days: VisitorDay[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = shiftDay(first, offset);
    const steps = Object.fromEntries(VISITOR_STEPS.map(step => [step,
      counts.find(row => row.day === day && row.step === step)?.visitors ?? 0])) as Record<VisitorStep, number>;
    days.push({ day, steps, accounts: accounts.find(row => row.day === day)?.accounts ?? 0 });
  }
  return { today: last, days };
}
