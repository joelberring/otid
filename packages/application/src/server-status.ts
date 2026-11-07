import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, stat, statfs } from "node:fs/promises";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { localRaceDate } from "@o-tid/domain";
import type { DbExecutor } from "./snapshot";
import { mapStorageQuota, mapStorageUsage } from "./map-content";
import {
  ALERT_KINDS, alertMessage, evaluateAlerts, serverProblems, TIME_ZONE, weeklyReport, weeklyReportDue, EMPTY_NOTICE,
  type AlertKind, type BackupStatus, type DatabaseSizes, type LogRow, type MonitorCheck, type NoticeState, type SampleRow,
  type ServerCounts, type ServerSnapshot, type ServerWatchSettings
} from "./server-report";

/**
 * ADR-0216: mätningen till veckorapporten och larmen, och varvet som sparar mätningen, larmar och skickar rapporten. Databasen
 * (storlekar och antal) läses här; disken, minnet, säkerhetskopiorna (`/backups`, skrivskyddat i `web`) och hälsokontrollens
 * resultat (`/status/monitor.log`, skrivet av tjänsten monitor) läses från filsystemet. Saknas en katalog (lokalt, eller före
 * uppdateringen av docker-compose.prod.yml) står det i rapporten och inget larmas om det.
 */
const DAY = 24 * 60 * 60_000;
const KEEP_DAYS = 180;

/** Tabellerna per grupp i rapporten (resten är tävlingarnas, kontonas och klubbarnas data). */
const MAP_TABLES = ["map_content", "map_content_part", "race_map", "race_map_source", "training_group_map", "training_group_map_source",
  "club_archive_course_file", "participant_route"];
const IMAGE_TABLES = ["club_map_version_check", "club_archive_entry_thumbnail", "course_setting_paper_image", "party_logo", "course_setting_note"];
const PRINT_TABLES = ["course_setting_print_job"];

const names = (tables: readonly string[]) => sql.join(tables.map(table => sql`${table}`), sql`, `);

export async function readDatabaseSizes(db: DbExecutor): Promise<DatabaseSizes> {
  const [row] = (await db.execute<{ total: string; maps: string; images: string; prints: string }>(sql`select
      pg_database_size(current_database())::text as total,
      coalesce(sum(pg_total_relation_size(c.oid)) filter (where c.relname in (${names(MAP_TABLES)})), 0)::text as maps,
      coalesce(sum(pg_total_relation_size(c.oid)) filter (where c.relname in (${names(IMAGE_TABLES)})), 0)::text as images,
      coalesce(sum(pg_total_relation_size(c.oid)) filter (where c.relname in (${names(PRINT_TABLES)})), 0)::text as prints
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')`)).rows;
  return { totalBytes: Number(row?.total ?? 0), mapBytes: Number(row?.maps ?? 0), imageBytes: Number(row?.images ?? 0),
    printBytes: Number(row?.prints ?? 0) };
}

/** Antal konton, klubbar och tävlingar, och tävlingarna de kommande 14 dagarna (bara antal). */
export async function readServerCounts(db: DbExecutor, now: Date): Promise<ServerCounts> {
  const today = localRaceDate(now, TIME_ZONE);
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 13 * DAY).toISOString().slice(0, 10);
  const [row] = (await db.execute<Record<keyof ServerCounts, number>>(sql`select
      (select count(*)::int from user_account) as "accounts",
      (select count(*)::int from user_account where created_at >= ${new Date(now.getTime() - 7 * DAY)}) as "accountsNew",
      (select count(*)::int from club) as "clubs",
      (select count(*)::int from event) as "events",
      (select count(*)::int from race) as "races",
      (select count(*)::int from race where race_date between ${today}::date and ${until}::date) as "upcomingRaces",
      (select count(*)::int from race where race_date between ${today}::date and ${until}::date and published_at is not null) as "upcomingPublished",
      (select count(*)::int from entry e join race r on r.id = e.race_id where r.race_date between ${today}::date and ${until}::date) as "upcomingEntries",
      (select coalesce(max(n), 0)::int from (select count(*) as n from entry e join race r on r.id = e.race_id
        where r.race_date between ${today}::date and ${until}::date group by e.race_id) s) as "upcomingMaxEntries"`)).rows;
  return {
    accounts: row?.accounts ?? 0, accountsNew: row?.accountsNew ?? 0, clubs: row?.clubs ?? 0, events: row?.events ?? 0, races: row?.races ?? 0,
    upcomingRaces: row?.upcomingRaces ?? 0, upcomingPublished: row?.upcomingPublished ?? 0, upcomingEntries: row?.upcomingEntries ?? 0,
    upcomingMaxEntries: row?.upcomingMaxEntries ?? 0
  };
}

// ---- Filsystemet

export interface HostPaths { readonly backupDir: string; readonly statusDir: string }
export function hostPaths(env: Partial<Record<string, string | undefined>> = process.env): HostPaths {
  return { backupDir: env.OTID_BACKUP_DIR?.trim() || "/backups", statusDir: env.OTID_STATUS_DIR?.trim() || "/status" };
}

const exists = async (path: string) => stat(path).then(() => true, () => false);

/**
 * Disken som df räknar: storleken är använt + tillgängligt (utan filsystemets reserv för root), så att procenten blir samma som
 * hälsokontrollens `df` (OTID_DISK_ALERT_PERCENT).
 */
export async function readDisk(path: string): Promise<{ totalBytes: number; freeBytes: number } | null> {
  try {
    const info = await statfs(path);
    const used = (info.blocks - info.bfree) * info.bsize;
    const free = info.bavail * info.bsize;
    return { totalBytes: used + free, freeBytes: free };
  } catch { return null; }
}

/** Hela serverns minne (MemAvailable), som `free` visar det; containern ser värdens /proc/meminfo. */
export async function readMemory(): Promise<{ totalBytes: number; availableBytes: number }> {
  try {
    const text = await readFile("/proc/meminfo", "utf8");
    const value = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? Number.NaN) * 1024;
    const total = value("MemTotal"), available = value("MemAvailable");
    if (Number.isFinite(total) && Number.isFinite(available)) return { totalBytes: total, availableBytes: available };
  } catch { /* inte Linux: Nodes värden nedan */ }
  return { totalBytes: totalmem(), availableBytes: freemem() };
}

export function currentLoad(now: Date): { max: number; at: Date; cpus: number } {
  return { max: loadavg()[0] ?? 0, at: now, cpus: Math.max(1, cpus().length) };
}

/** Säkerhetskopiorna: storleken räknas per fil en gång (dagsbackupen är en hård länk till en timdump). */
export async function readBackups(dir: string): Promise<ServerSnapshot["backups"]> {
  if (!await exists(dir)) return null;
  const seen = new Set<string>();
  let totalBytes = 0, dumpBytes = 0, mapContentBytes = 0, dumps = 0;
  let newest: number | null = null;
  async function walk(path: string, depth: number, area: "root" | "map-content" | "hourly" | "other"): Promise<void> {
    let names: string[];
    try { names = await readdir(path); } catch { return; }
    for (const name of names) {
      const full = join(path, name);
      let info;
      try { info = await lstat(full); } catch { continue; }
      if (info.isDirectory()) {
        if (depth < 3) await walk(full, depth + 1, depth === 0 ? (name === "map-content" ? "map-content" : name === "hourly" ? "hourly" : "other") : area);
        continue;
      }
      if (!info.isFile()) continue;
      if (area === "hourly" && /^otid-.*\.dump$/.test(name)) newest = Math.max(newest ?? 0, info.mtimeMs);
      const key = `${info.dev}:${info.ino}`;
      if (seen.has(key)) continue;
      seen.add(key);
      totalBytes += info.size;
      if (area === "map-content") mapContentBytes += info.size;
      else if (name.endsWith(".dump")) { dumpBytes += info.size; dumps += 1; }
    }
  }
  await walk(dir, 0, "root");
  return { totalBytes, dumpBytes, mapContentBytes, dumps, newestAt: newest === null ? null : new Date(newest),
    status: await readBackupStatus(join(dir, ".backup-status")) };
}

/** `deploy/backup.sh` skriver en rad efter varje körning: `<epok>\t<ok|fail>\t<text>`. */
export async function readBackupStatus(path: string): Promise<BackupStatus | null> {
  try {
    const [epoch, result, ...text] = (await readFile(path, "utf8")).trim().split("\t");
    const at = Number(epoch);
    if (!Number.isFinite(at) || (result !== "ok" && result !== "fail")) return null;
    return { at: new Date(at * 1000), ok: result === "ok", detail: text.join(" ").slice(0, 300) };
  } catch { return null; }
}

/** `deploy/monitor.sh` skriver en rad per kontroll: `<epok>\t<ok|fail>\t<koder>\t<text>`. Null när filen saknas. */
export function parseMonitorLog(text: string): MonitorCheck[] {
  const checks: MonitorCheck[] = [];
  for (const line of text.split("\n")) {
    const [epoch, result, codes, ...rest] = line.split("\t");
    const at = Number(epoch);
    if (!line.trim() || !Number.isFinite(at) || (result !== "ok" && result !== "fail")) continue;
    checks.push({ at: new Date(at * 1000), ok: result === "ok", codes: (codes ?? "").split(",").filter(Boolean), text: rest.join(" ").slice(0, 300) });
  }
  return checks.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function readMonitorChecks(statusDir: string): Promise<MonitorCheck[] | null> {
  try { return parseMonitorLog(await readFile(join(statusDir, "monitor.log"), "utf8")); }
  catch { return null; }
}

// ---- Mätningen

export interface HostReadings {
  readonly disk: ServerSnapshot["disk"];
  readonly memory: ServerSnapshot["memory"];
  readonly load: ServerSnapshot["load"];
  readonly backups: ServerSnapshot["backups"];
  readonly monitor: ServerSnapshot["monitor"];
}

/** Disken, minnet, belastningen, säkerhetskopiorna och hälsokontrollen just nu. */
export async function readHost(paths: HostPaths, now: Date): Promise<HostReadings> {
  const diskPath = await exists(paths.backupDir) ? paths.backupDir : "/";
  return { disk: await readDisk(diskPath), memory: await readMemory(), load: currentLoad(now), backups: await readBackups(paths.backupDir),
    monitor: await readMonitorChecks(paths.statusDir) };
}

export async function collectServerSnapshot(db: Database, host: HostReadings, now: Date,
  env: Partial<Record<string, string | undefined>> = process.env): Promise<ServerSnapshot> {
  const database = await readDatabaseSizes(db);
  const usage = await mapStorageUsage(db, null);
  const counts = await readServerCounts(db, now);
  return { at: now, ...host, database, maps: { storedBytes: usage.totalBytes, quotaBytes: mapStorageQuota(env).totalBytes }, counts };
}

// ---- Varvet

export type ServerMessage = { readonly subject: string; readonly text: string };
/** Skickar till superadmin och ger antalet mottagare. Kastar om e-posten misslyckades (då försöks det igen nästa varv). */
export type ServerMailer = (message: ServerMessage, recipients: readonly string[]) => Promise<number>;

/** Kontona med systemrollen superadmin (ADR-0172 beslut 2) som inte är spärrade. */
export async function superadminRecipients(db: DbExecutor): Promise<string[]> {
  return (await db.execute<{ email: string }>(sql`select email from user_account where is_superadmin and blocked_at is null order by email`))
    .rows.map(row => row.email);
}

const rowDate = (value: unknown): Date | null => value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;

async function readStates(tx: DbExecutor): Promise<Map<string, NoticeState>> {
  const rows = (await tx.execute<{ kind: string; active_since: unknown; alerted: boolean; last_sent_at: unknown; detail: string | null }>(
    sql`select kind, active_since, alerted, last_sent_at, detail from server_notice for update`)).rows;
  return new Map(rows.map(row => [row.kind, { activeSince: rowDate(row.active_since), alerted: row.alerted, lastSentAt: rowDate(row.last_sent_at),
    detail: row.detail }]));
}

async function saveState(tx: DbExecutor, kind: string, state: NoticeState): Promise<void> {
  await tx.execute(sql`insert into server_notice (kind, active_since, alerted, last_sent_at, detail)
    values (${kind}, ${state.activeSince}, ${state.alerted}, ${state.lastSentAt}, ${state.detail?.slice(0, 500) ?? null})
    on conflict (kind) do update set active_since = excluded.active_since, alerted = excluded.alerted, last_sent_at = excluded.last_sent_at,
      detail = excluded.detail`);
}

async function logSent(tx: DbExecutor, kind: string, status: "ALERT" | "RESOLVED" | "REPORT", detail: string | null, recipients: number, now: Date) {
  await tx.insert(schema.serverNoticeLog).values({ id: randomUUID(), kind: kind as AlertKind, status, detail: detail?.slice(0, 500) ?? null,
    recipients, sentAt: now });
}

export async function readHistory(db: DbExecutor, now: Date): Promise<{ samples: SampleRow[]; log: LogRow[] }> {
  const samples = (await db.execute<{ sampled_at: unknown; disk_total_bytes: string | null; disk_free_bytes: string | null; load_max: number | null;
    load_max_at: unknown; memory_total_bytes: string | null; memory_available_min_bytes: string | null }>(sql`select sampled_at, disk_total_bytes,
      disk_free_bytes, load_max, load_max_at, memory_total_bytes, memory_available_min_bytes from server_sample
      where sampled_at >= ${new Date(now.getTime() - 28 * DAY)} order by sampled_at`)).rows;
  const numberOrNull = (value: string | number | null) => value === null ? null : Number(value);
  const log = (await db.execute<{ kind: string; status: string; detail: string | null; sent_at: unknown }>(sql`select kind, status, detail, sent_at
    from server_notice_log where sent_at >= ${new Date(now.getTime() - 7 * DAY)} order by sent_at`)).rows;
  return {
    samples: samples.map(row => ({ at: rowDate(row.sampled_at)!, diskTotalBytes: numberOrNull(row.disk_total_bytes), diskFreeBytes: numberOrNull(row.disk_free_bytes),
      loadMax: numberOrNull(row.load_max), loadMaxAt: rowDate(row.load_max_at), memoryTotalBytes: numberOrNull(row.memory_total_bytes),
      memoryAvailableMinBytes: numberOrNull(row.memory_available_min_bytes) })),
    log: log.map(row => ({ kind: row.kind, status: row.status, detail: row.detail, sentAt: rowDate(row.sent_at)! }))
  };
}

export interface ServerWatchResult {
  readonly snapshot: ServerSnapshot;
  readonly alerts: { readonly kind: AlertKind; readonly status: "ALERT" | "RESOLVED" }[];
  readonly report: "sent" | "baseline" | "not-due";
}

/**
 * Ett varv: sparar mätningen, larmar (och "löst") och skickar veckorapporten när det är dags. Allt i en transaktion med ett
 * PostgreSQL-lås, så att två instanser aldrig skickar samma sak; misslyckas e-posten rullas varvet tillbaka och görs om nästa gång.
 */
export async function runServerWatch(db: Database, input: { host: HostReadings; now: Date; settings: ServerWatchSettings; serverName: string;
  send: ServerMailer; env?: Partial<Record<string, string | undefined>> }): Promise<ServerWatchResult> {
  const { now, settings } = input;
  const snapshot = await collectServerSnapshot(db, input.host, now, input.env);
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('otid.server-watch', 0))`);
    await tx.insert(schema.serverSamples).values({ sampledAt: now, diskTotalBytes: snapshot.disk?.totalBytes ?? null,
      diskFreeBytes: snapshot.disk?.freeBytes ?? null, databaseBytes: snapshot.database.totalBytes, mapBytes: snapshot.maps.storedBytes,
      backupBytes: snapshot.backups?.totalBytes ?? null, loadMax: snapshot.load?.max ?? null, loadMaxAt: snapshot.load?.at ?? null,
      memoryTotalBytes: snapshot.memory?.totalBytes ?? null, memoryAvailableMinBytes: snapshot.memory?.availableBytes ?? null })
      .onConflictDoNothing();
    const states = await readStates(tx);
    const recipients = await superadminRecipients(tx);

    const alerts: ServerWatchResult["alerts"][number][] = [];
    if (settings.alerts) {
      const current = new Map(ALERT_KINDS.map(kind => [kind, states.get(kind) ?? EMPTY_NOTICE] as const));
      const evaluated = evaluateAlerts(current, serverProblems(snapshot, settings), now);
      if (evaluated.messages.length > 0) {
        const sent = await input.send(alertMessage(evaluated.messages, now, input.serverName), recipients);
        for (const message of evaluated.messages) {
          await logSent(tx, message.kind, message.status, message.detail, sent, now);
          alerts.push({ kind: message.kind, status: message.status });
        }
      }
      for (const [kind, state] of evaluated.states) {
        const before = current.get(kind)!;
        if (JSON.stringify(before) !== JSON.stringify(state) || !states.has(kind)) await saveState(tx, kind, state);
      }
    }

    const reportState = states.get("WEEKLY_REPORT");
    const due = weeklyReportDue(reportState?.lastSentAt ?? null, now, settings.report);
    if (due === "baseline") await saveState(tx, "WEEKLY_REPORT", { ...EMPTY_NOTICE, lastSentAt: now });
    if (due === "due") {
      const history = await readHistory(tx, now);
      const sent = await input.send(weeklyReport(snapshot, history, settings, input.serverName), recipients);
      await saveState(tx, "WEEKLY_REPORT", { ...EMPTY_NOTICE, lastSentAt: now });
      await logSent(tx, "WEEKLY_REPORT", "REPORT", null, sent, now);
    }

    await tx.execute(sql`delete from server_sample where sampled_at < ${new Date(now.getTime() - KEEP_DAYS * DAY)}`);
    await tx.execute(sql`delete from server_notice_log where sent_at < ${new Date(now.getTime() - KEEP_DAYS * DAY)}`);
    return { snapshot, alerts, report: due === "due" ? "sent" : due };
  });
}
