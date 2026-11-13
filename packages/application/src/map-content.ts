import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { sha256Hex } from "./serialization";

/**
 * ADR-0189 beslut 1–3: kartbilder och kartfiler lagras en gång (`map_content`, adresserat med sha256) i delar om högst 1 MiB
 * (`map_content_part`). Tävlingar, kopior, träningstillfällen och gruppens bibliotek pekar på innehållet med `content_sha256`;
 * en kopia kopierar bara referensen. Utlösaren i migration 0044 tar bort innehållet när sista referensen försvinner.
 *
 * Uppladdningen strömmas: delarna skrivs till databasen medan bodyn läses (`stageMapContent`), så webben håller högst en del
 * i minnet. Först när filen är kontrollerad sparas innehållets rad i samma transaktion som referensen (`storeMapContent`), med
 * kvoten per konto och installation kontrollerad. Delar som aldrig fick någon rad tas bort (`discardStagedMapContent`, och
 * underhållet efter ett dygn).
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
  await db.execute(sql`delete from map_content_part where content_id = ${contentId}
    and not exists (select 1 from map_content where content_id = ${contentId})`);
}

/** Kvoten (ADR-0189 beslut 3). Null = ingen gräns. */
export interface MapStorageQuota { readonly accountBytes: number | null; readonly totalBytes: number | null }
export const DEFAULT_MAP_QUOTA_ACCOUNT_MB = 2048;
export const DEFAULT_MAP_QUOTA_TOTAL_MB = 20480;

/**
 * `OTID_MAP_QUOTA_ACCOUNT_MB` (förval 2048) och `OTID_MAP_QUOTA_TOTAL_MB` (förval 20480); 0 stänger av gränsen. Ett ogiltigt
 * värde ger förvalet (och `startup-check` skriver det i loggen).
 */
export function mapStorageQuota(env: Partial<Record<string, string | undefined>> = process.env): MapStorageQuota {
  const read = (value: string | undefined, fallback: number) => {
    const trimmed = value?.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return fallback * MB;
    const parsed = Number(trimmed);
    return parsed === 0 ? null : parsed * MB;
  };
  return { accountBytes: read(env.OTID_MAP_QUOTA_ACCOUNT_MB, DEFAULT_MAP_QUOTA_ACCOUNT_MB),
    totalBytes: read(env.OTID_MAP_QUOTA_TOTAL_MB, DEFAULT_MAP_QUOTA_TOTAL_MB) };
}

/** Ett ogiltigt värde i miljön, för loggen vid start. */
export function mapStorageQuotaProblems(env: Partial<Record<string, string | undefined>>): string[] {
  return ["OTID_MAP_QUOTA_ACCOUNT_MB", "OTID_MAP_QUOTA_TOTAL_MB"]
    .filter(name => { const value = env[name]?.trim(); return value !== undefined && value !== "" && !/^\d+$/.test(value); })
    .map(name => `${name} ska vara ett heltal i MB (0 = ingen gräns); förvalet används`);
}

export interface MapQuotaExceeded { readonly scope: "ACCOUNT" | "INSTALLATION"; readonly usedBytes: number; readonly limitBytes: number;
  readonly neededBytes: number }

/** Hur mycket kartinnehåll kontot har laddat upp och hur mycket som lagras på installationen (också gamla rader). */
export async function mapStorageUsage(tx: DbExecutor, accountId: string | null): Promise<{ accountBytes: number; totalBytes: number }> {
  const [row] = (await tx.execute<{ account: string; total: string }>(sql`select
      coalesce((select sum(byte_length) from map_content where ${accountId}::uuid is not null and uploaded_by = ${accountId}::uuid), 0)::text as account,
      ((select coalesce(sum(byte_length), 0) from map_content)
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

export type StoreResult = { status: "stored"; sha256: string } | { status: "quota"; quota: MapQuotaExceeded };

/**
 * Sparar innehållet (eller hittar samma innehåll som redan finns) i anroparens transaktion och ger dess sha256. Nytt innehåll
 * räknas mot kontots och installationens kvot; samma innehåll som redan finns kostar ingenting. Raden låses tills
 * transaktionen är klar, så att den inte tas bort innan referensen är sparad.
 */
export async function storeMapContent(tx: DbExecutor, input: MapContentInput, accountId: string | null, now: Date,
  quota: MapStorageQuota = mapStorageQuota()): Promise<StoreResult> {
  const sha256 = contentSha256(input);
  const byteLength = contentLength(input);
  // Uppladdningarna köas här: kvoten räknas och nytt innehåll sparas en i taget (det är sällsynt och går fort).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('otid.map-content', 0))`);
  const existing = (await tx.execute<{ content_id: string }>(sql`select content_id from map_content where sha256 = ${sha256}
    for key share`)).rows[0];
  if (existing) {
    if (isStaged(input) && input.contentId !== existing.content_id) {
      await tx.execute(sql`delete from map_content_part where content_id = ${input.contentId}`);
    }
    return { status: "stored", sha256 };
  }
  const usage = await mapStorageUsage(tx, accountId);
  const accountLimit = accountId ? await accountMapQuotaBytes(tx, accountId, quota) : null;
  if (accountId && accountLimit !== null && usage.accountBytes + byteLength > accountLimit) {
    return { status: "quota", quota: { scope: "ACCOUNT", usedBytes: usage.accountBytes, limitBytes: accountLimit, neededBytes: byteLength } };
  }
  if (quota.totalBytes !== null && usage.totalBytes + byteLength > quota.totalBytes) {
    return { status: "quota", quota: { scope: "INSTALLATION", usedBytes: usage.totalBytes, limitBytes: quota.totalBytes, neededBytes: byteLength } };
  }
  const contentId = isStaged(input) ? input.contentId : randomUUID();
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
  await tx.execute(sql`insert into map_content (sha256, content_id, byte_length, uploaded_by, created_at)
    values (${sha256}, ${contentId}, ${byteLength}, ${accountId}, ${now})`);
  return { status: "stored", sha256 };
}

/** Hela innehållet i minnet, en del i taget ur databasen. Undefined när det inte finns. */
export async function readMapContent(tx: DbExecutor, sha256: string): Promise<Buffer | undefined> {
  const rows = (await tx.execute<{ data: Buffer; byte_length: number }>(sql`select p.data, c.byte_length from map_content c
    join map_content_part p on p.content_id = c.content_id where c.sha256 = ${sha256} order by p.part`)).rows;
  if (rows.length === 0) return undefined;
  const bytes = Buffer.concat(rows.map(row => row.data));
  if (bytes.byteLength !== rows[0]!.byte_length) throw new Error("Kartinnehållet är ofullständigt");
  return bytes;
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
    limit 100`)).rows;
  for (const row of contents) await tx.execute(sql`select otid_map_content_release(${row.sha256})`);
  const parts = await tx.execute(sql`delete from map_content_part p where p.created_at < ${new Date(now.getTime() - 24 * 60 * 60_000)}
    and not exists (select 1 from map_content c where c.content_id = p.content_id)`);
  return { contents: contents.length, parts: parts.rowCount ?? 0 };
}
