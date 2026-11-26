import { eq } from "drizzle-orm";
import {
  RACE_MAP_MAX_BYTES, RACE_MAP_SOURCE_MAX_BYTES, raceMapSourceMetadataSchema, raceMapSourceUpdateRequestSchema,
  type AdminRaceMapSource, type MapUsageScope, type RaceMapProblem
} from "@o-tid/contracts";
import { deriveRasterGeoreference, RasterGeoreferenceError } from "@o-tid/domain";
import { schema, type Database } from "@o-tid/database";
import { lockRaceForMutation } from "./concurrency";
import { imageDimensions } from "./image-dimensions";
import { requireCourseSettingAccess } from "./course-setting-access";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { UUID_PATTERN as uuid } from "./serialization";
import {
  contentHead, contentLength, contentSha256, mapStorageQuota, rowContent, storeMapContent, type MapContentInput, type MapQuotaExceeded,
  type MapStorageQuota
} from "./map-content";
import { pinRaceContentNow } from "./map-pin";

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
  /** Etapp 3.2: ursprung från klubbarkiv eller publik kartbank samt nedladdningsspärr. */
  readonly origin?: {
    readonly clubMapId?: string | null;
    readonly clubMapVersionId?: string | null;
    readonly publicListingId?: string | null;
    readonly sourceDownloadLocked?: boolean;
    readonly usageScope?: MapUsageScope;
  };
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
    // PLAN.md steg M2: i fönstret kring tävlingsdagen spikas filen och bilden fast innan de läggs i mellanlagret.
    await pinRaceContentNow(tx, raceId, now, [contentSha256(input.file), contentSha256(input.image)]);
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
      render, summary: metadata.data.summary, uploadedAt: now,
      clubMapId: input.origin?.clubMapId ?? null,
      clubMapVersionId: input.origin?.clubMapVersionId ?? null,
      publicListingId: input.origin?.publicListingId ?? null,
      sourceDownloadLocked: Boolean(input.origin?.sourceDownloadLocked) || Boolean(metadata.data.sourceDownloadLocked),
      usageScope: input.origin?.usageScope ?? "ANY" as const };
    await tx.insert(schema.raceMapSources).values({ raceId, ...source }).onConflictDoUpdate({ target: schema.raceMapSources.raceId, set: source });
    // Rensa eventuell tidigare kartprojektkoppling innan `alsoSave` ev. skriver en ny koppling.
    await tx.delete(schema.raceMapProjectLinks).where(eq(schema.raceMapProjectLinks.raceId, raceId));
    await audit(tx, raceId, actorId, "RACE_MAP_SOURCE_SAVED", { fileName, format: source.format, version: source.version, sha256: fileHash,
      byteLength: source.byteLength, scale: source.scale, sourceDownloadLocked: source.sourceDownloadLocked,
      image: { sha256: imageHash, width: image.width, height: image.height }, tiePoints: map.tiePoints });
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
export async function readRaceMapSourceFileAsAdmin(db: Database, input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">, now = new Date(),
  options: { readonly ifNoneMatch?: string | undefined } = {})
  : Promise<Failure | { status: "ok"; fileName: string; format: "OCD" | "OMAP"; sha256: string; file: Buffer } | { status: "not-modified"; sha256: string }> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    // ADR-0181 beslut 8: också kartritaren (kartan är inte hemlig, banorna är det).
    const auth = await requireCourseSettingAccess(tx, { ...input, required: "MAP" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const [row] = await tx.select({ fileName: schema.raceMapSources.fileName, format: schema.raceMapSources.format, sha256: schema.raceMapSources.sha256,
      contentSha256: schema.raceMapSources.contentSha256, sourceDownloadLocked: schema.raceMapSources.sourceDownloadLocked })
      .from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, input.raceId));
    if (!row) return { status: "not-found" as const };
    // Etapp 3.2: nedladdningsspärrad källfil lämnas aldrig ut till webbläsaren.
    if (row.sourceDownloadLocked) return { status: "forbidden" as const };
    // ADR-0218: webbläsaren har redan samma fil (behörigheten är prövad ovan); innehållet läses inte.
    if (options.ifNoneMatch === row.sha256) return { status: "not-modified" as const, sha256: row.sha256 };
    const inline = row.contentSha256 ? null : (await tx.select({ file: schema.raceMapSources.file }).from(schema.raceMapSources)
      .where(eq(schema.raceMapSources.raceId, input.raceId)))[0]?.file ?? null;
    const file = await rowContent(tx, { inline, contentSha256: row.contentSha256 });
    return file ? { status: "ok" as const, fileName: row.fileName, format: row.format, sha256: row.sha256, file } : { status: "not-found" as const };
  });
}

/**
 * Etapp 2: avgör om tävlingens kartfil ärver nedladdningsspärr från klubbarkivet, publika kartbanken eller ett
 * spärrat kartprojekt (och därför inte får låsas upp av tävlingsadmin).
 */
export async function isRaceMapSourceLockedByOrigin(
  tx: Pick<Database, "select">,
  raceId: string,
  row: Pick<typeof schema.raceMapSources.$inferSelect, "clubMapId" | "publicListingId" | "sha256" | "sourceDownloadLocked">
): Promise<boolean> {
  if (row.clubMapId) {
    const [clubMap] = await tx.select({ policy: schema.clubMaps.sourceDownloadPolicy })
      .from(schema.clubMaps).where(eq(schema.clubMaps.id, row.clubMapId));
    if (!clubMap ? row.sourceDownloadLocked : clubMap.policy === "CUSTODIANS_ONLY") return true;
  }
  if (row.publicListingId) {
    const [listing] = await tx.select({ accessMode: schema.publicMapListings.accessMode })
      .from(schema.publicMapListings).where(eq(schema.publicMapListings.id, row.publicListingId));
    if (!listing ? row.sourceDownloadLocked : listing.accessMode !== "OPEN_DOWNLOAD") return true;
  }
  const [projectLink] = await tx.select({ projectId: schema.raceMapProjectLinks.projectId, sha256: schema.raceMapProjectLinks.sha256 })
    .from(schema.raceMapProjectLinks).where(eq(schema.raceMapProjectLinks.raceId, raceId));
  if (projectLink && projectLink.sha256 === row.sha256) {
    const [project] = await tx.select({
      sourceDownloadPolicy: schema.mapProjects.sourceDownloadPolicy,
      baseVersionId: schema.mapProjects.baseVersionId
    }).from(schema.mapProjects).where(eq(schema.mapProjects.id, projectLink.projectId));
    if (project) {
      if (project.sourceDownloadPolicy === "CUSTODIANS_ONLY") return true;
      if (project.baseVersionId) {
        const [clubMap] = await tx.select({ policy: schema.clubMaps.sourceDownloadPolicy })
          .from(schema.clubMapVersions)
          .innerJoin(schema.clubMaps, eq(schema.clubMaps.id, schema.clubMapVersions.mapId))
          .where(eq(schema.clubMapVersions.id, project.baseVersionId));
        if (clubMap?.policy === "CUSTODIANS_ONLY") return true;
      }
    }
  }
  return false;
}

/**
 * Etapp 2: tävlingsadmin kan slå på/av nedladdningsspärr på tävlingens kartfil.
 * Om kartan kommer från en spärrad klubbkarta, kartbank eller spärrat kartprojekt vägras upplåsning (403).
 */
export async function updateRaceMapSourceLockAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; sourceDownloadLocked: boolean; sourceDownloadLockedByOrigin: boolean }> {
  const parsed = raceMapSourceUpdateRequestSchema.safeParse(input.request);
  return adminWrite(db, input, now, async (tx, actorId) => {
    // Inloggning och behörighet prövas före kroppen (utloggad får 401, inte 400).
    if (!parsed.success) return { status: "invalid-request" as const };
    const [row] = await tx.select({
      clubMapId: schema.raceMapSources.clubMapId,
      publicListingId: schema.raceMapSources.publicListingId,
      sha256: schema.raceMapSources.sha256,
      sourceDownloadLocked: schema.raceMapSources.sourceDownloadLocked
    }).from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, input.raceId));
    if (!row) return { status: "not-found" as const };
    const lockedByOrigin = await isRaceMapSourceLockedByOrigin(tx, input.raceId, row);
    if (!parsed.data.sourceDownloadLocked && lockedByOrigin) {
      return { status: "forbidden" as const };
    }
    await tx.update(schema.raceMapSources)
      .set({ sourceDownloadLocked: parsed.data.sourceDownloadLocked })
      .where(eq(schema.raceMapSources.raceId, input.raceId));
    const effectiveLockedByOrigin = parsed.data.sourceDownloadLocked && lockedByOrigin;
    await audit(tx, input.raceId, actorId, "RACE_MAP_SOURCE_LOCK_CHANGED", {
      sourceDownloadLocked: parsed.data.sourceDownloadLocked,
      sourceDownloadLockedByOrigin: effectiveLockedByOrigin
    });
    return {
      status: "ok" as const,
      sourceDownloadLocked: parsed.data.sourceDownloadLocked,
      sourceDownloadLockedByOrigin: effectiveLockedByOrigin
    };
  });
}

/** Kartfilen i arbetsytans kartläge (utan originalet). */
export async function readAdminRaceMapSource(tx: Transaction, raceId: string, georeferencedAt: Date | null)
  : Promise<AdminRaceMapSource | null> {
  const [row] = await tx.select({ fileName: schema.raceMapSources.fileName, format: schema.raceMapSources.format,
    version: schema.raceMapSources.version, byteLength: schema.raceMapSources.byteLength, scale: schema.raceMapSources.scale,
    georeference: schema.raceMapSources.georeference, summary: schema.raceMapSources.summary, uploadedAt: schema.raceMapSources.uploadedAt,
    sha256: schema.raceMapSources.sha256, clubMapId: schema.raceMapSources.clubMapId, publicListingId: schema.raceMapSources.publicListingId,
    sourceDownloadLocked: schema.raceMapSources.sourceDownloadLocked })
    .from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, raceId));
  if (!row) return null;
  const sourceDownloadLockedByOrigin = row.sourceDownloadLocked && await isRaceMapSourceLockedByOrigin(tx, raceId, row);
  return { fileName: row.fileName, format: row.format, version: row.version, byteLength: row.byteLength, scale: row.scale,
    crs: row.georeference?.crs ?? null,
    // Georefererad ur filen: georeferensen sattes i samma transaktion som kartfilen (inte för hand efteråt).
    georeferencedFromFile: georeferencedAt !== null && georeferencedAt.getTime() === row.uploadedAt.getTime(),
    summary: row.summary, uploadedAt: row.uploadedAt.toISOString(),
    sourceDownloadLocked: row.sourceDownloadLocked,
    sourceDownloadLockedByOrigin };
}
