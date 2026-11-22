import { rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import type { AccountRegenerable, StoredRecipe } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import type { ArchiveStore } from "./map-archive-store";
import { raceDayNow } from "./map-archive";
import { cachePath, usableMapCacheDir } from "./map-cache";
import { DEFAULT_REGENERABLE_QUOTA_MB } from "./map-content";
import { activeMapStore } from "./map-store";
import type { DbExecutor } from "./snapshot";

/**
 * PLAN.md steg M4 (ADR-0229 tillägg M4): återskapbart underlag – laserkörningarnas resultat och hämtade bilder (ortofoton från
 * Lantmäteriet, markfuktigheten, Skogsstyrelsens kartbilder, WMS) – har ett recept i registret (`map_content.recipe`) och räknas
 * mot kontots egen gräns (`user_account.regenerable_quota_mb`, förval 10 240 MB) i stället för kartlagringens.
 *
 * - **Gränsen:** passeras den tas det som använts minst nyligen bort ur förrådet direkt (efter sparandet, inte vid en
 *   nattkörning) tills kontot är under gränsen. Raden, referenserna och receptet står kvar med `stored_in = 'GONE'`.
 * - **Skyddet:** underlag i projekt som öppnats de senaste 3 dygnen, projektets senaste klara laserkörning (alla etapper i en
 *   delad), resultat från körningar som inte är klara och innehåll som en tävling, träning eller klubbarkivet pekar på tas aldrig
 *   bort. Bara innehåll i förrådet tas bort (det som ännu ligger i databasen flyttas först, steg M3).
 * - **Orört:** återskapbart som inte använts på `regenerable_idle_days` dagar (installationsinställning, förval 90, 0 = av) tas
 *   bort ur förrådet, utom i projekt öppnade de senaste 3 dygnen. Projektets senaste körning skyddas inte av den regeln.
 * - **Tävlingsdygnet** (ADR-0178): ingen automatisk borttagning; löparen tar igen det nästa dygn.
 * - **Senast använt** = det senare av innehållets `last_used_at` (eller när det skapades) och när ett projekt som pekar på det
 *   senast öppnades (webbläsaren håller bilderna i sin egen cache, så läsningarna här räcker inte).
 */
const MB = 1024 * 1024;
const DAY = 24 * 60 * 60_000;
export const REGENERABLE_PROTECT_DAYS = 3;
export const DEFAULT_REGENERABLE_IDLE_DAYS = 90;
/** Arkivets markering för ett objekt som ska tas bort direkt (äldre än varje frist). */
const EVICTED_MARK = new Date("1970-01-01T00:00:00Z");

export interface RegenerableRow {
  readonly sha256: string; readonly byteLength: number; readonly storedIn: "DB" | "STORE"; readonly usedAt: Date;
  readonly projectName: string | null; readonly label: string; readonly source: string;
  /** Får inte tas bort för gränsen (se överst); `recent` skyddar också mot regeln om orört. */
  readonly recent: boolean; readonly protected: boolean;
}

/**
 * Kontots (eller med `accountId` null alla kontons) återskapbara innehåll som finns, äldst använt först, med skyddet.
 * `sha256` begränsar till ett innehåll (kontrollen under radlåset).
 */
export async function regenerableRows(tx: DbExecutor, input: { accountId: string | null; sha256?: string; usedBefore?: Date; limit?: number },
  now: Date): Promise<RegenerableRow[]> {
  const recent = new Date(now.getTime() - REGENERABLE_PROTECT_DAYS * DAY);
  const rows = (await tx.execute<{ sha256: string; byte_length: string; stored_in: "DB" | "STORE"; used_at: Date | string; project_name: string | null;
    label: string | null; source: string | null; recent: boolean; latest: boolean; running: boolean; elsewhere: boolean }>(sql`
    with mine as (
      select c.sha256, c.byte_length, c.stored_in, coalesce(c.last_used_at, c.created_at) as used, c.recipe from map_content c
      where c.regenerable and c.stored_in in ('DB', 'STORE')
        and (${input.accountId}::uuid is null or c.uploaded_by = ${input.accountId}::uuid)
        and (${input.sha256 ?? null}::text is null or c.sha256 = ${input.sha256 ?? null}::text)
    ),
    refs as (
      select o.content_sha256 as sha, j.project_id as pid, j.id as job_id, j.status, o.name as output, j.request->>'name' as job_name, null::text as layer_name
        from map_project_geo_output o join map_project_geo_job j on j.id = o.job_id where o.content_sha256 in (select sha256 from mine)
      union all select l.content_sha256, l.project_id, null, null, null, null, l.name from map_project_layer l where l.content_sha256 in (select sha256 from mine)
      union all select o.content_sha256, o.project_id, null, null, null, null, null from map_project_output o where o.content_sha256 in (select sha256 from mine)
      union all select p.base_sha256, p.id, null, null, null, null, null from map_project p where p.base_sha256 in (select sha256 from mine)
    ),
    latest as (
      select distinct on (project_id) project_id, id, request->'split'->>'group' as grp from map_project_geo_job
      where status = 'DONE' and kind = 'PULLAUTIN' and project_id in (select pid from refs) order by project_id, finished_at desc nulls last, id
    ),
    latest_jobs as (
      select j.id from map_project_geo_job j join latest l on l.project_id = j.project_id
      where j.id = l.id or (l.grp is not null and j.request->'split'->>'group' = l.grp)
    ),
    info as (
      select r.sha, max(p.last_opened_at) as opened, coalesce(bool_or(p.last_opened_at >= ${recent}), false) as recent,
        coalesce(bool_or(r.job_id in (select id from latest_jobs)), false) as latest,
        coalesce(bool_or(r.status is not null and r.status <> 'DONE'), false) as running,
        (array_agg(p.name order by p.last_opened_at desc nulls last))[1] as project_name,
        (array_agg(coalesce(r.layer_name, r.job_name || ' – ' || r.output) order by r.layer_name nulls last)
          filter (where r.layer_name is not null or r.job_name is not null))[1] as label
      from refs r join map_project p on p.id = r.pid group by r.sha
    )
    select m.sha256, m.byte_length::text, m.stored_in, greatest(m.used, coalesce(i.opened, m.used)) as used_at, i.project_name, i.label,
      m.recipe->>'source' as source, coalesce(i.recent, false) as recent, coalesce(i.latest, false) as latest, coalesce(i.running, false) as running,
      (exists (select 1 from race_map where content_sha256 = m.sha256) or exists (select 1 from race_map_source where content_sha256 = m.sha256)
        or exists (select 1 from training_group_map where content_sha256 = m.sha256)
        or exists (select 1 from training_group_map_source where content_sha256 = m.sha256)
        or exists (select 1 from club_map_version where content_sha256 = m.sha256)) as elsewhere
    from mine m left join info i on i.sha = m.sha256
    where (${input.usedBefore ?? null}::timestamptz is null or greatest(m.used, coalesce(i.opened, m.used)) < ${input.usedBefore ?? null}::timestamptz)
    order by used_at, m.sha256 limit ${input.limit ?? 100_000}`)).rows;
  return rows.map(row => ({ sha256: row.sha256, byteLength: Number(row.byte_length), storedIn: row.stored_in, usedAt: new Date(row.used_at),
    projectName: row.project_name, label: (row.label ?? row.source ?? "").slice(0, 200), source: (row.source ?? "").slice(0, 20), recent: row.recent,
    protected: row.recent || row.latest || row.running || row.elsewhere }));
}

/** Kan tas bort för gränsen: i förrådet och inte skyddat. */
export const evictable = (row: RegenerableRow) => row.storedIn === "STORE" && !row.protected;

/** Kontots gräns för återskapbart i byte (den egna eller förvalet). */
export async function regenerableLimitBytes(tx: DbExecutor, accountId: string): Promise<number> {
  const [row] = (await tx.execute<{ mb: number | null }>(sql`select regenerable_quota_mb as mb from user_account where id = ${accountId}::uuid`)).rows;
  return (row?.mb ?? DEFAULT_REGENERABLE_QUOTA_MB) * MB;
}

/** `regenerable_idle_days` (installationsinställning): dagar orört innan det tas bort; null = av. */
export async function regenerableIdleDays(tx: DbExecutor): Promise<number | null> {
  const [row] = (await tx.execute<{ value: unknown }>(sql`select value from installation_setting where key = 'regenerable_idle_days'`)).rows;
  const value = row?.value;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return DEFAULT_REGENERABLE_IDLE_DAYS;
  return value === 0 ? null : value;
}

/** De två projekt med mest skyddat underlag, när det skyddade ensamt passerar gränsen (då säger O-Tid till i stället). */
export function overLimitProjects(rows: readonly RegenerableRow[], limitBytes: number): string[] {
  const kept = rows.filter(row => !evictable(row));
  if (kept.reduce((sum, row) => sum + row.byteLength, 0) <= limitBytes) return [];
  const perProject = new Map<string, number>();
  for (const row of kept) if (row.projectName) perProject.set(row.projectName, (perProject.get(row.projectName) ?? 0) + row.byteLength);
  return [...perProject.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([name]) => name.slice(0, 200));
}

/** Det som tas bort för gränsen, i ordning, tills kontot är under den. Ren funktion (testas för sig). */
export function pickRegenerableEvictions(rows: readonly RegenerableRow[], limitBytes: number): RegenerableRow[] {
  let used = rows.reduce((sum, row) => sum + row.byteLength, 0);
  const picked: RegenerableRow[] = [];
  for (const row of rows) {
    if (used <= limitBytes) break;
    if (!evictable(row)) continue;
    picked.push(row);
    used -= row.byteLength;
  }
  return picked;
}

/**
 * Tar bort ett innehåll ur förrådet: under radlåset prövas villkoren igen (`stillOk`), raden blir 'GONE' och arkivets rad märks
 * för borttagning; efter transaktionen tas objektet och filen i mellanlagret bort. Misslyckas borttagningen i förrådet tar
 * förrådets timvisa städning (`removeArchiveOrphans`) objektet senare. Ger om innehållet togs bort.
 */
export async function evictRegenerable(db: Database, store: ArchiveStore, sha256: string, now: Date,
  stillOk: (row: RegenerableRow | undefined) => boolean): Promise<boolean> {
  const gone = await db.transaction(async tx => {
    const [locked] = (await tx.execute(sql`select 1 from map_content where sha256 = ${sha256} and regenerable and stored_in = 'STORE' for update`)).rows;
    if (!locked) return false;
    const [row] = await regenerableRows(tx, { accountId: null, sha256 }, now);
    if (!stillOk(row)) return false;
    await tx.execute(sql`update map_content set stored_in = 'GONE', evicted_at = ${now} where sha256 = ${sha256}`);
    await tx.execute(sql`insert into map_content_archive (sha256, byte_length, archived_at, cold_at, orphaned_at)
      select sha256, byte_length, ${now}, ${now}, ${EVICTED_MARK} from map_content where sha256 = ${sha256}
      on conflict (sha256) do update set orphaned_at = ${EVICTED_MARK}`);
    return true;
  });
  if (!gone) return false;
  try {
    // Samma ordning som arkivets städning: radlåset mot en ny uppladdning av samma innehåll (som förnyar markeringen).
    await db.transaction(async tx => {
      const [row] = (await tx.execute(sql`delete from map_content_archive a where a.sha256 = ${sha256} and a.orphaned_at <= ${EVICTED_MARK}
        and not exists (select 1 from map_content c where c.sha256 = a.sha256 and c.stored_in <> 'GONE') returning 1`)).rows;
      if (row) await store.remove(sha256);
    });
  } catch (error) {
    console.error(`Förrådet: ett återskapbart objekt kunde inte tas bort nu och tas bort vid nästa städning: ${error instanceof Error ? error.message : String(error)}`);
  }
  const dir = usableMapCacheDir();
  if (dir) await rm(cachePath(dir, sha256), { force: true });
  return true;
}

export interface EnforceResult { readonly evicted: number; readonly evictedBytes: number; readonly overLimitProjects: string[];
  readonly skipped?: "RACE_DAY" | "NO_STORE" }

/** Gränsen för ett konto: det minst nyligen använda bort tills kontot är under gränsen (direkt efter ett sparande). */
export async function enforceRegenerableQuota(db: Database, accountId: string, now = new Date(), store: ArchiveStore | null = activeMapStore())
  : Promise<EnforceResult> {
  if (!store) return { evicted: 0, evictedBytes: 0, overLimitProjects: [], skipped: "NO_STORE" };
  const limit = await regenerableLimitBytes(db, accountId);
  const rows = await regenerableRows(db, { accountId }, now);
  if (rows.reduce((sum, row) => sum + row.byteLength, 0) <= limit) return { evicted: 0, evictedBytes: 0, overLimitProjects: [] };
  if (await raceDayNow(db, now)) return { evicted: 0, evictedBytes: 0, overLimitProjects: overLimitProjects(rows, limit), skipped: "RACE_DAY" };
  let evicted = 0, evictedBytes = 0;
  for (const row of pickRegenerableEvictions(rows, limit)) {
    if (await evictRegenerable(db, store, row.sha256, now, again => !!again && evictable(again))) { evicted += 1; evictedBytes += row.byteLength; }
  }
  return { evicted, evictedBytes, overLimitProjects: overLimitProjects(rows, limit) };
}

const throttle = globalThis as typeof globalThis & { oTidRegenerableChecked?: Map<string, number> };
/**
 * Efter ett sparande av återskapbart (laserns resultat, ett hämtat underlag): gränsen prövas direkt, högst var 30:e sekund per
 * konto och process (en körning skickar många filer; när körningen är klar prövas den alltid, `force`, och förrådets löpare prövar
 * alla konton var 5:e minut). Fel loggas.
 */
export async function afterRegenerableStored(db: Database, accountId: string | null, now = new Date(), force = false): Promise<void> {
  if (!accountId || !activeMapStore()) return;
  const checked = throttle.oTidRegenerableChecked ??= new Map();
  if (!force && (checked.get(accountId) ?? 0) > now.getTime() - 30_000) return;
  checked.set(accountId, now.getTime());
  try {
    const result = await enforceRegenerableQuota(db, accountId, now);
    if (result.evicted > 0) console.info(`Förrådet: ${result.evicted} återskapbara innehåll (${Math.round(result.evictedBytes / MB)} MB) borttagna för ett kontos gräns`);
  } catch (error) {
    console.error(`Förrådet: gränsen för återskapbart kunde inte prövas: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Laserkörningarnas resultat från före M4 (`regenerable = false`) får sitt recept: Karttapullautins resultatfiler i en klar
 * körning som inget annat än kartprojekten pekar på. Högst 500 per varv (förrådets löpare).
 */
export async function markLaserOutputsRegenerable(db: DbExecutor): Promise<number> {
  const result = await db.execute(sql`update map_content c set regenerable = true, recipe = jsonb_build_object('source', 'LASER', 'jobId', x.job_id,
      'output', x.name, 'tiles', x.tiles, 'clip', x.clip, 'scannedAt', null, 'settings', x.settings, 'createdAt', c.created_at)
    from (select distinct on (o.content_sha256) o.content_sha256 as sha, j.id as job_id, o.name, coalesce(jsonb_array_length(j.request->'tiles'), 0) as tiles,
        j.request->'clip' as clip, coalesce(j.request->'settings', '{}'::jsonb) as settings
      from map_project_geo_output o join map_project_geo_job j on j.id = o.job_id join map_content m on m.sha256 = o.content_sha256
      where j.kind = 'PULLAUTIN' and j.status = 'DONE' and o.name not like 'indata.%' and not m.regenerable and m.recipe is null
        and not exists (select 1 from race_map where content_sha256 = o.content_sha256)
        and not exists (select 1 from race_map_source where content_sha256 = o.content_sha256)
        and not exists (select 1 from training_group_map where content_sha256 = o.content_sha256)
        and not exists (select 1 from training_group_map_source where content_sha256 = o.content_sha256)
        and not exists (select 1 from club_map_version where content_sha256 = o.content_sha256)
        and not exists (select 1 from map_project where base_sha256 = o.content_sha256)
        and not exists (select 1 from map_project_output where content_sha256 = o.content_sha256)
      order by o.content_sha256, j.finished_at desc nulls last limit 500) x
    where c.sha256 = x.sha`);
  return result.rowCount ?? 0;
}

export interface RegenerableRoundResult { readonly marked: number; readonly evicted: number; readonly evictedBytes: number; readonly idle: number;
  readonly idleBytes: number; readonly raceDay: boolean; readonly errors: string[] }

/**
 * Förrådets löpare (var 5:e minut): recept på äldre laserresultat, gränsen för alla konton som passerar den och regeln om
 * orört. På tävlingsdygnet tas ingenting bort.
 */
export async function runRegenerableRound(db: Database, store: ArchiveStore, now = new Date()): Promise<RegenerableRoundResult> {
  const errors: string[] = [];
  const marked = await markLaserOutputsRegenerable(db);
  if (await raceDayNow(db, now)) return { marked, evicted: 0, evictedBytes: 0, idle: 0, idleBytes: 0, raceDay: true, errors };
  let evicted = 0, evictedBytes = 0, idle = 0, idleBytes = 0;
  const over = (await db.execute<{ id: string }>(sql`select a.id from user_account a join (select uploaded_by, sum(byte_length) as bytes from map_content
      where regenerable and stored_in in ('DB', 'STORE') and uploaded_by is not null group by uploaded_by) m on m.uploaded_by = a.id
    where m.bytes > coalesce(a.regenerable_quota_mb, ${DEFAULT_REGENERABLE_QUOTA_MB})::bigint * ${MB} limit 50`)).rows;
  for (const account of over) {
    try {
      const result = await enforceRegenerableQuota(db, account.id, now, store);
      evicted += result.evicted; evictedBytes += result.evictedBytes;
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  const days = await regenerableIdleDays(db);
  if (days !== null) {
    const rows = await regenerableRows(db, { accountId: null, usedBefore: new Date(now.getTime() - days * DAY), limit: 200 }, now);
    const cutoff = new Date(now.getTime() - days * DAY);
    for (const row of rows.filter(candidate => candidate.storedIn === "STORE" && !candidate.recent)) {
      try {
        if (await evictRegenerable(db, store, row.sha256, now, again => !!again && !again.recent && again.usedAt < cutoff)) {
          idle += 1; idleBytes += row.byteLength;
        }
      } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
  }
  return { marked, evicted, evictedBytes, idle, idleBytes, raceDay: false, errors: errors.slice(0, 5) };
}

/** Kontosidan: gränsen, det skyddade och vad som tas bort härnäst. */
export async function accountRegenerable(tx: DbExecutor, accountId: string, now = new Date()): Promise<AccountRegenerable> {
  const rows = await regenerableRows(tx, { accountId }, now);
  const limitBytes = await regenerableLimitBytes(tx, accountId);
  const [gone] = (await tx.execute<{ bytes: string }>(sql`select coalesce(sum(byte_length), 0)::text as bytes from map_content
    where uploaded_by = ${accountId}::uuid and stored_in = 'GONE'`)).rows;
  return {
    usedBytes: rows.reduce((sum, row) => sum + row.byteLength, 0), limitBytes,
    protectedBytes: rows.filter(row => row.protected).reduce((sum, row) => sum + row.byteLength, 0),
    idleDays: await regenerableIdleDays(tx),
    next: rows.filter(evictable).slice(0, 5).map(row => ({ projectName: row.projectName?.slice(0, 200) ?? null, label: row.label, source: row.source,
      bytes: row.byteLength, lastUsedAt: row.usedAt.toISOString() })),
    goneBytes: Number(gone?.bytes ?? 0), overLimitProjects: overLimitProjects(rows, limitBytes)
  };
}

/** Laserkörningens recept för en resultatfil (jobbets begäran är hela receptet; här det som visas och söks på). */
export function laserRecipe(job: { id: string; request: Record<string, unknown> }, output: string, now: Date): StoredRecipe {
  const request = job.request as { tiles?: { datetime?: unknown }[]; clip?: { minX: number; minY: number; maxX: number; maxY: number }; settings?: Record<string, number> };
  const dates = (request.tiles ?? []).map(tile => tile.datetime).filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date));
  return { source: "LASER", jobId: job.id, output, tiles: request.tiles?.length ?? 0, clip: request.clip ?? null,
    scannedAt: dates.length ? dates.map(date => date.slice(0, 10)).sort().at(-1)! : null, settings: request.settings ?? {}, createdAt: now.toISOString() };
}
