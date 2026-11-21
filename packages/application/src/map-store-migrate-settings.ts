import { sql } from "drizzle-orm";
import type { DbExecutor } from "./snapshot";

/**
 * PLAN.md steg M3 (ADR-0229, tillägg 2026-11-21 (M3)): inställningarna, beställningen och läget för flytten av befintligt
 * kartinnehåll ur PostgreSQL till förrådet. Flytten själv står i `map-store-migrate.ts`.
 *
 * Miljön (tomt = förvalet):
 * - `OTID_STORE_MIGRATE` = `on` (förval när förrådet är på) eller `off` (ingen flytt alls, inte heller med knappen).
 * - `OTID_STORE_MIGRATE_HOURS` = fönstret i svensk tid, `1-6` (förval: från 01:00 till 06:00); `0-24` = hela dygnet.
 * - `OTID_STORE_MIGRATE_RUN_MB` = högst så mycket laddas upp per varv (förval 2048; varv var 10:e minut i fönstret).
 * - `OTID_STORE_MIGRATE_GRACE_HOURS` = så länge ligger delarna kvar i databasen efter flytten (förval 24).
 *
 * Installationens rader (`installation_setting`, inga nya tabeller): `map_migrate_request` (superadmin tryckte «Flytta nu»;
 * löparen tar beställningen inom en minut), `map_migrate_lease` (ett varv i taget, också mellan webben och kommandot) och
 * `map_migrate_last` (senaste varvets resultat, för superadminsidan och `map-store status`).
 */
type Env = Partial<Record<string, string | undefined>>;
const MB = 1024 * 1024;
const TIME_ZONE = "Europe/Stockholm";

export interface MigrateSettings {
  readonly enabled: boolean;
  /** Fönstrets början och slut i hela timmar (svensk tid, slutet ingår inte). */
  readonly fromHour: number;
  readonly toHour: number;
  readonly runBytes: number;
  readonly graceHours: number;
}

const HOURS = /^(\d{1,2})\s*-\s*(\d{1,2})$/;
const NUMBER = /^\d+(\.\d+)?$/;

export function migrateSettings(env: Env = process.env): MigrateSettings {
  const hours = HOURS.exec(env.OTID_STORE_MIGRATE_HOURS?.trim() ?? "");
  const from = hours ? Number(hours[1]) : 1, to = hours ? Number(hours[2]) : 6;
  const valid = from <= 23 && to <= 24 && from !== to;
  const number = (name: string, fallback: number) => {
    const value = env[name]?.trim();
    return value && NUMBER.test(value) && Number(value) > 0 ? Number(value) : fallback;
  };
  return { enabled: env.OTID_STORE_MIGRATE?.trim().toLowerCase() !== "off", fromHour: valid ? from : 1, toHour: valid ? to : 6,
    runBytes: number("OTID_STORE_MIGRATE_RUN_MB", 2048) * MB, graceHours: number("OTID_STORE_MIGRATE_GRACE_HOURS", 24) };
}

/** Fel inställningar, för loggen vid start. */
export function migrateSettingsProblems(env: Env): string[] {
  const problems: string[] = [];
  const mode = env.OTID_STORE_MIGRATE?.trim().toLowerCase();
  if (mode && mode !== "on" && mode !== "off") problems.push("OTID_STORE_MIGRATE ska vara on eller off; flytten är på");
  const hours = env.OTID_STORE_MIGRATE_HOURS?.trim();
  if (hours) {
    const match = HOURS.exec(hours);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 24 || match[1] === match[2]) {
      problems.push("OTID_STORE_MIGRATE_HOURS ska vara två hela timmar som 1-6 (svensk tid); förvalet 1-6 används");
    }
  }
  for (const name of ["OTID_STORE_MIGRATE_RUN_MB", "OTID_STORE_MIGRATE_GRACE_HOURS"]) {
    const value = env[name]?.trim();
    if (value && (!NUMBER.test(value) || Number(value) <= 0)) problems.push(`${name} ska vara ett positivt tal; förvalet används`);
  }
  return problems;
}

/** Timmen i svensk tid (0–23). */
export function stockholmHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now)) % 24;
}

/** Är det inom fönstret nu? Fönster över midnatt (t.ex. 22-5) går också. */
export function inMigrateWindow(now: Date, settings: Pick<MigrateSettings, "fromHour" | "toHour">): boolean {
  const hour = stockholmHour(now);
  return settings.fromHour < settings.toHour ? hour >= settings.fromHour && hour < settings.toHour
    : hour >= settings.fromHour || hour < settings.toHour;
}

/** Senaste varvets resultat, som det sparas (högst tre fel, korta). */
export interface MigrateRunSummary {
  readonly at: string;
  readonly trigger: "NIGHT" | "MANUAL" | "COMMAND";
  /** Varför varvet slutade före allt: tävlingsdygnet, fönstret slutade, mängden per varv, någon annan körde, eller null. */
  readonly stopped: "RACE_DAY" | "WINDOW" | "BUDGET" | "BUSY" | null;
  readonly moved: number;
  readonly movedBytes: number;
  readonly uploadedBytes: number;
  readonly freed: number;
  readonly freedBytes: number;
  readonly reconciled: number;
  readonly failed: number;
  readonly errors: readonly string[];
}

const jsonOf = (value: unknown) => JSON.stringify(value);

async function writeRow(tx: DbExecutor, key: string, value: unknown, now: Date, accountId: string | null = null): Promise<void> {
  await tx.execute(sql`insert into installation_setting (key, value, updated_at, updated_by)
    values (${key}, ${jsonOf(value)}::jsonb, ${now}, ${accountId}::uuid)
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`);
}

export async function saveMigrateSummary(tx: DbExecutor, summary: MigrateRunSummary, now: Date): Promise<void> {
  await writeRow(tx, "map_migrate_last", { ...summary, errors: summary.errors.slice(0, 3).map(error => error.slice(0, 200)) }, now);
}

export async function readMigrateSummary(tx: DbExecutor): Promise<MigrateRunSummary | null> {
  const [row] = (await tx.execute<{ value: MigrateRunSummary }>(sql`select value from installation_setting where key = 'map_migrate_last'`)).rows;
  return row?.value && typeof row.value === "object" && typeof row.value.at === "string" ? row.value : null;
}

/** «Flytta nu» på superadminsidan: löparen (som kan köra i en annan process) tar beställningen inom en minut. */
export async function requestMapMigration(tx: DbExecutor, accountId: string | null, now: Date, megabytes: number | null = null): Promise<void> {
  await writeRow(tx, "map_migrate_request", { mb: megabytes }, now, accountId);
}

/** Tar beställningen (en gång): null när ingen finns. */
export async function takeMapMigrationRequest(tx: DbExecutor): Promise<{ megabytes: number | null } | null> {
  const [row] = (await tx.execute<{ value: { mb?: unknown } }>(sql`delete from installation_setting where key = 'map_migrate_request'
    returning value`)).rows;
  if (!row) return null;
  const mb = row.value?.mb;
  return { megabytes: typeof mb === "number" && Number.isFinite(mb) && mb > 0 ? mb : null };
}

const LEASE_MS = 15 * 60_000;

/** Tar (eller förnyar) varvets lås. Ett lås som inte förnyats på 15 minuter räknas som övergivet. */
export async function takeMigrateLease(tx: DbExecutor, holder: string, now: Date): Promise<boolean> {
  const rows = (await tx.execute(sql`insert into installation_setting (key, value, updated_at)
    values ('map_migrate_lease', ${jsonOf({ holder })}::jsonb, ${now})
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at
      where installation_setting.value->>'holder' = ${holder} or installation_setting.updated_at < ${new Date(now.getTime() - LEASE_MS)}
    returning 1`)).rows;
  return rows.length > 0;
}

export async function releaseMigrateLease(tx: DbExecutor, holder: string): Promise<void> {
  await tx.execute(sql`delete from installation_setting where key = 'map_migrate_lease' and value->>'holder' = ${holder}`);
}

export interface MigrateStatus {
  /** Kvar i databasen (`stored_in = 'DB'`). */
  readonly dbCount: number; readonly dbBytes: number;
  /** I förrådet (flyttat och nytt sedan förrådet slogs på). */
  readonly storeCount: number; readonly storeBytes: number;
  /** Flyttat men delarna ligger kvar i databasen tills fristen gått ut. */
  readonly pendingCount: number; readonly pendingBytes: number;
  readonly requested: boolean;
  readonly last: MigrateRunSummary | null;
}

export async function mapMigrationStatus(tx: DbExecutor): Promise<MigrateStatus> {
  const [row] = (await tx.execute<{ db_count: string; db_bytes: string; store_count: string; store_bytes: string; pending_count: string;
    pending_bytes: string; requested: boolean }>(sql`select
      count(*) filter (where stored_in = 'DB')::text as db_count,
      coalesce(sum(byte_length) filter (where stored_in = 'DB'), 0)::text as db_bytes,
      count(*) filter (where stored_in = 'STORE')::text as store_count,
      coalesce(sum(byte_length) filter (where stored_in = 'STORE'), 0)::text as store_bytes,
      count(*) filter (where stored_in = 'STORE' and exists (select 1 from map_content_part p where p.content_id = c.content_id and p.part = 0))::text as pending_count,
      coalesce(sum(byte_length) filter (where stored_in = 'STORE' and exists (select 1 from map_content_part p where p.content_id = c.content_id and p.part = 0)), 0)::text as pending_bytes,
      exists (select 1 from installation_setting where key = 'map_migrate_request') as requested
    from map_content c`)).rows;
  return { dbCount: Number(row?.db_count ?? 0), dbBytes: Number(row?.db_bytes ?? 0), storeCount: Number(row?.store_count ?? 0),
    storeBytes: Number(row?.store_bytes ?? 0), pendingCount: Number(row?.pending_count ?? 0), pendingBytes: Number(row?.pending_bytes ?? 0),
    requested: row?.requested === true, last: await readMigrateSummary(tx) };
}

export interface PartTableSize {
  /** Tabellens storlek på disken (med TOAST och index). */
  readonly totalBytes: number;
  /** Det som fortfarande används: innehållen som har sina delar i tabellen. */
  readonly liveBytes: number;
  /** VACUUM FULL lönar sig: inget kvar att flytta, fristen ute och minst 256 MB att vinna. */
  readonly vacuumRecommended: boolean;
}

/** Tabellen `map_content_part` före och efter städningen (docs/drift.md, "Efter flytten: frigör databasens utrymme"). */
export async function partTableSize(tx: DbExecutor, status: Pick<MigrateStatus, "dbCount" | "pendingCount">): Promise<PartTableSize> {
  const [row] = (await tx.execute<{ total: string; live: string }>(sql`select pg_total_relation_size('map_content_part')::text as total,
    coalesce((select sum(c.byte_length) from map_content c where exists (select 1 from map_content_part p
      where p.content_id = c.content_id and p.part = 0)), 0)::text as live`)).rows;
  const totalBytes = Number(row?.total ?? 0), liveBytes = Number(row?.live ?? 0);
  return { totalBytes, liveBytes, vacuumRecommended: status.dbCount === 0 && status.pendingCount === 0 && totalBytes - liveBytes > 256 * MB };
}

/** De största tabellerna (för att se vad timdumparna består av, ADR-0216 tillägg 2026-11-21 (M3)). */
export async function largestTables(tx: DbExecutor, limit = 12): Promise<{ table: string; totalBytes: number; rows: number }[]> {
  const rows = (await tx.execute<{ relname: string; total: string; estimate: string }>(sql`select c.relname,
      pg_total_relation_size(c.oid)::text as total, greatest(c.reltuples, 0)::bigint::text as estimate
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema() and c.relkind in ('r', 'p')
    order by pg_total_relation_size(c.oid) desc limit ${limit}`)).rows;
  return rows.map(row => ({ table: row.relname, totalBytes: Number(row.total), rows: Number(row.estimate) }));
}
