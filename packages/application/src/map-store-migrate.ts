import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { digestStream, type ArchiveStore } from "./map-archive-store";
import { raceDayNow } from "./map-archive";
import { releaseUnusedUpload, uploadToStore } from "./map-store";
import { cachedWithLength, fetchIntoCache, markPinned, placeInCache, stagingPath, usableMapCacheDir } from "./map-cache";
import { pinnedContentNow } from "./map-pin";
import {
  inMigrateWindow, releaseMigrateLease, saveMigrateSummary, takeMigrateLease, type MigrateRunSummary, type MigrateSettings
} from "./map-store-migrate-settings";

/**
 * PLAN.md steg M3 (ADR-0229, tillägg 2026-11-21 (M3)): befintligt kartinnehåll (`map_content.stored_in = 'DB'`) flyttas ur
 * PostgreSQL till förrådet, i omgångar.
 *
 * Ett innehåll i taget:
 * 1. **Uppladdningen:** delarna strömmas till en fil i mellanlagret (`.staging/`), kontrolleras mot sin sha256 och längd,
 *    laddas upp och läses tillbaka (`uploadToStore`). Innehåll som arkivet (L5) redan laddat upp kontrolleras i stället i
 *    förrådet (längd och sha256), och innehåll som arkivet redan tagit bort här (`cold_at`) jämförs med objektets längd:
 *    ingen dubbel uppladdning.
 * 2. **Bytet:** i en transaktion som låser raden kontrolleras att den fortfarande är 'DB' med samma `content_id` och att
 *    delarna är hela (eller att den ligger i arkivet); sedan `stored_in = 'STORE'` och arkivets rad med `cold_at` (ADR-0229
 *    beslut 4). `cold_at` är också fristens början.
 * 3. **Fastspikat:** behövs innehållet av en tävling eller träning i fastspikningsfönstret (M2) läggs filen i mellanlagret och
 *    spikas direkt, så att tävlingen aldrig behöver förrådet.
 * 4. **Fristen:** delarna tas bort `graceHours` (24) efter bytet, när objektets längd i förrådet har kontrollerats igen.
 *    Under fristen läser `readMapContent` fortfarande delarna. Saknas objektet laddas det upp igen ur delarna och fristen
 *    börjar om.
 *
 * Ordningen: laserkörningars resultat, underlag, grundfiler och övrigt, sist tävlingars och träningars kartor; störst först
 * inom varje. Aldrig på tävlingsdygnet (ADR-0178), inte heller med «Flytta nu». Nattfönstret gäller bara löparen.
 *
 * **Återkopplingen** (efter en återställning av en äldre dump): en rad 'DB' utan delar och utan arkivets `cold_at` vars objekt
 * finns i förrådet med rätt längd blir 'STORE'. Objektet heter efter sin sha256 och laddades bara upp kontrollerat, så längden
 * räcker. Den görs varje varv, också utanför fönstret och på tävlingsdygnet (den ändrar bara en markering och gör kartor
 * läsbara igen).
 */
export type MigrateCategory = "LASER" | "UNDERLAY" | "BASE" | "RACE";
const CATEGORY_ORDER: readonly MigrateCategory[] = ["LASER", "UNDERLAY", "BASE", "RACE"];
const HOUR = 60 * 60_000;

export interface MigrateCandidate {
  readonly sha256: string;
  readonly contentId: string;
  readonly byteLength: number;
  readonly category: MigrateCategory;
  /** Arkivet (L5) har laddat upp och kontrollerat det; delarna kan ligga kvar här. */
  readonly archived: boolean;
  /** Arkivet har tagit bort delarna här (`cold_at`): innehållet finns bara i förrådet. */
  readonly cold: boolean;
}

/** Vilken grupp ett innehåll hör till efter vad som pekar på det (det sista i ordningen vinner: tävlingen går sist). */
export function categoryOf(refs: { race: boolean; base: boolean; layer: boolean; laser: boolean }): MigrateCategory {
  if (refs.race) return "RACE";
  if (refs.base) return "BASE";
  if (refs.layer) return "UNDERLAY";
  return refs.laser ? "LASER" : "BASE";
}

/** Ordningen (ren funktion): gruppen, sedan störst först, sedan sha256 så att ordningen är stabil. */
export function orderMigrateCandidates(candidates: readonly MigrateCandidate[]): MigrateCandidate[] {
  return [...candidates].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    || b.byteLength - a.byteLength || a.sha256.localeCompare(b.sha256));
}

/** Allt som ligger kvar i databasen, i flyttordning. */
export async function planMapMigration(tx: DbExecutor): Promise<MigrateCandidate[]> {
  const rows = (await tx.execute<{ sha256: string; content_id: string; byte_length: string; archived: boolean; cold: boolean; race: boolean;
    base: boolean; layer: boolean; laser: boolean }>(sql`select c.sha256, c.content_id, c.byte_length::text,
      a.archived_at is not null as archived, a.cold_at is not null as cold,
      (exists (select 1 from race_map where content_sha256 = c.sha256) or exists (select 1 from race_map_source where content_sha256 = c.sha256)
        or exists (select 1 from training_group_map where content_sha256 = c.sha256)
        or exists (select 1 from training_group_map_source where content_sha256 = c.sha256)) as race,
      (exists (select 1 from map_project where base_sha256 = c.sha256) or exists (select 1 from map_project_output where content_sha256 = c.sha256)
        or exists (select 1 from club_map_version where content_sha256 = c.sha256)) as base,
      exists (select 1 from map_project_layer where content_sha256 = c.sha256) as layer,
      exists (select 1 from map_project_geo_output where content_sha256 = c.sha256) as laser
    from map_content c left join map_content_archive a on a.sha256 = c.sha256
    where c.stored_in = 'DB'`)).rows;
  return orderMigrateCandidates(rows.map(row => ({ sha256: row.sha256, contentId: row.content_id, byteLength: Number(row.byte_length),
    category: categoryOf(row), archived: row.archived, cold: row.cold })));
}

/** Delarna i ordning, en i taget (aldrig hela innehållet i minnet). */
async function* partsOf(db: DbExecutor, contentId: string): AsyncGenerator<Uint8Array> {
  for (let part = 0; ; part++) {
    const [row] = (await db.execute<{ data: Buffer }>(sql`select data from map_content_part where content_id = ${contentId}::uuid
      and part = ${part}`)).rows;
    if (!row) return;
    yield row.data;
  }
}

/** Delarna till en fil i mellanlagret, kontrollerade mot innehållets sha256 och längd. */
async function partsToFile(db: DbExecutor, dir: string, candidate: Pick<MigrateCandidate, "sha256" | "contentId" | "byteLength">): Promise<string> {
  const file = stagingPath(dir, randomUUID());
  try {
    const got = await digestStream(partsOf(db, candidate.contentId), file);
    if (got.byteLength !== candidate.byteLength || got.sha256 !== candidate.sha256) throw new Error("innehållet i databasen stämmer inte med sin kontrollsumma");
    return file;
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
}

type MoveOutcome = { moved: boolean; uploadedBytes: number };

/** Flyttar ett innehåll (punkterna 1–3 överst). */
export async function migrateOne(db: Database, store: ArchiveStore, dir: string, candidate: MigrateCandidate, now: Date): Promise<MoveOutcome> {
  let file: string | null = null, uploadedBytes = 0;
  try {
    if (candidate.cold) {
      if (await store.size(candidate.sha256) !== candidate.byteLength) throw new Error("arkiverat innehåll saknas i förrådet eller har fel storlek");
    } else {
      const known = candidate.archived ? await store.digest(candidate.sha256) : undefined;
      if (!known || known.byteLength !== candidate.byteLength || known.sha256 !== candidate.sha256) {
        file = await partsToFile(db, dir, candidate);
        await uploadToStore(store, candidate.sha256, candidate.byteLength, { file });
        uploadedBytes = candidate.byteLength;
      }
    }
    const moved = await db.transaction(async tx => {
      const [row] = (await tx.execute<{ content_id: string; stored_in: string; byte_length: string; complete: boolean; cold: boolean }>(sql`select
          c.content_id, c.stored_in, c.byte_length::text,
          (select coalesce(sum(octet_length(p.data)), 0) from map_content_part p where p.content_id = c.content_id) = c.byte_length as complete,
          exists (select 1 from map_content_archive a where a.sha256 = c.sha256 and a.cold_at is not null) as cold
        from map_content c where c.sha256 = ${candidate.sha256} for update of c`)).rows;
      if (!row) {
        // Innehållet släpptes under tiden: objektet tas bort av arkivets städning efter fristen.
        if (uploadedBytes > 0) await releaseUnusedUpload(tx, candidate.sha256, candidate.byteLength, now);
        return false;
      }
      if (row.stored_in !== "DB" || row.content_id !== candidate.contentId || Number(row.byte_length) !== candidate.byteLength) return false;
      if (!row.complete && !(candidate.cold && row.cold)) return false;
      await tx.execute(sql`update map_content set stored_in = 'STORE' where sha256 = ${candidate.sha256}`);
      await tx.execute(sql`insert into map_content_archive (sha256, byte_length, archived_at, cold_at)
        values (${candidate.sha256}, ${candidate.byteLength}, ${now}, ${now})
        on conflict (sha256) do update set byte_length = excluded.byte_length,
          archived_at = coalesce(map_content_archive.archived_at, excluded.archived_at),
          cold_at = coalesce(map_content_archive.cold_at, excluded.cold_at), restored_at = null, orphaned_at = null`);
      return true;
    });
    if (moved && candidate.category === "RACE") {
      const pinned = (await pinnedContentNow(db, now)).some(content => content.sha256 === candidate.sha256);
      if (pinned) {
        await markPinned(dir, [candidate.sha256], now);
        if (file) { await placeInCache(db, candidate.sha256, { file }, candidate.byteLength); file = null; }
        else if (!await cachedWithLength(dir, candidate.sha256, candidate.byteLength)) {
          await (await fetchIntoCache(store, dir, candidate.sha256, candidate.byteLength)).close();
        }
      }
    }
    return { moved, uploadedBytes };
  } finally {
    if (file) await rm(file, { force: true });
  }
}

/**
 * Fristen (punkt 4): tar bort delarna för flyttat innehåll vars frist gått ut. Objektets längd i förrådet kontrolleras först;
 * stämmer den inte laddas innehållet upp igen ur delarna och fristen börjar om.
 */
export async function releaseMovedParts(db: Database, store: ArchiveStore, dir: string, graceHours: number, now: Date,
  budget: { bytes: number }): Promise<{ freed: number; freedBytes: number; errors: string[] }> {
  const rows = (await db.execute<{ sha256: string; content_id: string; byte_length: string }>(sql`select c.sha256, c.content_id, c.byte_length::text
    from map_content c join map_content_archive a on a.sha256 = c.sha256
    where c.stored_in = 'STORE' and a.cold_at <= ${new Date(now.getTime() - graceHours * HOUR)}
      and exists (select 1 from map_content_part p where p.content_id = c.content_id)
    order by c.byte_length desc limit 500`)).rows;
  let freed = 0, freedBytes = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const byteLength = Number(row.byte_length);
    try {
      if (await store.size(row.sha256) !== byteLength) {
        let file: string | null = null;
        try {
          file = await partsToFile(db, dir, { sha256: row.sha256, contentId: row.content_id, byteLength });
          await uploadToStore(store, row.sha256, byteLength, { file });
          budget.bytes -= byteLength;
        } finally { if (file) await rm(file, { force: true }); }
        await db.execute(sql`update map_content_archive set cold_at = ${now} where sha256 = ${row.sha256}`);
        throw new Error("objektet saknades i förrådet; uppladdat igen, delarna ligger kvar en frist till");
      }
      const done = await db.transaction(async tx => {
        const [content] = (await tx.execute<{ stored_in: string; content_id: string }>(sql`select stored_in, content_id from map_content
          where sha256 = ${row.sha256} for update`)).rows;
        if (content?.stored_in !== "STORE" || content.content_id !== row.content_id) return false;
        await tx.execute(sql`delete from map_content_part where content_id = ${row.content_id}::uuid`);
        return true;
      });
      if (done) { freed += 1; freedBytes += byteLength; }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { freed, freedBytes, errors };
}

/** Återkopplingen (överst): rader 'DB' utan delar vars objekt finns i förrådet blir 'STORE'. Ger antal och de som saknas. */
export async function reconcileStoredContent(db: Database, store: ArchiveStore, now: Date): Promise<{ reconciled: number; missing: number }> {
  const rows = (await db.execute<{ sha256: string; content_id: string; byte_length: string }>(sql`select c.sha256, c.content_id, c.byte_length::text
    from map_content c left join map_content_archive a on a.sha256 = c.sha256
    where c.stored_in = 'DB' and a.cold_at is null and c.created_at < ${new Date(now.getTime() - HOUR)}
      and not exists (select 1 from map_content_part p where p.content_id = c.content_id)
    limit 500`)).rows;
  let reconciled = 0, missing = 0;
  for (const row of rows) {
    if (await store.size(row.sha256) !== Number(row.byte_length)) { missing += 1; continue; }
    const done = await db.transaction(async tx => {
      const [content] = (await tx.execute<{ stored_in: string }>(sql`select stored_in from map_content where sha256 = ${row.sha256}
        and not exists (select 1 from map_content_part p where p.content_id = map_content.content_id) for update`)).rows;
      if (content?.stored_in !== "DB") return false;
      await tx.execute(sql`update map_content set stored_in = 'STORE' where sha256 = ${row.sha256}`);
      await tx.execute(sql`insert into map_content_archive (sha256, byte_length, archived_at, cold_at) values (${row.sha256}, ${Number(row.byte_length)}, ${now}, ${now})
        on conflict (sha256) do update set byte_length = excluded.byte_length, cold_at = coalesce(map_content_archive.cold_at, excluded.cold_at),
          restored_at = null, orphaned_at = null`);
      return true;
    });
    if (done) reconciled += 1;
  }
  return { reconciled, missing };
}

export interface MigrateRunOptions {
  readonly trigger: MigrateRunSummary["trigger"];
  /** Tiden för varvet (tester); annars klockan, som också läses igen mellan innehållen. */
  readonly now?: Date;
  /** Mängden per varv (kommandots `--mb`); annars inställningen. */
  readonly runBytes?: number;
  /** Förloppet (kommandot skriver det). */
  readonly onProgress?: (line: string) => void;
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Ett varv: återkopplingen, sedan (inte på tävlingsdygnet och, för löparen, bara i fönstret) fristens borttagningar och
 * flytten av högst `runBytes`. Ett innehåll större än mängden flyttas ensamt i ett varv. Resultatet sparas för
 * superadminsidan. Ett fel på ett innehåll stoppar inte de andra.
 */
export async function runMapMigration(db: Database, store: ArchiveStore, settings: MigrateSettings, options: MigrateRunOptions): Promise<MigrateRunSummary> {
  const clock = () => options.now ?? new Date();
  const start = clock();
  const dir = usableMapCacheDir();
  const holder = randomUUID();
  const progress = options.onProgress ?? (() => undefined);
  const result = { at: start.toISOString(), trigger: options.trigger, stopped: null as MigrateRunSummary["stopped"], moved: 0, movedBytes: 0,
    uploadedBytes: 0, freed: 0, freedBytes: 0, reconciled: 0, failed: 0, errors: [] as string[] };
  const fail = (error: unknown) => {
    result.failed += 1;
    if (result.errors.length < 3) result.errors.push(error instanceof Error ? error.message : String(error));
  };
  if (!dir) throw new Error("Mellanlagret går inte att skriva i; flytten kräver det");
  if (!await takeMigrateLease(db, holder, start)) {
    progress("En annan flytt pågår (webbens löpare eller ett annat kommando); försök igen om en stund.");
    return { ...result, stopped: "BUSY" };
  }
  try {
    const reconciled = await reconcileStoredContent(db, store, start);
    result.reconciled = reconciled.reconciled;
    if (reconciled.reconciled > 0) progress(`Återkopplat: ${reconciled.reconciled} innehåll som redan låg i förrådet.`);
    if (reconciled.missing > 0) fail(new Error(`${reconciled.missing} innehåll saknar delar här och finns inte i förrådet`));
    const stopReason = async (): Promise<MigrateRunSummary["stopped"]> => {
      const now = clock();
      if (await raceDayNow(db, now)) return "RACE_DAY";
      if (options.trigger === "NIGHT" && !inMigrateWindow(now, settings)) return "WINDOW";
      return null;
    };
    result.stopped = await stopReason();
    if (result.stopped) {
      progress(result.stopped === "RACE_DAY" ? "Tävlingsdygn: ingenting flyttas i dag (ADR-0178)." : "Utanför nattfönstret.");
      return result;
    }
    const budget = { bytes: options.runBytes ?? settings.runBytes };
    const released = await releaseMovedParts(db, store, dir, settings.graceHours, clock(), budget);
    result.freed = released.freed; result.freedBytes = released.freedBytes;
    for (const error of released.errors) fail(error);
    if (released.freed > 0) progress(`Fristen ute: delarna borttagna för ${released.freed} innehåll (${mb(released.freedBytes)}).`);
    const candidates = await planMapMigration(db);
    progress(`Kvar i databasen: ${candidates.length} innehåll (${mb(candidates.reduce((sum, c) => sum + c.byteLength, 0))}); högst ${mb(Math.max(budget.bytes, 0))} i det här varvet.`);
    let index = 0;
    for (const candidate of candidates) {
      index += 1;
      const upload = candidate.cold || candidate.archived ? 0 : candidate.byteLength;
      if (upload > 0 && result.uploadedBytes > 0 && upload > budget.bytes) { result.stopped = "BUDGET"; continue; }
      const reason = await stopReason();
      if (reason) { result.stopped = reason; break; }
      try {
        await takeMigrateLease(db, holder, clock());
        const outcome = await migrateOne(db, store, dir, candidate, clock());
        result.uploadedBytes += outcome.uploadedBytes;
        budget.bytes -= outcome.uploadedBytes;
        if (outcome.moved) { result.moved += 1; result.movedBytes += candidate.byteLength; }
        progress(`[${index}/${candidates.length}] ${candidate.category} ${mb(candidate.byteLength)} ${candidate.sha256.slice(0, 12)}: ` +
          `${outcome.moved ? outcome.uploadedBytes > 0 ? "uppladdat och kontrollerat" : "fanns redan i förrådet" : "ändrades under tiden, tas nästa varv"}`);
      } catch (error) {
        fail(error);
        progress(`[${index}/${candidates.length}] ${candidate.category} ${mb(candidate.byteLength)} ${candidate.sha256.slice(0, 12)}: FEL ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  } finally {
    await saveMigrateSummary(db, result, clock()).catch(error => fail(error));
    await releaseMigrateLease(db, holder);
  }
}
