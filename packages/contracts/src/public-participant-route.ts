import { z } from "zod";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().min(0).max(2_147_483_647);
const positiveRevision = revision.min(1);
const coordinate = z.number().finite().min(0).max(200_000);
export const publicParticipantRouteTimingSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("AVAILABLE"), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), durationMilliseconds: z.number().int().min(0).max(31_536_000_000) }).strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict()
]);
export const publicParticipantRouteMetadataSchema = z.object({
  distanceMeters: z.number().finite().min(0).max(100_000_000), pointCount: z.number().int().min(2).max(100_000),
  segmentCount: z.number().int().min(1).max(2_000), timing: publicParticipantRouteTimingSchema
}).strict();
export const publicParticipantRoutePointSchema = z.object({ x: coordinate, y: coordinate, segment: z.number().int().min(0).max(1_999) }).strict();
export const publicParticipantRouteControlSchema = z.object({ sequence: z.number().int().positive().max(256), controlCode: z.number().int().positive().max(999_999), x: coordinate, y: coordinate }).strict();
export const publicParticipantRoutePlaybackSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("AVAILABLE"), pointElapsedMilliseconds: z.array(z.number().int().min(0).max(31_536_000_000)).min(2).max(100_000) }).strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict()
]);

/** Private MANAGE_RACE write: every selected object is immutable and race-scoped. */
export const publicParticipantRouteReleaseRequestSchema = z.object({
  formatVersion: z.literal(1), routeUploadId: uuid, mapManifestId: uuid,
  georeferenceId: uuid, expectedPublicationRevision: revision
}).strict();
export const publicParticipantRouteReleaseIdempotencyKeySchema = z.string().regex(new RegExp(`^route-publication-release:${uuidPattern}$`));
export const publicParticipantRouteWithdrawRequestSchema = z.object({
  formatVersion: z.literal(1), publicationId: uuid, expectedPublicationRevision: positiveRevision
}).strict();
export const publicParticipantRouteWithdrawIdempotencyKeySchema = z.string().regex(new RegExp(`^route-publication-withdraw:${uuidPattern}$`));

const privatePublicationReceipt = z.object({
  formatVersion: z.literal(1), publicationId: uuid, requestId: uuid, raceId: uuid,
  entryId: uuid, revision: positiveRevision, action: z.enum(["RELEASE", "WITHDRAW"]),
  decidedAt: z.iso.datetime(), replayed: z.boolean()
}).strict();
export const publicParticipantRouteReleaseResponseSchema = privatePublicationReceipt.extend({
  action: z.literal("RELEASE"), routeUploadId: uuid, mapManifestId: uuid, georeferenceId: uuid
}).strict();
export const publicParticipantRouteWithdrawResponseSchema = privatePublicationReceipt.extend({
  action: z.literal("WITHDRAW")
}).strict();

/** Private administrator state for one selected route; it is never a public DTO. */
export const adminPublicParticipantRoutePublicationStateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, routeUploadId: uuid,
  latestPublicationRevision: revision,
  activePublication: z.object({ publicationId: uuid, revision: positiveRevision,
    mapManifestId: uuid, georeferenceId: uuid, releasedAt: z.iso.datetime() }).strict().nullable()
}).strict();

/** Public pixel-only DTO: no WGS84, UUID, hash, store, object or version identifier. */
export const publicParticipantRouteViewResponseSchema = z.object({
  formatVersion: z.literal(2), imageWidth: z.number().int().min(1).max(200_000),
  imageHeight: z.number().int().min(1).max(200_000),
  points: z.array(publicParticipantRoutePointSchema).min(2).max(100_000),
  controls: z.array(publicParticipantRouteControlSchema).min(1).max(256),
  metadata: publicParticipantRouteMetadataSchema, playback: publicParticipantRoutePlaybackSchema,
  notice: z.literal("ROUTE_NOT_GPS_VERIFIED")
}).strict().superRefine((value, context) => {
  if (value.playback.status === "AVAILABLE") {
    const timing = value.metadata.timing;
    if (timing.status !== "AVAILABLE") {
      context.addIssue({ code: "custom", path: ["playback"], message: "Tidsuppspelning kräver komplett GPX-tid" });
      return;
    }
    const durationMilliseconds = timing.durationMilliseconds;
    if (value.playback.pointElapsedMilliseconds.length !== value.points.length) context.addIssue({ code: "custom", path: ["playback", "pointElapsedMilliseconds"], message: "Tidsuppspelning kräver en relativ tid per punkt" });
    if (value.playback.pointElapsedMilliseconds[0] !== 0) context.addIssue({ code: "custom", path: ["playback", "pointElapsedMilliseconds", 0], message: "Första tidsuppspelningspunkten måste vara relativ nolltid" });
    if (value.playback.pointElapsedMilliseconds.some((time, index, all) => time > durationMilliseconds || (index > 0 && time < (all[index - 1] ?? 0)))) context.addIssue({ code: "custom", path: ["playback", "pointElapsedMilliseconds"], message: "Tidsuppspelning måste vara monoton och ligga inom ruttens varaktighet" });
  }
});

/** Public read query: two or three distinct opaque result identities, never internal ids. */
export const publicParticipantRouteComparisonQuerySchema = z.object({
  first: uuid, second: uuid, third: uuid.optional()
}).strict().superRefine(({ first, second, third }, context) => {
  if (first === second) context.addIssue({ code: "custom", path: ["second"], message: "Två olika resultat krävs" });
  if (third !== undefined && (third === first || third === second)) context.addIssue({ code: "custom", path: ["third"], message: "Varje jämförd rutt måste vara ett eget resultat" });
});
export const publicParticipantRouteComparisonParticipantSchema = z.object({
  givenName: z.string().trim().min(1).max(160), familyName: z.string().trim().min(1).max(160)
}).strict();
export const publicParticipantRouteComparisonResultSplitsSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("AVAILABLE"), splits: z.array(z.object({ controlCode: z.number().int().positive(), occurrence: z.number().int().positive(), legMs: z.number().int().min(0), elapsedMs: z.number().int().min(0) }).strict()).min(1).max(256) }).strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict()
]);
const publicParticipantRouteComparisonRouteSchema = z.object({
  participant: publicParticipantRouteComparisonParticipantSchema,
  resultSplits: publicParticipantRouteComparisonResultSplitsSchema,
  points: z.array(publicParticipantRoutePointSchema).min(2).max(100_000),
  metadata: publicParticipantRouteMetadataSchema,
  playback: publicParticipantRoutePlaybackSchema
}).strict().superRefine((route, context) => {
  if (route.playback.status !== "AVAILABLE") return;
  if (route.metadata.timing.status !== "AVAILABLE") {
    context.addIssue({ code: "custom", path: ["playback"], message: "Tidsuppspelning kräver komplett GPX-tid" });
    return;
  }
  const durationMilliseconds = route.metadata.timing.durationMilliseconds;
  if (route.playback.pointElapsedMilliseconds.length !== route.points.length) context.addIssue({ code: "custom", path: ["playback", "pointElapsedMilliseconds"], message: "Tidsuppspelning kräver en relativ tid per punkt" });
  if (route.playback.pointElapsedMilliseconds[0] !== 0) context.addIssue({ code: "custom", path: ["playback", "pointElapsedMilliseconds", 0], message: "Första tidsuppspelningspunkten måste vara relativ nolltid" });
  if (route.playback.pointElapsedMilliseconds.some((time, index, all) => time > durationMilliseconds || (index > 0 && time < (all[index - 1] ?? 0)))) context.addIssue({ code: "custom", path: ["playback", "pointElapsedMilliseconds"], message: "Tidsuppspelning måste vara monoton och ligga inom ruttens varaktighet" });
});

/**
 * Public pixel-only comparison. Identity, map bindings and WGS84 stay
 * server-side; every route is already gated against the same exact history.
 */
const publicParticipantRouteComparisonV2ResponseSchema = z.object({
  formatVersion: z.literal(2), imageWidth: z.number().int().min(1).max(200_000),
  imageHeight: z.number().int().min(1).max(200_000),
  routes: z.tuple([
    publicParticipantRouteComparisonRouteSchema,
    publicParticipantRouteComparisonRouteSchema
  ]),
  controls: z.array(publicParticipantRouteControlSchema).min(1).max(256),
  notice: z.literal("ROUTE_COMPARISON_NOT_GPS_VERIFIED")
}).strict();
const publicParticipantRouteComparisonV3ResponseSchema = z.object({
  formatVersion: z.literal(3), imageWidth: z.number().int().min(1).max(200_000),
  imageHeight: z.number().int().min(1).max(200_000),
  routes: z.tuple([
    publicParticipantRouteComparisonRouteSchema,
    publicParticipantRouteComparisonRouteSchema,
    publicParticipantRouteComparisonRouteSchema
  ]),
  controls: z.array(publicParticipantRouteControlSchema).min(1).max(256),
  notice: z.literal("ROUTE_COMPARISON_NOT_GPS_VERIFIED")
}).strict();
export const publicParticipantRouteComparisonResponseSchema = z.discriminatedUnion("formatVersion", [
  publicParticipantRouteComparisonV2ResponseSchema,
  publicParticipantRouteComparisonV3ResponseSchema
]);

export type PublicParticipantRouteReleaseRequest = z.infer<typeof publicParticipantRouteReleaseRequestSchema>;
export type PublicParticipantRouteReleaseResponse = z.infer<typeof publicParticipantRouteReleaseResponseSchema>;
export type PublicParticipantRouteWithdrawResponse = z.infer<typeof publicParticipantRouteWithdrawResponseSchema>;
export type PublicParticipantRouteViewResponse = z.infer<typeof publicParticipantRouteViewResponseSchema>;
export type PublicParticipantRouteComparisonResponse = z.infer<typeof publicParticipantRouteComparisonResponseSchema>;
export type AdminPublicParticipantRoutePublicationState = z.infer<typeof adminPublicParticipantRoutePublicationStateSchema>;

/** Internal-only guard used by application/database boundaries; never serialize. */
export const publicParticipantRouteManifestBindingSchema = z.object({ routeHash: sha256, mapHash: sha256 }).strict();
