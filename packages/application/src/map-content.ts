import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { OutsideTransactionWork, type Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { sha256Hex } from "./serialization";
import { restoreMapContent } from "./map-archive";
import { placeInCache, readStoredMapContent } from "./map-cache";
import { activeMapStore, discardStagedFile, registerStoredMapContent, reserveStoreUpload, stageMapContentToFile, storeReservationHolds,
  uploadToStore, type StoreSource } from "./map-store";

/**
 * ADR-0189 beslut 1–3: kartbilder och kartfiler lagras en gång (`map_content`, adresserat med sha256) i delar om högst 1 MiB
 * (`map_content_part`). Tävlingar, kopior, träningstillfällen och gruppens bibliotek pekar på innehållet med `content_sha256`;
 * en kopia kopierar bara referensen. Utlösaren i migration 0044 tar bort innehållet när sista referensen försvinner.
 *
 * Uppladdningen strömmas: delarna skrivs till databasen medan bodyn läses (`stageMapContent`), så webben håller högst en del
 * i minnet. Först när filen är kontrollerad sparas innehållets rad i samma transaktion som referensen (`storeMapContent`), med
 * kvoten per konto och installation kontrollerad. Delar som aldrig fick någon rad tas bort (`discardStagedMapContent`, och
 * underhållet efter ett dygn).
 *
 * ADR-0229 (PLAN.md steg M1): med förrådet påslaget (`OTID_STORE_MODE=on`, `map-store.ts`) strömmas uppladdningen i stället
 * till en fil i mellanlagret och laddas upp till förrådet i `storeMapContent`; raden får `stored_in = 'STORE'` och inga delar.
 * Läsningen går via samma funktioner (`readMapContent`, `rowContent`, `streamMapContentParts` i club-maps.ts) och avgörs av
 * raden: 'DB' läses som förut, 'STORE' ur mellanlagret eller förrådet (`map-cache.ts`).
 */
export const MAP_CONTENT_PART_BYTES = 1024 * 1024;
/** Så mycket av filens början som hålls i minnet för kontrollen av format och bildens mått. */
export const MAP_CONTENT_HEAD_BYTES = 256 * 1024;
const MB = 1024 * 1024;

/** En uppladdning som strömmats till databasen men ännu inte sparats som innehåll. */
export interface StagedMapContent {
  readonly kind: "staged";
  readonly contentId: string;
  readonly sha256: string;
  readonly byteLength: number;
  /** Filens första byte (högst `MAP_CONTENT_HEAD_BYTES`). */
  readonly head: Uint8Array;
  /** ADR-0229: uppladdningen ligger i en fil i mellanlagret (förrådet påslaget) i stället för i `map_content_part`. */
  readonly file?: string;
}

/** Innehåll att spara: bytes i minnet (tester, små filer) eller en strömmad uppladdning. */
export type MapContentInput = Uint8Array | StagedMapContent;

export const isStaged = (input: MapContentInput): input is StagedMapContent => !(input instanceof Uint8Array);
export const contentLength = (input: MapContentInput) => isStaged(input) ? input.byteLength : input.byteLength;
export const contentHead = (input: MapContentInput) => isStaged(input) ? input.head : input.subarray(0, MAP_CONTENT_HEAD_BYTES);
export const contentSha256 = (input: MapContentInput) => isStaged(input) ? input.sha256 : sha256Hex(input);

export type StageResult = StagedMapContent | { kind: "too-large" } | { kind: "empty" };

/**
 * Skriver en ström i delar om 1 MiB till `map_content_part` (varje del i en egen kort skrivning) och räknar sha256 på vägen.
 * Över `maxBytes` avbryts läsningen och det som skrivits tas bort.
 */
export async function stageMapContent(db: Database, chunks: AsyncIterable<Uint8Array>, options: { maxBytes: number; now?: Date })
  : Promise<StageResult> {
  if (activeMapStore()) {
    const staged = await stageMapContentToFile(chunks, { maxBytes: options.maxBytes, headBytes: MAP_CONTENT_HEAD_BYTES });
    return "kind" in staged ? staged : { kind: "staged", ...staged };
  }
  const contentId = randomUUID();
  const hash = createHash("sha256");
  const head = new Uint8Array(MAP_CONTENT_HEAD_BYTES);
  let headLength = 0, total = 0, part = 0;
  let buffer = new Uint8Array(MAP_CONTENT_PART_BYTES), filled = 0;
  const now = options.now ?? new Date();
  const flush = async () => {
    if (filled === 0) return;
    await db.execute(sql`insert into map_content_part (content_id, part, data, created_at)
      values (${contentId}, ${part}, ${Buffer.from(buffer.buffer, 0, filled)}, ${now})`);
    part += 1;
    buffer = new Uint8Array(MAP_CONTENT_PART_BYTES);
    filled = 0;
  };
  try {
    for await (const chunk of chunks) {
      total += chunk.byteLength;
      if (total > options.maxBytes) {
        await discardStagedMapContent(db, contentId);
        return { kind: "too-large" };
      }
      hash.update(chunk);
      if (headLength < head.length) {
        const take = Math.min(head.length - headLength, chunk.byteLength);
        head.set(chunk.subarray(0, take), headLength);
        headLength += take;
      }
      let offset = 0;
      while (offset < chunk.byteLength) {
        const take = Math.min(MAP_CONTENT_PART_BYTES - filled, chunk.byteLength - offset);
        buffer.set(chunk.subarray(offset, offset + take), filled);
        filled += take; offset += take;
        if (filled === MAP_CONTENT_PART_BYTES) await flush();
      }
    }
    await flush();
  } catch (error) {
    await discardStagedMapContent(db, contentId).catch(() => undefined);
    throw error;
  }
  if (total === 0) return { kind: "empty" };
  return { kind: "staged", contentId, sha256: hash.digest("hex"), byteLength: total, head: head.slice(0, headLength) };
}

/** Tar bort en strömmad uppladdnings delar om de inte blev sparat innehåll. Ofarlig att anropa efter `storeMapContent`. */
export async function discardStagedMapContent(db: DbExecutor, contentId: string): Promise<void> {
  await discardStagedFile(contentId);
  await db.execute(sql`delete from map_content_part where content_id = ${contentId}
    and not exists (select 1 from map_content where content_id = ${contentId})`);
}

/** Kvoten (ADR-0189 beslut 3). Null = ingen gräns. */
export interface MapStorageQuota { readonly accountBytes: number | null; readonly totalBytes: number | null }
/** ADR-0229: förvalet per konto höjt från 2048 till 5120 MB (ägaren 2026-11-21). */
export const DEFAULT_MAP_QUOTA_ACCOUNT_MB = 5120;
/** Installationens totala gräns när allt ligger på serverns disk. */
export const DEFAULT_MAP_QUOTA_TOTAL_MB = 20480;
/** ADR-0229: med förrådet påslaget ligger nytt innehåll i objektlagringen; förvalet är 1 TB (det som grundpriset omfattar). */
export const DEFAULT_MAP_QUOTA_TOTAL_STORE_MB = 1_048_576;
/** ADR-0229: förvalet för kontots återskapbara innehåll (PLAN.md steg M4). */
export const DEFAULT_REGENERABLE_QUOTA_MB = 10_240;

/**
 * `OTID_MAP_QUOTA_ACCOUNT_MB` (förval 5120) och `OTID_MAP_QUOTA_TOTAL_MB` (förval 20480, med förrådet påslaget 1 048 576);
 * 0 stänger av gränsen. Ett ogiltigt värde ger förvalet (och `startup-check` skriver det i loggen). Superadmins inställning
 * av totalgränsen (`installation_setting`) går före och läses i `storeMapContent`.
 */
export function mapStorageQuota(env: Partial<Record<string, string | undefined>> = process.env): MapStorageQuota {
  const read = (value: string | undefined, fallback: number) => {
    const trimmed = value?.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return fallback * MB;
    const parsed = Number(trimmed);
    return parsed === 0 ? null : parsed * MB;
  };
  const storeOn = env.OTID_STORE_MODE?.trim().toLowerCase() === "on";
  return { accountBytes: read(env.OTID_MAP_QUOTA_ACCOUNT_MB, DEFAULT_MAP_QUOTA_ACCOUNT_MB),
    totalBytes: read(env.OTID_MAP_QUOTA_TOTAL_MB, storeOn ? DEFAULT_MAP_QUOTA_TOTAL_STORE_MB : DEFAULT_MAP_QUOTA_TOTAL_MB) };
}

/** Installationens gällande totalgräns: superadmins inställning (0 = ingen gräns) eller miljöns. */
export async function effectiveTotalQuotaBytes(tx: DbExecutor, quota: MapStorageQuota): Promise<number | null> {
  const [row] = (await tx.execute<{ value: unknown }>(sql`select value from installation_setting where key = 'map_quota_total_mb'`)).rows;
  const value = row?.value;
  if (typeof value !== "number" || !Number.isInteger(value)) return quota.totalBytes;
  return value === 0 ? null : value * MB;
}

/** Ett ogiltigt värde i miljön, för loggen vid start. */
export function mapStorageQuotaProblems(env: Partial<Record<string, string | undefined>>): string[] {
  return ["OTID_MAP_QUOTA_ACCOUNT_MB", "OTID_MAP_QUOTA_TOTAL_MB"]
    .filter(name => { const value = env[name]?.trim(); return value !== undefined && value !== "" && !/^\d+$/.test(value); })
    .map(name => `${name} ska vara ett heltal i MB (0 = ingen gräns); förvalet används`);
}

/** PLAN.md steg M7: CLUB = klubbens gräns för eget material (klubbarkivet). */
export interface MapQuotaExceeded { readonly scope: "ACCOUNT" | "CLUB" | "INSTALLATION"; readonly usedBytes: number; readonly limitBytes: number;
  readonly neededBytes: number }

/** PLAN.md steg M7 (ägaren 2026-11-22): förvalet för klubbens eget material, när superadmin inte satt något annat. */
export const DEFAULT_CLUB_MAP_QUOTA_MB = 2048;
/** Klubbens ledare och administratörer får besked när så här stor andel av klubbens gräns är använd. */
export const CLUB_QUOTA_WARNING_SHARE = 0.8;

/**
 * PLAN.md steg M7: innehåll som en version i något klubbarkiv pekar på räknas mot klubben och inte mot kontot i `uploaded_by`.
 * Samma innehåll sparas en gång, så en kopia ur arkivet (ett eget kartprojekt, en egen träning) kostar kontot ingenting.
 */
const NOT_IN_CLUB_ARCHIVE = sql`not exists (select 1 from club_map_version v where v.content_sha256 = map_content.sha256)`;

/**
 * Hur mycket kartinnehåll kontot har laddat upp och hur mycket som lagras på installationen (konton och klubbar tillsammans,
 * också gamla rader). PLAN.md steg M4: kontots återskapbara innehåll räknas mot sin egen gräns (`map-regenerable.ts`), och det
 * som tagits bort ur förrådet ('GONE') räknas inte alls. PLAN.md steg M7: det som ligger i ett klubbarkiv räknas mot klubben.
 */
export async function mapStorageUsage(tx: DbExecutor, accountId: string | null): Promise<{ accountBytes: number; totalBytes: number }> {
  const [row] = (await tx.execute<{ account: string; total: string }>(sql`select
      coalesce((select sum(byte_length) from map_content where ${accountId}::uuid is not null and uploaded_by = ${accountId}::uuid
        and not regenerable and stored_in <> 'GONE' and ${NOT_IN_CLUB_ARCHIVE}), 0)::text as account,
      ((select coalesce(sum(byte_length), 0) from map_content where stored_in <> 'GONE')
        + (select coalesce(sum(octet_length(image)), 0) from race_map where image is not null)
        + (select coalesce(sum(octet_length(file)), 0) from race_map_source where file is not null)
        + (select coalesce(sum(octet_length(image)), 0) from training_group_map where image is not null)
        + (select coalesce(sum(octet_length(file)), 0) from training_group_map_source where file is not null))::text as total`)).rows;
  return { accountBytes: Number(row?.account ?? 0), totalBytes: Number(row?.total ?? 0) };
}

/**
 * Kontots gräns för kartfiler: den egna (`user_account.map_quota_mb`, satt av superadmin, migration 0118) eller annars
 * installationens förval. Null = ingen gräns.
 */
export async function accountMapQuotaBytes(tx: DbExecutor, accountId: string, quota: MapStorageQuota = mapStorageQuota()): Promise<number | null> {
  const [row] = (await tx.execute<{ map_quota_mb: number | null }>(sql`select map_quota_mb from user_account where id = ${accountId}::uuid`)).rows;
  return row?.map_quota_mb != null ? row.map_quota_mb * MB : quota.accountBytes;
}

/**
 * PLAN.md steg M7: klubbens använda utrymme – kartinnehållet som klubbens versioner pekar på (varje innehåll en gång) och
 * arkivets banfiler.
 */
export async function clubStorageUsage(tx: DbExecutor, clubId: string): Promise<{ mapBytes: number; courseFileBytes: number; usedBytes: number }> {
  const [row] = (await tx.execute<{ maps: string; courses: string }>(sql`select
      (select coalesce(sum(c.byte_length), 0) from map_content c
        where c.stored_in <> 'GONE' and c.sha256 in (select v.content_sha256 from club_map_version v where v.club_id = ${clubId}::uuid))::text as maps,
      (select coalesce(sum(byte_length), 0) from club_archive_course_file where club_id = ${clubId}::uuid)::text as courses`)).rows;
  const mapBytes = Number(row?.maps ?? 0), courseFileBytes = Number(row?.courses ?? 0);
  return { mapBytes, courseFileBytes, usedBytes: mapBytes + courseFileBytes };
}

/** Klubbens gräns: den som superadmin satt (`club.map_quota_mb`, migration 0140) eller förvalet 2 048 MB. */
export async function clubMapQuotaBytes(tx: DbExecutor, clubId: string): Promise<number> {
  const [row] = (await tx.execute<{ map_quota_mb: number | null }>(sql`select map_quota_mb from club where id = ${clubId}::uuid`)).rows;
  return (row?.map_quota_mb ?? DEFAULT_CLUB_MAP_QUOTA_MB) * MB;
}

/**
 * Ryms det i klubbens gräns att lägga innehållen `sha256s` (som redan finns i `map_content`) och `newBytes` nytt material i
 * klubbarkivet? Innehåll som redan ligger i klubbens arkiv kostar ingenting. Innehåll som ett konto laddat upp till ett eget
 * projekt byter till klubben när det läggs i arkivet och räknas därför här.
 */
export async function clubArchiveQuotaProblem(tx: DbExecutor, clubId: string, input: { sha256s?: readonly string[]; newBytes?: number })
  : Promise<MapQuotaExceeded | null> {
  const shas = [...new Set(input.sha256s ?? [])];
  let added = input.newBytes ?? 0;
  if (shas.length > 0) {
    const [row] = (await tx.execute<{ bytes: string }>(sql`select coalesce(sum(c.byte_length), 0)::text as bytes from map_content c
      where c.sha256 = any(${sql.param(shas)}::text[]) and c.stored_in <> 'GONE'
        and not exists (select 1 from club_map_version v where v.club_id = ${clubId}::uuid and v.content_sha256 = c.sha256)`)).rows;
    added += Number(row?.bytes ?? 0);
  }
  if (added === 0) return null;
  const used = (await clubStorageUsage(tx, clubId)).usedBytes;
  const limit = await clubMapQuotaBytes(tx, clubId);
  return used + added > limit ? { scope: "CLUB", usedBytes: used, limitBytes: limit, neededBytes: added } : null;
}

export type StoreResult = { status: "stored"; sha256: string } | { status: "quota"; quota: MapQuotaExceeded };

/**
 * PLAN.md steg M7: innehållet sparas till klubbarkivet (`clubId`) och räknas mot klubbens gräns i stället för kontots. Det blir
 * då klubbens eget material och aldrig återskapbart, också med recept. PLAN.md steg M4: `recipe` gör innehållet återskapbart.
 */
export interface StoreOptions { readonly clubId?: string | undefined; readonly recipe?: object | undefined }

/**
 * Över kontots (eller klubbens) eller installationens gräns med `byteLength` till? Återskapbart prövas bara mot installationens:
 * kontots gräns för återskapbart nekar ingenting, utan det äldst använda tas bort efteråt (PLAN.md steg M4).
 */
async function quotaProblem(tx: DbExecutor, accountId: string | null, byteLength: number, quota: MapStorageQuota, options: StoreOptions = {})
  : Promise<MapQuotaExceeded | null> {
  const usage = await mapStorageUsage(tx, options.clubId ? null : accountId);
  if (options.clubId) {
    const club = await clubArchiveQuotaProblem(tx, options.clubId, { newBytes: byteLength });
    if (club) return club;
  } else if (options.recipe === undefined) {
    const accountLimit = accountId ? await accountMapQuotaBytes(tx, accountId, quota) : null;
    if (accountId && accountLimit !== null && usage.accountBytes + byteLength > accountLimit) {
      return { scope: "ACCOUNT", usedBytes: usage.accountBytes, limitBytes: accountLimit, neededBytes: byteLength };
    }
  }
  const totalLimit = await effectiveTotalQuotaBytes(tx, quota);
  if (totalLimit !== null && usage.totalBytes + byteLength > totalLimit) {
    return { scope: "INSTALLATION", usedBytes: usage.totalBytes, limitBytes: totalLimit, neededBytes: byteLength };
  }
  return null;
}

/** Tar bort delarna för en strömmad uppladdning som inte behövs (samma innehåll fanns). Filen i mellanlagret tar anroparen bort efter transaktionen. */
async function dropStagedParts(tx: DbExecutor, input: MapContentInput, keepContentId: string): Promise<void> {
  if (isStaged(input) && !input.file && input.contentId !== keepContentId) {
    await tx.execute(sql`delete from map_content_part where content_id = ${input.contentId}`);
  }
}

/** Uppladdningar till förrådet som gjorts utanför transaktionen, per indata (bytes eller strömmad uppladdning). */
const storeUploads = new WeakMap<object, { sha256: string; reservedAt: Date }>();

/**
 * Sparar innehållet (eller hittar samma innehåll som redan finns) i anroparens transaktion och ger dess sha256. Nytt innehåll
 * räknas mot kontots och installationens kvot; samma innehåll som redan finns kostar ingenting. Raden låses tills
 * transaktionen är klar, så att den inte tas bort innan referensen är sparad.
 *
 * ADR-0229: en uppladdning i en fil i mellanlagret, och bytes i minnet när förrådet är påslaget, laddas upp till förrådet och
 * kontrolleras innan raden skrivs. Granskningen runda 2 (A): uppladdningen görs aldrig i transaktionen. Behövs den (nytt
 * innehåll, kvoten förhandsprövad efter anroparens behörighetskontroll) kastas `OutsideTransactionWork`: transaktionen rullas
 * tillbaka, innehållet reserveras, laddas upp och läggs i mellanlagret utan öppen transaktion, och transaktionen görs om.
 * Andra gången registreras det bara. Transaktionen raderar inga filer; den strömmade filen tar anroparen bort efteråt
 * (`discardStagedMapContent`), så att ett nytt försök alltid har den kvar. Måste köras i `db.transaction` (`createDatabase`).
 */
export async function storeMapContent(tx: DbExecutor, input: MapContentInput, accountId: string | null, now: Date,
  quota: MapStorageQuota = mapStorageQuota(), options: StoreOptions = {}): Promise<StoreResult> {
  const recipe = options.clubId ? undefined : options.recipe;
  const sha256 = contentSha256(input);
  const byteLength = contentLength(input);
  const store = isStaged(input) ? (input.file ? activeMapStore() ?? missingStore() : null) : activeMapStore();
  const source: StoreSource | null = !store ? null : isStaged(input) ? { file: input.file! } : { bytes: input };
  const done = storeUploads.get(input);
  const uploaded = done?.sha256 === sha256 ? done : undefined;
  const uploadFirst = () => new OutsideTransactionWork(async db => {
    await reserveStoreUpload(db, sha256, byteLength, now);
    await uploadToStore(store!, sha256, byteLength, source!);
    await placeInCache(db, sha256, source!, byteLength, { keepSource: true });
    storeUploads.set(input, { sha256, reservedAt: now });
  }, "Kartinnehållet laddas upp till förrådet utanför transaktionen");
  if (store && source && !uploaded) {
    // PLAN.md steg M4: innehåll som tagits bort ur förrådet ('GONE') laddas upp igen, som nytt.
    const [known] = (await tx.execute(sql`select 1 from map_content where sha256 = ${sha256} and stored_in <> 'GONE'`)).rows;
    if (!known) {
      const problem = await quotaProblem(tx, accountId, byteLength, quota, options);
      if (problem) return { status: "quota", quota: problem };
      throw uploadFirst();
    }
  }
  // Uppladdningarna köas här: kvoten räknas och nytt innehåll sparas en i taget (bara databasen, det går fort).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('otid.map-content', 0))`);
  const existing = (await tx.execute<{ content_id: string; stored_in: string; regenerable: boolean }>(sql`select content_id, stored_in, regenerable
    from map_content where sha256 = ${sha256} for key share`)).rows[0];
  if (existing && existing.stored_in !== "GONE") {
    // PLAN.md steg M7: samma innehåll som redan finns kostar ingenting, utom när det läggs i ett klubbarkiv där det inte finns:
    // då byter det till klubben och ska rymmas i klubbens gräns.
    if (options.clubId) {
      const club = await clubArchiveQuotaProblem(tx, options.clubId, { sha256s: [sha256] });
      if (club) return { status: "quota", quota: club };
    }
    await dropStagedParts(tx, input, existing.content_id);
    // Samma innehåll uppladdat som eget (utan recept) eller till ett klubbarkiv (M7) tas aldrig bort som återskapbart.
    if (!recipe && existing.regenerable) await tx.execute(sql`update map_content set regenerable = false where sha256 = ${sha256}`);
    return { status: "stored", sha256 };
  }
  // Ett uppladdat objekt som inte blir innehåll här ligger kvar som släppt och tas bort efter fristen (reservationen).
      const problem = await quotaProblem(tx, accountId, byteLength, quota, options);
  if (problem) return { status: "quota", quota: problem };
  const contentId = isStaged(input) ? input.contentId : randomUUID();
  if (store && source) {
    // Innehållet togs bort mellan förhandskontrollen och låset, eller reservationen gick ut: ladda upp (igen) utanför.
    if (!uploaded || !await storeReservationHolds(tx, sha256, uploaded.reservedAt)) {
      storeUploads.delete(input);
      throw uploadFirst();
    }
    await registerStoredMapContent(tx, { sha256, contentId, byteLength, accountId, recipe: recipe ?? null }, now);
    return { status: "stored", sha256 };
  }
  if (!isStaged(input)) {
    for (let part = 0; part * MAP_CONTENT_PART_BYTES < input.byteLength; part++) {
      const data = input.subarray(part * MAP_CONTENT_PART_BYTES, (part + 1) * MAP_CONTENT_PART_BYTES);
      await tx.execute(sql`insert into map_content_part (content_id, part, data, created_at)
        values (${contentId}, ${part}, ${Buffer.from(data.buffer, data.byteOffset, data.byteLength)}, ${now})`);
    }
  } else {
    // Delarna ska vara precis uppladdningens (ingen annan kan ha skrivit med samma slumpade id, men kontrollera storleken).
    const [parts] = (await tx.execute<{ bytes: string }>(sql`select coalesce(sum(octet_length(data)), 0)::text as bytes
      from map_content_part where content_id = ${input.contentId}`)).rows;
    if (Number(parts?.bytes ?? 0) !== byteLength) throw new Error("Uppladdningens delar saknas");
  }
  // PLAN.md steg M4: en rad som tagits bort ur förrådet ('GONE') får tillbaka sitt innehåll här (återskapat).
  await tx.execute(sql`insert into map_content (sha256, content_id, byte_length, uploaded_by, created_at, regenerable, recipe)
    values (${sha256}, ${contentId}, ${byteLength}, ${accountId}, ${now}, ${recipe !== undefined}, ${recipe ? JSON.stringify(recipe) : null}::jsonb)
    on conflict (sha256) do update set content_id = excluded.content_id, byte_length = excluded.byte_length, uploaded_by = excluded.uploaded_by,
      stored_in = 'DB', evicted_at = null, last_used_at = ${now}, regenerable = excluded.regenerable,
      recipe = coalesce(excluded.recipe, map_content.recipe) where map_content.stored_in = 'GONE'`);
  // ADR-0224: samma innehåll kan ligga kvar i arkivet efter att det släpptes; nu finns delarna här igen.
  await tx.execute(sql`update map_content_archive set cold_at = null, orphaned_at = null where sha256 = ${sha256}`);
  return { status: "stored", sha256 };
}

function missingStore(): never {
  throw new Error("Uppladdningen ligger i mellanlagret men förrådet är inte längre inställt");
}

/**
 * Hela innehållet i minnet, en del i taget ur databasen. Undefined när det inte finns. Innehåll som ligger i arkivet
 * (ADR-0224, PLAN.md steg L5) hämtas tillbaka därifrån först.
 */
export async function readMapContent(tx: DbExecutor, sha256: string): Promise<Buffer | undefined> {
  const rows = (await tx.execute<{ data: Buffer; byte_length: number }>(sql`select p.data, c.byte_length from map_content c
    join map_content_part p on p.content_id = c.content_id where c.sha256 = ${sha256} order by p.part`)).rows;
  if (rows.length === 0) {
    const stored = await storedMapContent(tx, sha256);
    return stored ? readStoredMapContent(tx, sha256, stored.byteLength) : restoreMapContent(tx, { sha256 });
  }
  const bytes = Buffer.concat(rows.map(row => row.data));
  if (bytes.byteLength !== rows[0]!.byte_length) throw new Error("Kartinnehållet är ofullständigt");
  return bytes;
}

/** ADR-0229: innehållets längd om det ligger i förrådet (`stored_in = 'STORE'`), annars undefined. */
export async function storedMapContent(tx: DbExecutor, sha256: string): Promise<{ byteLength: number; contentId: string } | undefined> {
  const [row] = (await tx.execute<{ byte_length: number; content_id: string }>(sql`select byte_length, content_id from map_content
    where sha256 = ${sha256} and stored_in = 'STORE'`)).rows;
  return row ? { byteLength: Number(row.byte_length), contentId: row.content_id } : undefined;
}

/** En rads innehåll: den gamla kolumnen om den finns (rader före migration 0044), annars innehållet den pekar på. */
export async function rowContent(tx: DbExecutor, row: { inline: Buffer | null; contentSha256: string | null }): Promise<Buffer | undefined> {
  if (row.inline) return row.inline;
  return row.contentSha256 ? readMapContent(tx, row.contentSha256) : undefined;
}

/** De fyra tabellerna med kartinnehåll och kolumnen med det gamla innehållet. */
export const MAP_CONTENT_TABLES = [
  { table: "race_map", column: "image", key: "race_id" },
  { table: "race_map_source", column: "file", key: "race_id" },
  { table: "training_group_map", column: "image", key: "id" },
  { table: "training_group_map_source", column: "file", key: "map_id" }
] as const;

/**
 * Steg två (ADR-0189 beslut 4): flyttar innehållet ur gamla rader till lagret, en rad per transaktion, så att inga långa lås
 * tas och ett avbrott kan fortsätta där det slutade. Dubbletter blir ett innehåll. `where` begränsar till en tävlings rader
 * (återställningen); utan den flyttas allt. Ger antal flyttade rader per tabell.
 */
export async function moveInlineMapContent(db: Database, options: { raceId?: string; uploadedBy?: string | null; limit?: number } = {})
  : Promise<Record<string, number>> {
  const moved: Record<string, number> = {};
  for (const { table, column, key } of MAP_CONTENT_TABLES) {
    if (options.raceId && key !== "race_id") continue;
    moved[table] = 0;
    for (;;) {
      if (options.limit !== undefined && Object.values(moved).reduce((a, b) => a + b, 0) >= options.limit) return moved;
      const count = await db.transaction(async tx => {
        const raceFilter = options.raceId ? sql`and race_id = ${options.raceId}` : sql``;
        const result = await tx.execute(sql`update ${sql.identifier(table)} t
          set content_sha256 = otid_map_content_store(t.${sql.identifier(column)}, ${options.uploadedBy ?? null}::uuid), ${sql.identifier(column)} = null
          where t.${sql.identifier(key)} = (select ${sql.identifier(key)} from ${sql.identifier(table)} where ${sql.identifier(column)} is not null
            ${raceFilter} limit 1 for update skip locked)`);
        return result.rowCount ?? 0;
      });
      if (count === 0) break;
      moved[table] += count;
    }
  }
  return moved;
}

/** Rader som fortfarande har innehållet i den gamla kolumnen (steg två är klart när det är 0). */
export async function inlineMapContentRows(db: DbExecutor): Promise<number> {
  const [row] = (await db.execute<{ rows: string }>(sql`select ((select count(*) from race_map where image is not null)
    + (select count(*) from race_map_source where file is not null) + (select count(*) from training_group_map where image is not null)
    + (select count(*) from training_group_map_source where file is not null))::text as rows`)).rows;
  return Number(row?.rows ?? 0);
}

/** Samma flytt i anroparens transaktion för en tävlings rader (återställningen, där allt sker i en transaktion). */
export async function storeInlineMapContentForRace(tx: DbExecutor, raceId: string, uploadedBy: string | null): Promise<void> {
  for (const { table, column } of MAP_CONTENT_TABLES.filter(entry => entry.key === "race_id")) {
    await tx.execute(sql`update ${sql.identifier(table)} set content_sha256 = otid_map_content_store(${sql.identifier(column)}, ${uploadedBy}::uuid),
      ${sql.identifier(column)} = null where race_id = ${raceId} and ${sql.identifier(column)} is not null`);
  }
}

/**
 * Underhållet: innehåll som ingen pekar på (en referens som aldrig sparades) och delar utan innehåll äldre än ett dygn
 * (avbrutna uppladdningar). Ger antal borttagna.
 */
export async function sweepMapContent(tx: DbExecutor, now: Date): Promise<{ contents: number; parts: number }> {
  const contents = (await tx.execute<{ sha256: string }>(sql`select c.sha256 from map_content c
    where c.created_at < ${new Date(now.getTime() - 60 * 60_000)}
      and not exists (select 1 from race_map where content_sha256 = c.sha256)
      and not exists (select 1 from race_map_source where content_sha256 = c.sha256)
      and not exists (select 1 from training_group_map where content_sha256 = c.sha256)
      and not exists (select 1 from training_group_map_source where content_sha256 = c.sha256)
      and not exists (select 1 from club_map_version where content_sha256 = c.sha256)
      and not exists (select 1 from map_project where base_sha256 = c.sha256)
      and not exists (select 1 from map_project_output where content_sha256 = c.sha256)
      and not exists (select 1 from map_project_layer where content_sha256 = c.sha256)
      and not exists (select 1 from map_project_geo_output where content_sha256 = c.sha256)
    limit 100`)).rows;
  // Samma tabeller som i `otid_map_content_release` (0103): saknas en här fastnar sökningen på samma hundra levande rader.
  let released = 0;
  for (const row of contents) {
    await tx.execute(sql`select otid_map_content_release(${row.sha256})`);
    // Frigörandet hoppar över en rad som en annan transaktion låst; bara borttagna rader räknas.
    if (!(await tx.execute(sql`select 1 from map_content where sha256 = ${row.sha256}`)).rows.length) released += 1;
  }
  const parts = await tx.execute(sql`delete from map_content_part p where p.created_at < ${new Date(now.getTime() - 24 * 60 * 60_000)}
    and not exists (select 1 from map_content c where c.content_id = p.content_id)`);
  return { contents: released, parts: parts.rowCount ?? 0 };
}
