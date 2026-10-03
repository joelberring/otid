import { z } from "zod";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const revision = z.number().int().min(0).max(2_147_483_647);
const positiveRevision = revision.min(1);
const instant = z.iso.datetime();

export const privateRouteContextBindIdempotencyKeySchema = z.string().regex(
  new RegExp(`^private-route-context-bind:${uuidPattern}$`)
);

const activeContextSchema = z.object({
  contextId: uuid,
  revision: positiveRevision,
  mapManifestId: uuid,
  georeferenceId: uuid,
  geometryRevisionId: uuid,
  courseVersionId: uuid,
  boundAt: instant
}).strict();

export const adminPrivateRouteContextStateResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  routeUploadId: uuid,
  latestContextRevision: revision,
  activeContext: activeContextSchema.nullable()
}).strict();

export const privateRouteContextBindRequestSchema = z.object({
  formatVersion: z.literal(1),
  routeUploadId: uuid,
  mapManifestId: uuid,
  georeferenceId: uuid,
  geometryRevisionId: uuid,
  expectedContextRevision: revision
}).strict();

export const privateRouteContextBindResponseSchema = z.object({
  formatVersion: z.literal(1),
  contextId: uuid,
  requestId: uuid,
  raceId: uuid,
  routeUploadId: uuid,
  revision: positiveRevision,
  mapManifestId: uuid,
  georeferenceId: uuid,
  geometryRevisionId: uuid,
  courseVersionId: uuid,
  boundAt: instant,
  replayed: z.boolean()
}).strict();

export type AdminPrivateRouteContextStateResponse = z.infer<typeof adminPrivateRouteContextStateResponseSchema>;
export type PrivateRouteContextBindRequest = z.infer<typeof privateRouteContextBindRequestSchema>;
export type PrivateRouteContextBindResponse = z.infer<typeof privateRouteContextBindResponseSchema>;
