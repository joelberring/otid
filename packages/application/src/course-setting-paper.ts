import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  PAPER_IMAGE_MAX_BYTES, paperImageSchema, paperLibrarySaveRequestSchema, paperLibrarySchema, type PaperImageResponse, type PaperLibrary
} from "@o-tid/contracts";
import { CourseSettingEditError, validatePaperTemplate } from "@o-tid/course-setting";
import { schema, type Database } from "@o-tid/database";
import { courseSettingRead, courseSettingWrite, type Failure, type ReadProof } from "./course-setting";
import type { RaceSessionProof } from "./race-session";

/**
 * ADR-0197: papperets bilder och mallbibliotek. Bilderna sparas en gång per innehåll (sha256) och pekas ut av dokumentet;
 * den som får ändra banläggningen laddar upp (PNG eller JPEG, högst 2 MB, typen prövas mot innehållet). En bild visas för
 * den som får läsa banläggningen när tävlingens dokument pekar på den, eller för den som laddade upp den. Mallarna i
 * kontots bibliotek är kontots egna (namnet unikt per konto) och används i andra tävlingar genom att kopieras in i dokumentet.
 */
const images = schema.courseSettingPaperImages;
const library = schema.courseSettingPaperTemplates;
const SHA256 = /^[0-9a-f]{64}$/;
const LIBRARY_MAX = 200;

/** Bildens typ och storlek ur innehållet (PNG:s IHDR, JPEG:s SOF); annat ger undefined. */
export function sniffPaperImage(bytes: Uint8Array): { mediaType: "image/png" | "image/jpeg"; width: number; height: number } | undefined {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && png.every((value, index) => bytes[index] === value)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    return width > 0 && height > 0 ? { mediaType: "image/png", width, height } : undefined;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return undefined;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) { offset += 1; continue; }
      const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
        return width > 0 && height > 0 ? { mediaType: "image/jpeg", width, height } : undefined;
      }
      if (length < 2) return undefined;
      offset += 2 + length;
    }
  }
  return undefined;
}

export async function uploadPaperImageAsAdmin(db: Database, input: RaceSessionProof & { mediaType: string; image: Uint8Array }, now = new Date())
  : Promise<Failure | { status: "ok"; response: PaperImageResponse }> {
  if (input.image.byteLength === 0 || input.image.byteLength > PAPER_IMAGE_MAX_BYTES) return { status: "invalid-request" };
  const sniffed = sniffPaperImage(input.image);
  if (!sniffed || sniffed.mediaType !== input.mediaType || sniffed.width > 20000 || sniffed.height > 20000) return { status: "invalid-request" };
  const sha256 = createHash("sha256").update(input.image).digest("hex");
  return courseSettingWrite(db, input, now, "EDIT", async (tx, _raceId, actorId) => {
    await tx.insert(images).values({ sha256, mediaType: sniffed.mediaType, image: Buffer.from(input.image), width: sniffed.width, height: sniffed.height,
      uploadedBy: actorId, createdAt: now }).onConflictDoNothing();
    return { status: "ok" as const, response: paperImageSchema.parse({ formatVersion: 1, sha256, ...sniffed }) };
  });
}

export async function readPaperImageAsAdmin(db: Database, input: ReadProof & { sha256: string }, now = new Date())
  : Promise<Failure | { status: "ok"; mediaType: string; image: Buffer }> {
  if (!SHA256.test(input.sha256)) return { status: "invalid-request" };
  return courseSettingRead(db, input, now, async (tx, raceId, principal) => {
    const [row] = await tx.select({ mediaType: images.mediaType, image: images.image, uploadedBy: images.uploadedBy }).from(images)
      .where(eq(images.sha256, input.sha256));
    if (!row) return { status: "not-found" as const };
    if (row.uploadedBy !== principal.accountId) {
      // Tävlingens dokument eller kontots bibliotek pekar på bilden.
      const [used] = await tx.select({ raceId: schema.courseSettings.raceId }).from(schema.courseSettings)
        .where(and(eq(schema.courseSettings.raceId, raceId), sql`position(${input.sha256} in ${schema.courseSettings.document}::text) > 0`));
      const [own] = used ? [used] : await tx.select({ id: library.id }).from(library)
        .where(and(eq(library.accountId, principal.accountId), sql`position(${input.sha256} in ${library.template}::text) > 0`)).limit(1);
      if (!own) return { status: "not-found" as const };
    }
    return { status: "ok" as const, mediaType: row.mediaType, image: row.image };
  });
}

/** Bilderna för utskriftsarbetaren (PDF:en), per sha256. */
export async function paperImagesFor(db: Database, hashes: readonly string[]): Promise<Map<string, { mediaType: string; bytes: Uint8Array }>> {
  const wanted = [...new Set(hashes.filter(hash => SHA256.test(hash)))];
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ sha256: images.sha256, mediaType: images.mediaType, image: images.image }).from(images).where(inArray(images.sha256, wanted));
  return new Map(rows.map(row => [row.sha256, { mediaType: row.mediaType, bytes: new Uint8Array(row.image) }]));
}

async function listFor(tx: Parameters<Parameters<typeof courseSettingRead>[3]>[0], accountId: string): Promise<PaperLibrary> {
  const rows = await tx.select().from(library).where(eq(library.accountId, accountId)).orderBy(asc(library.name)).limit(LIBRARY_MAX);
  return paperLibrarySchema.parse({ formatVersion: 1, templates: rows.map(row => ({ id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(),
    template: row.template })) });
}

export async function listPaperLibraryAsAdmin(db: Database, input: ReadProof, now = new Date()): Promise<Failure | { status: "ok"; response: PaperLibrary }> {
  return courseSettingRead(db, input, now, async (tx, _raceId, principal) => ({ status: "ok" as const, response: await listFor(tx, principal.accountId) }), "EDIT");
}

/** Sparar mallen i kontots bibliotek (samma namn ersätts). */
export async function savePaperLibraryAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; response: PaperLibrary }> {
  const parsed = paperLibrarySaveRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  let template;
  try { template = validatePaperTemplate({ ...parsed.data.template, name: parsed.data.name }); } catch (error) {
    if (error instanceof CourseSettingEditError) return { status: "invalid-request" };
    throw error;
  }
  if (Buffer.byteLength(JSON.stringify(template)) > 64 * 1024) return { status: "too-large" };
  return courseSettingWrite(db, input, now, "EDIT", async (tx, _raceId, actorId) => {
    const [{ count } = { count: 0 }] = await tx.select({ count: sql<number>`count(*)::int` }).from(library).where(eq(library.accountId, actorId));
    const [existing] = await tx.select({ id: library.id }).from(library).where(and(eq(library.accountId, actorId), eq(library.name, template.name)));
    if (!existing && count >= LIBRARY_MAX) return { status: "too-large" as const };
    if (existing) await tx.update(library).set({ template, updatedAt: now }).where(eq(library.id, existing.id));
    else await tx.insert(library).values({ id: randomUUID(), accountId: actorId, name: template.name, template, updatedAt: now });
    return { status: "ok" as const, response: await listFor(tx, actorId) };
  });
}

export async function deletePaperLibraryAsAdmin(db: Database, input: RaceSessionProof & { templateId: string }, now = new Date())
  : Promise<Failure | { status: "ok"; response: PaperLibrary }> {
  if (!/^[0-9a-f-]{36}$/.test(input.templateId)) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "EDIT", async (tx, _raceId, actorId) => {
    const deleted = await tx.delete(library).where(and(eq(library.id, input.templateId), eq(library.accountId, actorId))).returning({ id: library.id });
    if (deleted.length === 0) return { status: "not-found" as const };
    return { status: "ok" as const, response: await listFor(tx, actorId) };
  });
}
