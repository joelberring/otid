import { z } from "zod";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const utcInstant = z.iso.datetime();
const participantPrivateRouteTimingSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("AVAILABLE"),
    startedAt: utcInstant,
    finishedAt: utcInstant,
    durationMilliseconds: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  }).strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict()
]);

const participantPrivateRouteMetadataSchema = z.object({
  distanceMeters: z.number().finite().min(0),
  pointCount: z.number().int().min(2).max(100_000),
  segmentCount: z.number().int().min(1).max(2_000),
  timing: participantPrivateRouteTimingSchema
}).strict();

const participantPrivateRouteNames = {
  eventName: z.string().trim().min(1).max(240),
  raceName: z.string().trim().min(1).max(240)
};

export const participantPrivateRouteListItemSchema = z.object({
  routeUploadId: uuid,
  raceId: uuid,
  ...participantPrivateRouteNames,
  storedAt: utcInstant,
  pointCount: z.number().int().min(2).max(100_000),
  segmentCount: z.number().int().min(1).max(2_000)
}).strict();

export const participantPrivateRouteListResponseSchema = z.object({
  formatVersion: z.literal(1),
  items: z.array(participantPrivateRouteListItemSchema).max(10_000)
}).strict();

export const participantPrivateRouteDetailResponseSchema = z.object({
  formatVersion: z.literal(2),
  routeUploadId: uuid,
  raceId: uuid,
  ...participantPrivateRouteNames,
  storedAt: utcInstant,
  metadata: participantPrivateRouteMetadataSchema,
  sharing: z.union([
    z.object({
      consent: z.literal("GRANTED"),
      adminRelease: z.literal("ACTIVE"),
      publicRoute: z.object({ status: z.literal("AVAILABLE"), publicResultId: uuid }).strict()
    }).strict(),
    z.object({
      consent: z.enum(["GRANTED", "NOT_GRANTED"]),
      adminRelease: z.enum(["ACTIVE", "INACTIVE"]),
      publicRoute: z.object({ status: z.literal("UNAVAILABLE") }).strict()
    }).strict()
  ])
}).strict();

export type ParticipantPrivateRouteListItem = z.infer<typeof participantPrivateRouteListItemSchema>;
export type ParticipantPrivateRouteListResponse = z.infer<typeof participantPrivateRouteListResponseSchema>;
export type ParticipantPrivateRouteDetailResponse = z.infer<typeof participantPrivateRouteDetailResponseSchema>;
