import { z } from "zod";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const finite = z.number().refine(Number.isFinite);
const coordinate = finite.min(0).max(200_000);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const privateRoutePreviewQuerySchema = z.object({
  routeUploadId: uuid, mapManifestId: uuid, georeferenceId: uuid
}).strict();

export const privateRoutePreviewRouteCandidateSchema = z.object({
  routeUploadId: uuid, displayName: z.string().min(1).max(241), storedAt: z.iso.datetime(),
  pointCount: z.number().int().min(2).max(100_000), segmentCount: z.number().int().min(1).max(2_000)
}).strict();
export const privateRoutePreviewCandidatesResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, routes: z.array(privateRoutePreviewRouteCandidateSchema).max(100)
}).strict();

/** Pixel positions are all a browser receives; WGS84 and storage data remain server-only. */
export const privateRoutePreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, imageWidth: z.number().int().min(1).max(200_000),
  imageHeight: z.number().int().min(1).max(200_000), mapSourceHash: sha256,
  points: z.array(z.object({ x: coordinate, y: coordinate, segment: z.number().int().min(0).max(1_999) }).strict()).min(2).max(100_000)
}).strict();

export type PrivateRoutePreviewQuery = z.infer<typeof privateRoutePreviewQuerySchema>;
export type PrivateRoutePreviewResponse = z.infer<typeof privateRoutePreviewResponseSchema>;
export type PrivateRoutePreviewCandidatesResponse = z.infer<typeof privateRoutePreviewCandidatesResponseSchema>;
