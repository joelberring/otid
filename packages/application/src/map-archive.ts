import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { MAP_CONTENT_PART_BYTES } from "./map-content";
import { inRaceDaySql } from "./radio-ingest";
import { mapArchiveStore, type ArchiveMode, type ArchiveStore } from "./map-archive-store";

/**
 * ADR-0224, PLAN.md steg L5: laserkörningars resultatfiler flyttas till arkivet (objektlagringen) när körningen vilar, och
 * hämtas tillbaka av sig själva när någon läser dem. Bara innehåll som enbart laserkörningar pekar på flyttas (beslut 3);
 * kartfiler, underlag och tävlingars kartor rörs inte i det här steget.
 *
 * Reglerna (ägaren 2026-11-15, skarpare än ADR:ns startvärden; alla är inställningar):
 * - aldrig en körning som väntar eller pågår, eller blev klar för mindre än `minAgeHours` sedan;
 * - **ersatt**: en nyare klar körning finns för samma projekt och etapp → `supersededHours` efter att den nya blev klar;
 * - **vilande**: projektet har inte öppnats på `idleDays`;
 * - **tryck**: när ett kontos laserfiler på servern är fler än `accountHotBytes`, eller alla tillsammans fler än
 *   `totalHotBytes`, flyttas de som längst varit oöppnade tills det ryms, om projektet inte öppnats de senaste
 *   `pressureIdleHours`. Det är regeln för den som kör många körningar på kort tid.
 * Flytten: ladda upp, hämta tillbaka och jämför sha256, markera arkiverat; delarna tas bort här efter `graceHours` (direkt
 * under tryck). Det som hämtats tillbaka ligger kvar minst `restoredHotHours` och räknas inte längre som ersatt.
 */
export interface ArchiveSettings {
  readonly mode: ArchiveMode;
  readonly minBytes: number;
  readonly minAgeHours: number;
  readonly supersededHours: number;
  readonly idleDays: number;
  readonly accountHotBytes: number | null;
  readonly totalHotBytes: number | null;
  readonly pressureIdleHours: number;
  readonly graceHours: number;
  readonly restoredHotHours: number;
  readonly orphanDays: number;
  /** Högst så mycket laddas upp per varv. */
  readonly runBytes: number;
}

const MB = 1024 * 1024, HOUR = 60 * 60_000;
type Env = Partial<Record<string, string | undefined>>;
/** Miljövariabeln, förvalet och om 0 betyder "ingen gräns". */
const NUMBERS = {
  minMb: ["OTID_ARCHIVE_MIN_MB", 1], minAgeHours: ["OTID_ARCHIVE_MIN_AGE_HOURS", 6], supersededHours: ["OTID_ARCHIVE_SUPERSEDED_HOURS", 24],
  idleDays: ["OTID_ARCHIVE_IDLE_DAYS", 3], accountHotMb: ["OTID_ARCHIVE_ACCOUNT_HOT_MB", 500], totalHotMb: ["OTID_ARCHIVE_TOTAL_HOT_MB", 10240],
  pressureIdleHours: ["OTID_ARCHIVE_PRESSURE_IDLE_HOURS", 3], graceHours: ["OTID_ARCHIVE_GRACE_HOURS", 24],
  restoredHotHours: ["OTID_ARCHIVE_RESTORED_HOT_HOURS", 24], orphanDays: ["OTID_ARCHIVE_ORPHAN_DAYS", 35], runMb: ["OTID_ARCHIVE_RUN_MB", 2048]
} as const;

export function archiveSettings(env: Env = process.env, mode: ArchiveMode = "off"): ArchiveSettings {
  const read = (key: keyof typeof NUMBERS) => {
    const [name, fallback] = NUMBERS[key];
    const value = env[name]?.trim();
    return value && /^\d+(\.\d+)?$/.test(value) ? Number(value) : fallback;
  };
  const limit = (mb: number) => mb === 0 ? null : mb * MB;
  return { mode, minBytes: read("minMb") * MB, minAgeHours: read("minAgeHours"), supersededHours: read("supersededHours"), idleDays: read("idleDays"),
    accountHotBytes: limit(read("accountHotMb")), totalHotBytes: limit(read("totalHotMb")), pressureIdleHours: read("pressureIdleHours"),
    graceHours: read("graceHours"), restoredHotHours: read("restoredHotHours"), orphanDays: read("orphanDays"), runBytes: read("runMb") * MB };
}

/** Ogiltiga värden i miljön, för loggen vid start. */
export function archiveNumberProblems(env: Env): string[] {
  return Object.values(NUMBERS).filter(([name]) => { const value = env[name]?.trim(); return value !== undefined && value !== "" && !/^\d+(\.\d+)?$/.test(value); })
    .map(([name, fallback]) => `${name} ska vara ett tal; förvalet ${fallback} används`);
}

export type ArchiveRule = "SUPERSEDED" | "IDLE" | "PRESSURE";
export interface ArchiveCandidate {
  readonly sha256: string;
  readonly contentId: string;
  readonly byteLength: number;
  readonly accountId: string;
  readonly rule: ArchiveRule;
  /** Uppladdat och kontrollerat sedan tidigare (delarna ligger kvar här). */
  readonly archivedAt: Date | null;
}

interface UseRow extends Record<string, unknown> {
  sha: string; content_id: string; byte_length: string; account_id: string; status: string; finished_at: Date | null; opened: Date;
  superseded_at: Date | null; archived_at: Date | null; cold_at: Date | null; restored_at: Date | null;
}

/**
 * Vad som ska flyttas nu, i ordning. `normal: false` (tävlingsdag, ADR-0224 beslut 4) ger bara tryckregeln, som skyddar
 * serverns disk.
 */
export async function planMapArchive(db: DbExecutor, settings: ArchiveSettings, now: Date, options: { normal?: boolean } = {})
  : Promise<{ candidates: ArchiveCandidate[]; hotBytes: number }> {
  const rows = (await db.execute<UseRow>(sql`select o.content_sha256 as sha, c.content_id, c.byte_length::text, j.account_id, j.status, j.finished_at,
      coalesce(p.last_opened_at, p.created_at) as opened,
      (select min(n.finished_at) from map_project_geo_job n where n.project_id = j.project_id and n.kind = j.kind and n.status = 'DONE'
        and n.finished_at > j.finished_at and coalesce(n.request->>'areaId', '') = coalesce(j.request->>'areaId', '')) as superseded_at,
      a.archived_at, a.cold_at, a.restored_at
    from map_project_geo_output o
    join map_content c on c.sha256 = o.content_sha256
    join map_project_geo_job j on j.id = o.job_id
    join map_project p on p.id = j.project_id
    left join map_content_archive a on a.sha256 = c.sha256
    where c.byte_length >= ${settings.minBytes}
      and not exists (select 1 from race_map where content_sha256 = c.sha256)
      and not exists (select 1 from race_map_source where content_sha256 = c.sha256)
      and not exists (select 1 from training_group_map where content_sha256 = c.sha256)
      and not exists (select 1 from training_group_map_source where content_sha256 = c.sha256)
      and not exists (select 1 from club_map_version where content_sha256 = c.sha256)
      and not exists (select 1 from map_project where base_sha256 = c.sha256)
      and not exists (select 1 from map_project_output where content_sha256 = c.sha256)
      and not exists (select 1 from map_project_layer where content_sha256 = c.sha256)`)).rows;
  const never = Number.POSITIVE_INFINITY, time = now.getTime();
  type Content = { sha256: string; contentId: string; byteLength: number; accountId: string; archivedAt: Date | null; cold: boolean;
    due: number; rule: ArchiveRule; pressureDue: number; opened: number; finished: number };
  const contents = new Map<string, Content>();
  for (const row of rows) {
    const finished = row.finished_at && ["DONE", "FAILED", "CANCELLED"].includes(row.status) ? new Date(row.finished_at).getTime() : never;
    const opened = new Date(row.opened).getTime(), restored = row.restored_at ? new Date(row.restored_at).getTime() : null;
    const floor = Math.max(finished + settings.minAgeHours * HOUR, restored === null ? 0 : restored + settings.restoredHotHours * HOUR);
    const superseded = row.superseded_at && restored === null ? new Date(row.superseded_at).getTime() + settings.supersededHours * HOUR : never;
    const idle = opened + settings.idleDays * 24 * HOUR;
    const due = Math.max(floor, Math.min(superseded, idle));
    const pressureDue = Math.max(finished + settings.minAgeHours * HOUR, opened + settings.pressureIdleHours * HOUR,
      restored === null ? 0 : restored + settings.pressureIdleHours * HOUR);
    const rule: ArchiveRule = superseded <= idle ? "SUPERSEDED" : "IDLE";
    const earlier = contents.get(row.sha);
    // Beslut 3: den användning som vilar sist avgör.
    if (!earlier) {
      contents.set(row.sha, { sha256: row.sha, contentId: row.content_id, byteLength: Number(row.byte_length), accountId: row.account_id,
        archivedAt: row.archived_at ? new Date(row.archived_at) : null, cold: row.cold_at !== null, due, rule, pressureDue, opened, finished });
    } else {
      if (due > earlier.due) { earlier.due = due; earlier.rule = rule; }
      earlier.pressureDue = Math.max(earlier.pressureDue, pressureDue);
      earlier.opened = Math.max(earlier.opened, opened);
      earlier.finished = Math.max(earlier.finished, finished);
    }
  }
  const hot = [...contents.values()].filter(content => !content.cold);
  const hotBytes = hot.reduce((sum, content) => sum + content.byteLength, 0);
  const picked = new Map<string, ArchiveRule>();
  if (options.normal !== false) for (const content of hot) if (content.due <= time) picked.set(content.sha256, content.rule);
  // Tryckregeln: det som längst varit oöppnat först, tills kontot (och sedan servern) ryms.
  const oldestFirst = (a: Content, b: Content) => a.opened - b.opened || a.finished - b.finished || a.sha256.localeCompare(b.sha256);
  const relieve = (group: Content[], limit: number | null) => {
    if (limit === null) return;
    let left = group.filter(content => !picked.has(content.sha256)).reduce((sum, content) => sum + content.byteLength, 0);
    for (const content of group.filter(content => !picked.has(content.sha256) && content.pressureDue <= time).sort(oldestFirst)) {
      if (left <= limit) break;
      picked.set(content.sha256, "PRESSURE");
      left -= content.byteLength;
    }
  };
  const accounts = new Map<string, Content[]>();
  for (const content of hot) accounts.set(content.accountId, [...(accounts.get(content.accountId) ?? []), content]);
  for (const group of accounts.values()) relieve(group, settings.accountHotBytes);
  relieve(hot, settings.totalHotBytes);
  const order: ArchiveRule[] = ["PRESSURE", "SUPERSEDED", "IDLE"];
  const candidates = hot.filter(content => picked.has(content.sha256)).sort((a, b) =>
    order.indexOf(picked.get(a.sha256)!) - order.indexOf(picked.get(b.sha256)!) || oldestFirst(a, b))
    .map(content => ({ sha256: content.sha256, contentId: content.contentId, byteLength: content.byteLength, accountId: content.accountId,
      rule: picked.get(content.sha256)!, archivedAt: content.archivedAt }));
  return { candidates, hotBytes };
}

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Innehållets delar ur databasen, utan återhämtning ur arkivet. */
async function localBytes(tx: DbExecutor, contentId: string): Promise<Buffer> {
  const rows = (await tx.execute<{ data: Buffer }>(sql`select data from map_content_part where content_id = ${contentId} order by part`)).rows;
  return Buffer.concat(rows.map(row => row.data));
}

/**
 * Hämtar tillbaka ett innehåll som ligger i arkivet (delarna saknas här): hämta, jämför sha256 och längd, skriv delarna och
 * markera det som hämtat. Ger innehållet, eller undefined när det inte ligger i arkivet. Två samtidiga läsningar skriver
 * samma delar; den andra hoppar över dem.
 */
export async function restoreMapContent(tx: DbExecutor, key: { sha256: string } | { contentId: string }, now = new Date(),
  store: ArchiveStore | null = mapArchiveStore()): Promise<Buffer | undefined> {
  const where = "sha256" in key ? sql`c.sha256 = ${key.sha256}` : sql`c.content_id = ${key.contentId}::uuid`;
  const [row] = (await tx.execute<{ sha256: string; content_id: string; byte_length: string }>(sql`select c.sha256, c.content_id, c.byte_length::text
    from map_content c join map_content_archive a on a.sha256 = c.sha256 where ${where} and a.cold_at is not null
    and c.stored_in = 'DB'`)).rows;
  if (!row) return undefined;
  if (!store) throw new Error("Kartinnehållet ligger i arkivet, men arkivet är inte inställt (OTID_ARCHIVE_*)");
  const bytes = await store.get(row.sha256);
  if (!bytes) throw new Error("Kartinnehållet saknas i arkivet");
  if (bytes.byteLength !== Number(row.byte_length) || sha256Of(bytes) !== row.sha256) throw new Error("Kartinnehållet i arkivet stämmer inte med sin kontrollsumma");
  for (let part = 0; part * MAP_CONTENT_PART_BYTES < bytes.byteLength; part++) {
    const data = bytes.subarray(part * MAP_CONTENT_PART_BYTES, (part + 1) * MAP_CONTENT_PART_BYTES);
    await tx.execute(sql`insert into map_content_part (content_id, part, data, created_at) values (${row.content_id}, ${part}, ${data}, ${now})
      on conflict do nothing`);
  }
  await tx.execute(sql`update map_content_archive set cold_at = null, restored_at = ${now} where sha256 = ${row.sha256}`);
  return bytes;
}

export interface ArchiveRunResult {
  readonly mode: ArchiveMode;
  readonly raceDay: boolean;
  readonly hotBytes: number;
  readonly planned: { count: number; bytes: number; rules: Record<ArchiveRule, number> };
  readonly uploaded: number;
  readonly cooled: number;
  readonly freedBytes: number;
  readonly orphansRemoved: number;
  readonly failed: number;
  readonly errors: string[];
}

/** Körs en tävling i appen i dag (tävlingsdygnet, ADR-0178)? Också förrådets flytt (PLAN.md steg M3) frågar. */
export async function raceDayNow(db: DbExecutor, now: Date): Promise<boolean> {
  const rows = (await db.execute(sql`select 1 from ${schema.races} join ${schema.events} on ${schema.events.id} = ${schema.races.eventId}
    where ${inRaceDaySql(schema.races.raceDate, schema.events.timeZone, now)} limit 1`)).rows;
  return rows.length > 0;
}

/**
 * Ett varv. `log` räknar bara ut vad som skulle flyttas; `on` laddar upp (högst `runBytes`), tar bort delarna när fristen
 * gått ut och städar arkivet efter innehåll som inte finns kvar. Ett fel på ett innehåll stoppar inte de andra.
 */
export async function runMapArchive(db: Database, store: ArchiveStore | null, settings: ArchiveSettings, now = new Date()): Promise<ArchiveRunResult> {
  const raceDay = await raceDayNow(db, now);
  const { candidates, hotBytes } = await planMapArchive(db, settings, now, { normal: !raceDay });
  const rules: Record<ArchiveRule, number> = { SUPERSEDED: 0, IDLE: 0, PRESSURE: 0 };
  for (const candidate of candidates) rules[candidate.rule] += 1;
  const planned = { count: candidates.length, bytes: candidates.reduce((sum, candidate) => sum + candidate.byteLength, 0), rules };
  const result = { mode: settings.mode, raceDay, hotBytes, planned, uploaded: 0, cooled: 0, freedBytes: 0, orphansRemoved: 0, failed: 0, errors: [] as string[] };
  if (settings.mode !== "on" || !store) return result;
  let sent = 0;
  for (const candidate of candidates) {
    try {
      let archivedAt = candidate.archivedAt;
      if (!archivedAt) {
        if (sent > 0 && sent + candidate.byteLength > settings.runBytes) continue;
        const bytes = await localBytes(db, candidate.contentId);
        if (bytes.byteLength !== candidate.byteLength || sha256Of(bytes) !== candidate.sha256) throw new Error("innehållet här stämmer inte med sin kontrollsumma");
        await store.put(candidate.sha256, bytes);
        const back = await store.get(candidate.sha256);
        if (!back || back.byteLength !== bytes.byteLength || sha256Of(back) !== candidate.sha256) throw new Error("kopian i arkivet stämmer inte med originalet");
        await db.execute(sql`insert into map_content_archive (sha256, byte_length, archived_at) values (${candidate.sha256}, ${candidate.byteLength}, ${now})
          on conflict (sha256) do update set archived_at = excluded.archived_at, cold_at = null, orphaned_at = null`);
        archivedAt = now;
        sent += candidate.byteLength;
        result.uploaded += 1;
      }
      const grace = candidate.rule === "PRESSURE" ? 0 : settings.graceHours * HOUR;
      if (archivedAt.getTime() + grace > now.getTime()) continue;
      if (await store.size(candidate.sha256) !== candidate.byteLength) {
        // Objektet är borta eller trasigt: glöm arkiveringen, så laddas det upp igen nästa varv.
        await db.execute(sql`delete from map_content_archive where sha256 = ${candidate.sha256} and cold_at is null`);
        throw new Error("objektet i arkivet saknas eller har fel storlek");
      }
      const cooled = await db.transaction(async tx => {
        // Raden låses, och villkoren kontrolleras igen: ingenting annat får ha börjat peka på innehållet under tiden.
        const [content] = (await tx.execute(sql`select 1 from map_content where sha256 = ${candidate.sha256} for update`)).rows;
        if (!content) return false;
        const again = await planMapArchive(tx, settings, now, { normal: !raceDay });
        if (!again.candidates.some(other => other.sha256 === candidate.sha256)) return false;
        await tx.execute(sql`delete from map_content_part where content_id = ${candidate.contentId}`);
        await tx.execute(sql`update map_content_archive set cold_at = ${now} where sha256 = ${candidate.sha256}`);
        return true;
      });
      if (cooled) { result.cooled += 1; result.freedBytes += candidate.byteLength; }
    } catch (error) {
      result.failed += 1;
      if (result.errors.length < 5) result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const orphans = await removeArchiveOrphans(db, store, settings.orphanDays, now);
  result.orphansRemoved = orphans.removed;
  result.failed += orphans.errors.length;
  for (const error of orphans.errors) if (result.errors.length < 5) result.errors.push(error);
  return result;
}

/**
 * Beslut 7: ett innehåll som inte finns kvar raderas i arkivet (och förrådet, ADR-0229) först när backupens sparade kopior
 * har gått ut (`orphanDays` efter att det släpptes). Körs av arkivet och av förrådets löpare.
 */
export async function removeArchiveOrphans(db: Database, store: ArchiveStore, orphanDays: number, now = new Date())
  : Promise<{ removed: number; errors: string[] }> {
  // PLAN.md steg M4: innehåll som tagits bort ur förrådet ('GONE') räknas som borta; objektet tas bort som ett släppt.
  await db.execute(sql`update map_content_archive a set orphaned_at = ${now} where a.orphaned_at is null
    and not exists (select 1 from map_content c where c.sha256 = a.sha256 and c.stored_in <> 'GONE')`);
  await db.execute(sql`update map_content_archive a set orphaned_at = null where a.orphaned_at is not null
    and exists (select 1 from map_content c where c.sha256 = a.sha256 and c.stored_in <> 'GONE')`);
  const cutoff = new Date(now.getTime() - orphanDays * 24 * HOUR);
  const orphans = (await db.execute<{ sha256: string }>(sql`select sha256 from map_content_archive
    where orphaned_at < ${cutoff} limit 200`)).rows;
  let removed = 0;
  const errors: string[] = [];
  for (const orphan of orphans) {
    try {
      // Granskningen runda 2 (A): radlåset ordnar borttagningen mot en ny uppladdning av samma innehåll (förrådet, ADR-0229),
      // inte längre kartinnehållets gemensamma lås (så att objektlagringens svarstid inte stoppar alla uppladdningar). Fristen
      // prövas igen här: en uppladdning som reserverats sedan listan lästes (`reserveStoreUpload`) har förnyat den. En
      // reservation som kommer under borttagningen väntar på radlåset, så objektet laddas upp först efter att det raderats,
      // och `storeMapContent` registrerar bara under radlåset på en reservation som står kvar (`storeReservationHolds`).
      const gone = await db.transaction(async tx => {
        const [row] = (await tx.execute(sql`delete from map_content_archive a where a.sha256 = ${orphan.sha256} and a.orphaned_at < ${cutoff}
          and not exists (select 1 from map_content c where c.sha256 = a.sha256 and c.stored_in <> 'GONE') returning 1`)).rows;
        if (row) await store.remove(orphan.sha256);
        return row !== undefined;
      });
      if (gone) removed += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { removed, errors };
}
