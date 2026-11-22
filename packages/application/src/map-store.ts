import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "./snapshot";
import { archiveConnection, mapArchiveStore, type ArchiveStore } from "./map-archive-store";
import { stagingPath, usableMapCacheDir } from "./map-cache";

/**
 * ADR-0229 (PLAN.md steg M1): förrådet för kartinnehåll. Med `OTID_STORE_MODE=on` (och fullständiga `OTID_ARCHIVE_*`)
 * laddas nytt kartinnehåll upp till objektlagringen (samma bucket och nycklar som arkivet, objektet `map-content/<sha256>`),
 * läses tillbaka och kontrolleras (längd och sha256) innan det räknas som sparat; inga delar skrivs i `map_content_part`.
 * Uppladdningen strömmas till en fil i mellanlagret (`.staging/<id>`) och därifrån till förrådet, så att webben aldrig håller
 * hela filen i minnet. Uppladdningen och mellanlagret sköts utanför databasens transaktion (`storeMapContent`).
 *
 * Med `off` (förval) skrivs allt som förut i databasen. Läsningen avgörs av raden (`stored_in`), inte av läget: innehåll i
 * förrådet går att läsa också när läget slagits av igen, så länge `OTID_ARCHIVE_*` finns.
 *
 * Varje innehåll i förrådet har också en rad i `map_content_archive` (`cold_at` satt: inga delar här). Då gäller arkivets
 * städning för det (ADR-0224 beslut 7: objektet raderas först `OTID_ARCHIVE_ORPHAN_DAYS` efter att innehållet släppts), och
 * en äldre kodversion som saknar förrådet hämtar det ur arkivet som vanligt arkiverat innehåll.
 */
export type StoreMode = "off" | "on";
type Env = Partial<Record<string, string | undefined>>;
const globalStore = globalThis as typeof globalThis & { oTidMapStoreMode?: StoreMode; oTidMapStoreWarned?: boolean };

/** `OTID_STORE_MODE`: off (förval) eller on. */
export function storeMode(env: Env = process.env): StoreMode {
  if (globalStore.oTidMapStoreMode) return globalStore.oTidMapStoreMode;
  return env.OTID_STORE_MODE?.trim().toLowerCase() === "on" ? "on" : "off";
}

/** Sätter läget (tester); undefined = miljön igen. */
export function setMapStoreMode(mode: StoreMode | undefined): void {
  if (mode === undefined) delete globalStore.oTidMapStoreMode; else globalStore.oTidMapStoreMode = mode;
}

/** Fel inställningar, för loggen vid start. */
export function storeModeProblems(env: Env): string[] {
  const value = env.OTID_STORE_MODE?.trim().toLowerCase();
  const problems: string[] = [];
  if (value && value !== "on" && value !== "off") problems.push("OTID_STORE_MODE ska vara off eller on; förrådet är av");
  if (value === "on" && !archiveConnection(env)) {
    problems.push("Förrådet är på (OTID_STORE_MODE=on) men OTID_ARCHIVE_ENDPOINT, _BUCKET, _ACCESS_KEY eller _SECRET_KEY saknas; " +
      "nytt kartinnehåll sparas i databasen som förut");
  }
  return problems;
}

/**
 * Förrådet som nytt innehåll skrivs till, eller null (läget av, uppgifterna ofullständiga eller mellanlagret inte skrivbart).
 * Ett påslaget läge utan uppgifter varnar en gång i loggen.
 */
export function activeMapStore(env: Env = process.env): ArchiveStore | null {
  if (storeMode(env) !== "on") return null;
  const store = mapArchiveStore(env);
  if (!store) {
    if (!globalStore.oTidMapStoreWarned) {
      globalStore.oTidMapStoreWarned = true;
      console.warn("Förrådet är på men objektlagringens uppgifter (OTID_ARCHIVE_*) är inte fullständiga; nytt kartinnehåll sparas i databasen");
    }
    return null;
  }
  return usableMapCacheDir(env) ? store : null;
}

/** En uppladdning strömmad till en fil i mellanlagret (i stället för till `map_content_part`). */
export interface FileStage { readonly contentId: string; readonly file: string; readonly sha256: string; readonly byteLength: number;
  readonly head: Uint8Array }

/** Strömmar till `.staging/<id>` och räknar sha256; över `maxBytes` avbryts läsningen och filen tas bort. */
export async function stageMapContentToFile(chunks: AsyncIterable<Uint8Array>, options: { maxBytes: number; headBytes: number })
  : Promise<FileStage | { kind: "too-large" } | { kind: "empty" }> {
  const dir = usableMapCacheDir();
  if (!dir) throw new Error("Mellanlagret går inte att skriva i");
  const contentId = randomUUID();
  const file = stagingPath(dir, contentId);
  const hash = createHash("sha256");
  const head = new Uint8Array(options.headBytes);
  let headLength = 0, total = 0, tooLarge = false;
  const counted = async function* () {
    for await (const chunk of chunks) {
      total += chunk.byteLength;
      if (total > options.maxBytes) { tooLarge = true; return; }
      hash.update(chunk);
      if (headLength < head.length) {
        const take = Math.min(head.length - headLength, chunk.byteLength);
        head.set(chunk.subarray(0, take), headLength);
        headLength += take;
      }
      yield chunk;
    }
  };
  try {
    await pipeline(counted, createWriteStream(file, { flags: "wx" }));
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
  if (tooLarge) { await rm(file, { force: true }); return { kind: "too-large" }; }
  if (total === 0) { await rm(file, { force: true }); return { kind: "empty" }; }
  return { contentId, file, sha256: hash.digest("hex"), byteLength: total, head: head.slice(0, headLength) };
}

/** Tar bort en strömmad fil om den finns kvar (ofarligt efter registreringen, då den redan flyttats in i mellanlagret). */
export async function discardStagedFile(contentId: string): Promise<void> {
  // Med läget av strömmas inget till filer (och mellanlagrets katalog ska då inte ens skapas).
  if (storeMode() !== "on") return;
  const dir = usableMapCacheDir();
  if (dir) await rm(stagingPath(dir, contentId), { force: true });
}

export type StoreSource = { file: string } | { bytes: Uint8Array };

/**
 * Laddar upp och kontrollerar: först när objektet finns med rätt längd är innehållet i förrådet.
 *
 * Ägaren 2026-11-22 (laserkörningarna gick långsamt och föll med «Arkivet: hämtningen misslyckades (504)»): kontrollen läste
 * förut tillbaka hela objektet, så en fil på 77 MB gick upp och ner igen medan geo-serverns anrop väntade. Innehållet är redan
 * kontrollerat vid uppladdningen: anropet signeras med innehållets sha256 (`x-amz-content-sha256`), och objektlagringen nekar
 * en kropp som inte stämmer. Kvar är en HEAD som visar att objektet finns och har rätt längd.
 */
export async function uploadToStore(store: ArchiveStore, sha256: string, byteLength: number, source: StoreSource): Promise<void> {
  if ("file" in source) await store.putFile(sha256, source.file, byteLength);
  else await store.put(sha256, source.bytes);
  if (await store.size(sha256) !== byteLength) throw new Error("Kopian i förrådet stämmer inte med originalet");
}

/**
 * Granskningen runda 2 (A): uppladdningen görs utanför transaktionen och föregås av en reservation, arkivets rad för
 * innehållet markerad som släppt (`orphaned_at` = nu). Rullas transaktionen tillbaka, eller tar kvoten slut, ligger objektet
 * kvar som släppt och tas bort av arkivets städning efter fristen (`removeArchiveOrphans`). Städningen tar bara bort rader
 * vars frist gått ut, så en färsk reservation skyddar objektet. Håller städningen på att ta bort samma objekt väntar
 * reservationen tills den är klar (radlåset), och uppladdningen sker efter borttagningen. Finns innehållet redan görs inget.
 */
export async function reserveStoreUpload(db: DbExecutor, sha256: string, byteLength: number, now: Date): Promise<void> {
  await db.execute(sql`insert into map_content_archive (sha256, byte_length, archived_at, cold_at, orphaned_at)
    select ${sha256}, ${byteLength}, ${now}, ${now}, ${now} where not exists (select 1 from map_content where sha256 = ${sha256})
    on conflict (sha256) do update set orphaned_at = excluded.orphaned_at`);
}

/**
 * Står reservationen kvar (raden finns och har inte släppts före reservationen)? Raden låses tills transaktionen är klar,
 * så att städningen inte kan ta bort objektet innan innehållet är registrerat. Anropas under låset i `storeMapContent`.
 */
export async function storeReservationHolds(tx: DbExecutor, sha256: string, reservedAt: Date): Promise<boolean> {
  const [row] = (await tx.execute<{ holds: boolean }>(sql`select (orphaned_at is null or orphaned_at >= ${reservedAt}) as holds
    from map_content_archive where sha256 = ${sha256} for update`)).rows;
  return row?.holds === true;
}

/**
 * Registrerar innehållet som ligger i förrådet (anroparens transaktion, efter kvoten). Arkivets rad markerar att delarna
 * inte finns här (se överst). Bara databasen: filen lades i mellanlagret redan vid uppladdningen.
 */
export async function registerStoredMapContent(tx: DbExecutor, input: { sha256: string; contentId: string; byteLength: number;
  accountId: string | null }, now: Date): Promise<void> {
  await tx.execute(sql`insert into map_content (sha256, content_id, byte_length, uploaded_by, created_at, stored_in, last_used_at)
    values (${input.sha256}, ${input.contentId}, ${input.byteLength}, ${input.accountId}, ${now}, 'STORE', ${now})`);
  await tx.execute(sql`insert into map_content_archive (sha256, byte_length, archived_at, cold_at) values (${input.sha256}, ${input.byteLength}, ${now}, ${now})
    on conflict (sha256) do update set byte_length = excluded.byte_length, archived_at = excluded.archived_at, cold_at = excluded.cold_at,
      restored_at = null, orphaned_at = null`);
}

/**
 * Ett uppladdat objekt som inte blev innehåll (kvoten tog slut under tiden): det får arkivets rad som släppt, så att
 * städningen tar bort det efter fristen. Finns innehållet (någon annan sparade samma) rörs ingenting.
 */
export async function releaseUnusedUpload(tx: DbExecutor, sha256: string, byteLength: number, now: Date): Promise<void> {
  await tx.execute(sql`insert into map_content_archive (sha256, byte_length, archived_at, cold_at, orphaned_at)
    select ${sha256}, ${byteLength}, ${now}, ${now}, ${now} where not exists (select 1 from map_content where sha256 = ${sha256})
    on conflict (sha256) do nothing`);
}
