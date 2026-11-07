import { eq } from "drizzle-orm";
import {
  RACE_MAP_MAX_BYTES, RACE_MAP_SOURCE_MAX_BYTES, raceMapSourceMetadataSchema, type AdminRaceMapSource, type RaceMapProblem
} from "@o-tid/contracts";
import { deriveRasterGeoreference, RasterGeoreferenceError } from "@o-tid/domain";
import { schema, type Database } from "@o-tid/database";
import { lockRaceForMutation } from "./concurrency";
import { imageDimensions } from "./image-dimensions";
import { requireCourseSettingAccess } from "./course-setting-access";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { UUID_PATTERN as uuid } from "./serialization";
import {
  contentHead, contentLength, mapStorageQuota, rowContent, storeMapContent, type MapContentInput, type MapQuotaExceeded,
  type MapStorageQuota
} from "./map-content";

/**
 * Steg 59 (ADR-0179 beslut 1–3): banläggarens kartfil. Webbläsaren läser filen, ritar bilden och räknar tre punkter ur
 * filens georeferens; servern kontrollerar bara storlek, bildens PNG-signatur och att kartfilen ser ut som OCAD eller
 * Mapper (filens början), och sparar allt i en transaktion: kartfilen i `race_map_source`, bilden och georeferensen i
 * `race_map` (så att dagens kartvägar används). Originalfilen lämnas bara ut till admin.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" };
type Problem = { status: "problem"; problem: RaceMapProblem; quota?: MapQuotaExceeded };
const cleanName = (value: string, fallback: string) => value.replace(/\p{Cc}/gu, "").trim().slice(0, 200) || fallback;

/** OCAD: filen börjar med 0x0CAD (little endian) följt av filtypen. */
function looksLikeOcad(bytes: Uint8Array): boolean {
  return bytes.length >= 64 && bytes[0] === 0xad && bytes[1] === 0x0c;
}

/** Mapper: XML med elementet `map` i OpenOrienteerings namnrymd bland de första 4 kB (ingen tolkning av resten). TextDecoder tar bort en BOM. */
function looksLikeMapper(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096)).trimStart();
  return head.startsWith("<?xml") && /<map\b[^>]*xmlns="http:\/\/openorienteering\.org\/apps\/mapper\/xml\/v\d+"/.test(head);
}

/** Filens format enligt dess början, eller undefined när den inte ser ut som en kartfil. */
export function mapFileFormatOf(bytes: Uint8Array): "OCD" | "OMAP" | undefined {
  return looksLikeOcad(bytes) ? "OCD" : looksLikeMapper(bytes) ? "OMAP" : undefined;
}

async function audit(tx: Transaction, raceId: string, actorId: string, action: string, after: Record<string, unknown>) {
  await tx.insert(schema.auditEvents).values({ raceId, entityType: "race_map", entityId: raceId, action, actorKind: "USER_ACCOUNT",
    actorId, after });
}

async function adminWrite<T>(db: Database, input: RaceSessionProof, now: Date, write: (tx: Transaction, actorId: string) => Promise<T>)
  : Promise<Failure | T> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, input.raceId);
    return write(tx, auth.principal.accountId);
  });
}

export interface RaceMapSourceUpload {
  /** Kartfilen och bilden: i minnet eller strömmade till databasen (ADR-0189 beslut 2). */
  readonly file: MapContentInput;
  readonly fileName: string;
  readonly image: MapContentInput;
  readonly metadata: unknown;
  /** Kvoten (förval ur miljön, ADR-0189 beslut 3). */
  readonly quota?: MapStorageQuota;
  /** Mer som sparas i samma transaktion som kartan (t.ex. kartavtalet vid "Använd igen"); ett fel rullar tillbaka allt. */
  readonly alsoSave?: (tx: Transaction) => Promise<void>;
}

/**
 * Ny eller utbytt kartfil med bilden ritad ur den. Ersätter kartbilden och georeferensen: med tre punkter ur filen är
 * bilden georefererad direkt, annars sätter arrangören punkterna som för en vanlig kartbild.
 */
export async function saveRaceMapSourceAsAdmin(db: Database, input: RaceSessionProof & RaceMapSourceUpload, now = new Date())
  : Promise<Failure | Problem | { status: "ok"; georeferenced: boolean }> {
  const metadata = raceMapSourceMetadataSchema.safeParse(input.metadata);
  if (!metadata.success) return { status: "invalid-request" };
  if (contentLength(input.file) > RACE_MAP_SOURCE_MAX_BYTES) return { status: "problem", problem: "MAP_FILE_TOO_LARGE" };
  if (contentLength(input.image) > RACE_MAP_MAX_BYTES) return { status: "problem", problem: "IMAGE_TOO_LARGE" };
  if (contentLength(input.file) === 0 || mapFileFormatOf(contentHead(input.file)) !== metadata.data.format) {
    return { status: "problem", problem: "INVALID_MAP_FILE" };
  }
  const image = imageDimensions(contentHead(input.image));
  if (!image || image.mediaType !== "image/png") return { status: "problem", problem: "INVALID_IMAGE" };
  const { render, bounds, tiePoints } = metadata.data;
  // Bilden ska täcka kartans yta med den angivna upplösningen (en pixel tolerans per sida).
  const right = (bounds.maxX - render.originX) * render.pxPerMm, bottom = (render.originY - bounds.minY) * render.pxPerMm;
  if (bounds.minX < render.originX || bounds.maxY > render.originY || right > image.width + 1 || bottom > image.height + 1) {
    return { status: "invalid-request" };
  }
  let transform: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
  if (tiePoints) {
    try {
      transform = { ...deriveRasterGeoreference({ imageWidth: image.width, imageHeight: image.height, tiePoints }).transform };
    } catch (error) {
      if (error instanceof RasterGeoreferenceError) return { status: "problem", problem: "INVALID_GEOREFERENCE" };
      throw error;
    }
  }
  const quota = input.quota ?? mapStorageQuota();
  return adminWrite(db, input, now, async (tx, actorId) => {
    const raceId = input.raceId, fileName = cleanName(input.fileName, metadata.data.format === "OCD" ? "karta.ocd" : "karta.omap");
    // ADR-0189: innehållet lagras en gång; tävlingen pekar på det. Kvoten gäller bara nytt innehåll.
    const storedFile = await storeMapContent(tx, input.file, actorId, now, quota);
    if (storedFile.status === "quota") return { status: "problem" as const, problem: "STORAGE_QUOTA_EXCEEDED" as const, quota: storedFile.quota };
    const storedImage = await storeMapContent(tx, input.image, actorId, now, quota);
    if (storedImage.status === "quota") {
      // Kartfilen ovan sparades i samma transaktion; den tas bort när transaktionen rullas tillbaka.
      throw new QuotaRollback(storedImage.quota);
    }
    const imageHash = storedImage.sha256, fileHash = storedFile.sha256;
    const map = { fileName: `${fileName.replace(/\.[^.]{1,8}$/, "")}.png`.slice(0, 200), mediaType: "image/png" as const,
      image: null, contentSha256: imageHash, sha256: imageHash, byteLength: contentLength(input.image), width: image.width, height: image.height,
      tiePoints: tiePoints ? [...tiePoints] : null, transform, uploadedAt: now, georeferencedAt: transform ? now : null };
    await tx.insert(schema.raceMaps).values({ raceId, ...map }).onConflictDoUpdate({ target: schema.raceMaps.raceId, set: map });
    const source = { fileName, format: metadata.data.format, version: metadata.data.version, file: null, contentSha256: fileHash,
      sha256: fileHash, byteLength: contentLength(input.file), scale: metadata.data.scale, bounds, georeference: metadata.data.georeference,
      render, summary: metadata.data.summary, uploadedAt: now };
    await tx.insert(schema.raceMapSources).values({ raceId, ...source }).onConflictDoUpdate({ target: schema.raceMapSources.raceId, set: source });
    await audit(tx, raceId, actorId, "RACE_MAP_SOURCE_SAVED", { fileName, format: source.format, version: source.version, sha256: fileHash,
      byteLength: source.byteLength, scale: source.scale, image: { sha256: imageHash, width: image.width, height: image.height },
      tiePoints: map.tiePoints });
    if (input.alsoSave) await input.alsoSave(tx);
    return { status: "ok" as const, georeferenced: transform !== null };
  }).catch((error: unknown) => {
    if (error instanceof QuotaRollback) return { status: "problem" as const, problem: "STORAGE_QUOTA_EXCEEDED" as const, quota: error.quota };
    throw error;
  });
}

/** Bilden fick inte plats efter att kartfilen sparats: hela transaktionen rullas tillbaka. */
class QuotaRollback extends Error {
  constructor(readonly quota: MapQuotaExceeded) { super("Kvoten för kartor är full"); }
}

/** Tar bort kartfilen men behåller bilden (och dess georeferens) som en vanlig kartbild. */
export async function removeRaceMapSourceAsAdmin(db: Database, input: RaceSessionProof, now = new Date()): Promise<Failure | { status: "ok" }> {
  return adminWrite(db, input, now, async (tx, actorId) => {
    const removed = await tx.delete(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, input.raceId))
      .returning({ sha256: schema.raceMapSources.sha256 });
    if (removed.length === 0) return { status: "not-found" as const };
    await audit(tx, input.raceId, actorId, "RACE_MAP_SOURCE_REMOVED", { sha256: removed[0]!.sha256 });
    return { status: "ok" as const };
  });
}

/**
 * Originalfilen, för att rita och räkna vägval i webbläsaren. Steg 66: banläggningens behörighet (läsa och kommentera
 * räcker, ADR-0181 beslut 5), som ger admin och den som bara har banläggningen; aldrig publikt.
 */
export async function readRaceMapSourceFileAsAdmin(db: Database, input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">, now = new Date())
  : Promise<Failure | { status: "ok"; fileName: string; format: "OCD" | "OMAP"; file: Buffer }> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    // ADR-0181 beslut 8: också kartritaren (kartan är inte hemlig, banorna är det).
    const auth = await requireCourseSettingAccess(tx, { ...input, required: "MAP" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const [row] = await tx.select({ fileName: schema.raceMapSources.fileName, format: schema.raceMapSources.format, inline: schema.raceMapSources.file,
      contentSha256: schema.raceMapSources.contentSha256 }).from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, input.raceId));
    const file = row ? await rowContent(tx, row) : undefined;
    return row && file ? { status: "ok" as const, fileName: row.fileName, format: row.format, file } : { status: "not-found" as const };
  });
}

/** Kartfilen i arbetsytans kartläge (utan originalet). */
export async function readAdminRaceMapSource(tx: Transaction, raceId: string, georeferencedAt: Date | null)
  : Promise<AdminRaceMapSource | null> {
  const [row] = await tx.select({ fileName: schema.raceMapSources.fileName, format: schema.raceMapSources.format,
    version: schema.raceMapSources.version, byteLength: schema.raceMapSources.byteLength, scale: schema.raceMapSources.scale,
    georeference: schema.raceMapSources.georeference, summary: schema.raceMapSources.summary, uploadedAt: schema.raceMapSources.uploadedAt })
    .from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, raceId));
  if (!row) return null;
  return { fileName: row.fileName, format: row.format, version: row.version, byteLength: row.byteLength, scale: row.scale,
    crs: row.georeference?.crs ?? null,
    // Georefererad ur filen: georeferensen sattes i samma transaktion som kartfilen (inte för hand efteråt).
    georeferencedFromFile: georeferencedAt !== null && georeferencedAt.getTime() === row.uploadedAt.getTime(),
    summary: row.summary, uploadedAt: row.uploadedAt.toISOString() };
}
