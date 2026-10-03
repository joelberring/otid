import { z } from "zod";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const finiteNumber = z.number().refine(Number.isFinite, "Måste vara ett ändligt tal");
const positiveVersion = z.number().int().min(1).max(2_147_483_647);
const nonnegativeVersion = z.number().int().min(0).max(2_147_483_647);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const imageDimension = z.number().int().min(1).max(200_000);
const tiePointSchema = z.object({
  pixelX: finiteNumber.min(0).max(200_000), pixelY: finiteNumber.min(0).max(200_000),
  longitude: finiteNumber.min(-180).max(180), latitude: finiteNumber.min(-90).max(90)
}).strict();
const transformSchema = z.object({ a: finiteNumber, b: finiteNumber, c: finiteNumber, d: finiteNumber, e: finiteNumber, f: finiteNumber }).strict();

export const mapGeoreferenceCreateIdempotencyKeySchema = z.string().regex(new RegExp(`^map-georeference:${uuidPattern}$`));

/** Three control points are deliberately exact; the server derives the affine transform. */
export const mapGeoreferenceCreateRequestSchema = z.object({
  formatVersion: z.literal(1), manifestId: uuid, expectedGeoreferenceRevision: nonnegativeVersion,
  imageWidth: imageDimension, imageHeight: imageDimension, crs: z.literal("EPSG:4326"),
  tiePoints: z.tuple([tiePointSchema, tiePointSchema, tiePointSchema])
}).strict();

export const mapGeoreferenceResponseSchema = z.object({
  formatVersion: z.literal(1), georeferenceId: uuid, requestId: uuid, raceId: uuid, revision: positiveVersion,
  manifestId: uuid, sourceHash: sha256, imageWidth: imageDimension, imageHeight: imageDimension,
  crs: z.literal("EPSG:4326"), tiePoints: z.tuple([tiePointSchema, tiePointSchema, tiePointSchema]),
  transform: transformSchema, maxResidualMeters: finiteNumber.min(0).max(0.01), decidedAt: z.iso.datetime(), replayed: z.boolean()
}).strict();

const adminGeoreferenceSchema = mapGeoreferenceResponseSchema.omit({ requestId: true, replayed: true });
export const adminMapGeoreferenceStateResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, latestGeoreferenceRevision: nonnegativeVersion,
  georeferences: z.array(adminGeoreferenceSchema).max(100)
}).strict();

export type MapGeoreferenceCreateRequest = z.infer<typeof mapGeoreferenceCreateRequestSchema>;
export type MapGeoreferenceResponse = z.infer<typeof mapGeoreferenceResponseSchema>;
export type AdminMapGeoreferenceStateResponse = z.infer<typeof adminMapGeoreferenceStateResponseSchema>;
