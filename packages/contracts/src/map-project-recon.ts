import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * ADR-0219 tillägget om rekningen (K3): GPS-spår, bekräftade objekt ("kollat") och projektets inställningar för rekningen.
 * Spåren syns bara för projektets medlemmar; var och en lägger till och tar bort sina egna. Punkterna är
 * [lat, lon, sekunder från spårets start, noggrannhet i meter] (WGS 84) och kommer i delar om högst
 * `MAP_PROJECT_TRACK_PART_POINTS`; samma del två gånger görs en gång.
 */
export const MAP_PROJECT_TRACK_PART_POINTS = 2000;
/** Så många delar ett spår får ha (100 000 punkter: ett dygn med en punkt varannan sekund efter förenklingen). */
export const MAP_PROJECT_TRACK_MAX_PARTS = 50;
/** Så många spår ett projekt får ha. */
export const MAP_PROJECT_MAX_TRACKS = 2000;
/** Så många bekräftelser i en omgång. */
export const MAP_PROJECT_CHECK_BATCH = 2000;

const finite = z.number().finite();
const sight = z.number().finite().min(2).max(200);
const share = z.number().finite().min(0.1).max(1);

/** Samma form som `ReconSettings` i map-revision (`reconSettingsProblem` prövar också). */
export const mapProjectReconSettingsSchema = z.object({
  sightM: z.object({ LANDFORMS: sight, ROCK: sight, STONES: sight, WATER: sight, VEGETATION: sight, MANMADE: sight }).strict(),
  lineShare: share, areaShare: share, coverM: sight
}).strict();
export type MapProjectReconSettings = z.infer<typeof mapProjectReconSettingsSchema>;

export const mapProjectTrackSourceSchema = z.enum(["FIELD", "GPX"]);
export const mapProjectTrackNameSchema = z.string().trim().min(1).max(80);
const isoSchema = z.string().datetime({ offset: true });

/** Nytt spår (id:t från telefonen). */
export const mapProjectTrackCreateRequestSchema = z.object({
  formatVersion: z.literal(1), trackId: uuidSchema, name: mapProjectTrackNameSchema, source: mapProjectTrackSourceSchema,
  startedAt: isoSchema.optional()
}).strict();

export const mapProjectTrackPointSchema = z.tuple([finite.min(-90).max(90), finite.min(-180).max(180), finite.min(0).max(10_000_000),
  finite.min(0).max(10_000)]);
/** En del av spåret; `endedAt` sätts med den sista delen. */
export const mapProjectTrackPartRequestSchema = z.object({
  formatVersion: z.literal(1), seq: z.number().int().min(0).max(MAP_PROJECT_TRACK_MAX_PARTS - 1),
  points: z.array(mapProjectTrackPointSchema).min(1).max(MAP_PROJECT_TRACK_PART_POINTS), endedAt: isoSchema.optional()
}).strict();

/** Byt namn på ett eget spår. */
export const mapProjectTrackUpdateRequestSchema = z.object({ formatVersion: z.literal(1), name: mapProjectTrackNameSchema }).strict();

export interface MapProjectTrackView {
  trackId: string; name: string; source: "FIELD" | "GPX";
  account: { accountId: string; name: string | null };
  /** Kontots eget spår (får tas bort och döpas om). */
  own: boolean;
  startedAt: string | null; endedAt: string | null; pointCount: number; lengthM: number; createdAt: string; updatedAt: string;
  /** Delarna som finns (för telefonens kö). */
  parts: number[];
}
export interface MapProjectTrackList { formatVersion: 1; tracks: MapProjectTrackView[] }
export interface MapProjectTrackPoints { formatVersion: 1; trackId: string; points: [number, number, number, number][] }

const objectKeySchema = z.string().min(3).max(300);
/** Bekräfta objekt (`set`, med objektets senaste ändring som klienten känner till; null = grundfilens) och ta bort bekräftelser. */
export const mapProjectChecksRequestSchema = z.object({
  formatVersion: z.literal(1),
  set: z.array(z.object({ key: objectKeySchema, basis: uuidSchema.nullable() }).strict()).max(MAP_PROJECT_CHECK_BATCH).default([]),
  clear: z.array(objectKeySchema).max(MAP_PROJECT_CHECK_BATCH).default([])
}).strict().refine(value => value.set.length + value.clear.length > 0);

export interface MapProjectCheckView { key: string; basis: string | null; accountId: string; name: string | null; at: string }
export interface MapProjectCheckList { formatVersion: 1; checks: MapProjectCheckView[] }

/** Notiser (K3): en punkt i kartans mm (y uppåt) med text och valfritt foto (JPEG, PNG eller WebP i base64, högst 2 MB). */
export const MAP_PROJECT_NOTE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const notePoint = z.object({ x: finite.min(-5_000_000).max(5_000_000), y: finite.min(-5_000_000).max(5_000_000) }).strict();
export const mapProjectNoteCreateRequestSchema = z.object({
  formatVersion: z.literal(1), noteId: uuidSchema, at: notePoint, objectKey: objectKeySchema.nullable().optional(),
  text: z.string().trim().max(1000),
  photo: z.object({ mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    base64: z.string().min(4).max(Math.ceil(MAP_PROJECT_NOTE_PHOTO_MAX_BYTES * 4 / 3) + 4).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().nullable().optional()
}).strict().refine(value => value.text.length > 0 || !!value.photo, { message: "Text eller foto" });
export const mapProjectNoteUpdateRequestSchema = z.object({ formatVersion: z.literal(1), status: z.enum(["OPEN", "DONE"]) }).strict();

export interface MapProjectNoteView {
  noteId: string; at: { x: number; y: number }; objectKey: string | null; text: string;
  photo: { mediaType: string; bytes: number } | null; status: "OPEN" | "DONE";
  account: { accountId: string; name: string | null }; own: boolean; createdAt: string; resolvedAt: string | null;
}
export interface MapProjectNoteList { formatVersion: 1; notes: MapProjectNoteView[] }
