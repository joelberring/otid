import { z } from "zod";

/**
 * Steg 59 (ADR-0179): banläggarens kartfil (OCAD .ocd eller Mapper .omap/.xmap). Webbläsaren läser och ritar filen och
 * skickar originalet, bilden (PNG) och det den räknat fram i en enda uppladdning (multipart). Servern sparar bara.
 */
export const RACE_MAP_SOURCE_MAX_BYTES = 60 * 1024 * 1024;
/** Hela uppladdningen: kartfilen, bilden (högst 30 MB) och metadata med marginal för multipart. */
export const RACE_MAP_SOURCE_UPLOAD_MAX_BYTES = RACE_MAP_SOURCE_MAX_BYTES + 30 * 1024 * 1024 + 1024 * 1024;
export const RACE_MAP_SOURCE_FORMATS = ["OCD", "OMAP"] as const;
/** Delarna i uppladdningen. */
export const RACE_MAP_SOURCE_PARTS = { file: "file", image: "image", metadata: "metadata" } as const;

const mm = z.number().finite().min(-1_000_000).max(1_000_000);
const text = (max: number) => z.string().trim().min(1).max(max);

export const raceMapSourceBoundsSchema = z.object({ minX: mm, minY: mm, maxX: mm, maxY: mm }).strict()
  .refine(bounds => bounds.minX < bounds.maxX && bounds.minY < bounds.maxY);

export const raceMapSourceCrsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EPSG"), code: z.number().int().min(1).max(999_999) }).strict(),
  z.object({ kind: z.literal("UNKNOWN"), description: z.string().max(400) }).strict()
]);

/** Kartfilens georeferens (mm → projicerade meter), som `MapGeoreference` i `@o-tid/map-file`. */
export const raceMapSourceGeoreferenceSchema = z.object({
  scale: z.number().finite().min(100).max(1_000_000),
  crs: raceMapSourceCrsSchema,
  refPoint: z.object({ easting: z.number().finite().min(-100_000_000).max(100_000_000),
    northing: z.number().finite().min(-100_000_000).max(100_000_000) }).strict(),
  mapRefPoint: z.object({ x: mm, y: mm }).strict(),
  grivationDegrees: z.number().finite().min(-360).max(360),
  combinedScaleFactor: z.number().finite().min(0.5).max(2)
}).strict();

/** Bildens upplösning och kartans punkt (mm, y uppåt) i bildens övre vänstra hörn. */
export const raceMapSourceRenderSchema = z.object({ pxPerMm: z.number().finite().positive().max(100), originX: mm, originY: mm }).strict();

export const raceMapSourceSummarySchema = z.object({
  objectCount: z.number().int().nonnegative().max(10_000_000),
  warnings: z.array(z.object({ code: text(80), count: z.number().int().nonnegative().max(10_000_000), text: text(300) }).strict()).max(200),
  simplifications: z.array(text(300)).max(50)
}).strict();

const tiePoint = z.object({
  pixelX: z.number().finite().min(0).max(30_000), pixelY: z.number().finite().min(0).max(30_000),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180)
}).strict();

/** Det webbläsaren räknat fram, som delen `metadata` (JSON) i uppladdningen. */
export const raceMapSourceMetadataSchema = z.object({
  formatVersion: z.literal(1),
  format: z.enum(RACE_MAP_SOURCE_FORMATS),
  version: text(80),
  scale: z.number().int().min(100).max(1_000_000),
  bounds: raceMapSourceBoundsSchema,
  georeference: raceMapSourceGeoreferenceSchema.nullable(),
  render: raceMapSourceRenderSchema,
  summary: raceMapSourceSummarySchema,
  /** Tre punkter (pixel → WGS 84) ur kartfilens georeferens; null = arrangören sätter dem för hand. */
  tiePoints: z.tuple([tiePoint, tiePoint, tiePoint]).nullable()
}).strict();

/** Kartfilen i arbetsytans kartläge (utan originalet). */
export const adminRaceMapSourceSchema = z.object({
  fileName: text(400),
  format: z.enum(RACE_MAP_SOURCE_FORMATS),
  version: text(80),
  byteLength: z.number().int().positive().max(RACE_MAP_SOURCE_MAX_BYTES),
  scale: z.number().int().min(100).max(1_000_000),
  crs: raceMapSourceCrsSchema.nullable(),
  /** Bilden georefererades automatiskt ur filen vid uppladdningen. */
  georeferencedFromFile: z.boolean(),
  summary: raceMapSourceSummarySchema,
  uploadedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
}).strict();

export type RaceMapSourceMetadata = z.infer<typeof raceMapSourceMetadataSchema>;
export type RaceMapSourceGeoreference = z.infer<typeof raceMapSourceGeoreferenceSchema>;
export type AdminRaceMapSource = z.infer<typeof adminRaceMapSourceSchema>;
