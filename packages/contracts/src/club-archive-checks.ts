import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * ADR-0196: kontrollen av klubbarkivets kartversioner och de små bilderna av kartorna och träningarna. Bilderna ritas i
 * en administratörs webbläsare (som kartbilden vid uppladdning) och sparas en gång; `readerVersion` är kartläsarens version
 * (`MAP_READER_VERSION` i @o-tid/map-file), så att en bättre läsare ritar om.
 */
export const CLUB_THUMBNAIL_MAX_BYTES = 512 * 1024;
/** Största sida i pixlar på en sparad bild. */
export const CLUB_THUMBNAIL_MAX_SIDE = 2000;
/** JSON-anropet med bilden i base64 får vara högst så här stort. */
export const CLUB_THUMBNAIL_REQUEST_MAX_BYTES = Math.ceil(CLUB_THUMBNAIL_MAX_BYTES / 3) * 4 + 16 * 1024;

export const CLUB_MAP_CHECK_STATUSES = ["OK", "UNSUPPORTED_VERSION", "NOT_A_MAP_FILE", "TRUNCATED", "INVALID", "EMPTY", "TOO_LARGE", "FAILED"] as const;
export type ClubMapCheckStatus = typeof CLUB_MAP_CHECK_STATUSES[number];

const optionalText = (max: number) => z.string().trim().max(max).transform(value => value === "" ? null : value).nullable();
const pngSchema = z.object({
  pngBase64: z.string().min(8).max(Math.ceil(CLUB_THUMBNAIL_MAX_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  width: z.number().int().min(1).max(CLUB_THUMBNAIL_MAX_SIDE),
  height: z.number().int().min(1).max(CLUB_THUMBNAIL_MAX_SIDE)
}).strict();
const readerVersion = z.number().int().min(1).max(10000);

/** Kartversionen kontrollerad: fungerar (med bild) eller varför inte. */
export const clubMapVersionCheckRequestSchema = z.object({
  formatVersion: z.literal(1),
  readerVersion,
  status: z.enum(CLUB_MAP_CHECK_STATUSES),
  /** Läsarens besked, t.ex. "OCAD 7 stöds inte. …". */
  detail: optionalText(300),
  /** T.ex. "OCAD 11.2" eller "Mapper v9". */
  fileVersion: optionalText(60),
  thumbnail: pngSchema.nullable()
}).strict().refine(value => value.status === "OK" || value.thumbnail === null);

/** Träningens bild: längsta banan på kartversionen, eller att kartan inte kunde ritas. */
export const clubEntryThumbnailRequestSchema = z.object({
  formatVersion: z.literal(1),
  readerVersion,
  status: z.enum(["OK", "MAP_FAILED"]),
  detail: optionalText(300),
  mapVersionId: uuidSchema,
  courseName: optionalText(120),
  image: pngSchema.nullable()
}).strict().refine(value => (value.status === "OK") === (value.image !== null));

export type ClubMapVersionCheckRequest = z.infer<typeof clubMapVersionCheckRequestSchema>;
export type ClubEntryThumbnailRequest = z.infer<typeof clubEntryThumbnailRequestSchema>;

export interface ClubMapCheckView {
  status: ClubMapCheckStatus;
  detail: string | null;
  fileVersion: string | null;
  readerVersion: number;
  checkedAt: string;
  /** Bilden finns (`/map-versions/{id}/thumbnail`). */
  thumbnail: boolean;
}

export interface ClubEntryThumbnailView {
  status: "OK" | "MAP_FAILED";
  detail: string | null;
  readerVersion: number;
  courseName: string | null;
  createdAt: string;
  /** Bilden ritades på en annan kartversion än träningens nuvarande (banfilens karta har bytts). */
  stale: boolean;
}

/** Kartversionen och banfilen som träningens bild ritas av (första banfilen med karta, annars kartan i mappen). */
export interface ClubEntryThumbnailSource { versionId: string; fileName: string; courseFileId: string | null }

/** Svaret på "Kontrollera alla kartor igen" på servern: banfilernas sammanfattningar räknade på nytt. */
export interface ClubArchiveSummariesResponse { formatVersion: 1; courseFiles: number; updated: number }
