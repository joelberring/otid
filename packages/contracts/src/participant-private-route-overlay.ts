import { z } from "zod";
import { participantPrivateRouteDetailResponseSchema } from "./participant-private-route";
import { publicParticipantRoutePlaybackSchema } from "./public-participant-route";

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const pixel = z.number().finite().min(0).max(200_000);
const resultSplitsSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("AVAILABLE"),
    resultRevision: z.number().int().min(1).max(2_147_483_647),
    splits: z.array(z.object({
      controlCode: z.number().int().positive(),
      occurrence: z.number().int().positive(),
      legMs: z.number().int().min(0),
      elapsedMs: z.number().int().min(0)
    }).strict()).min(1).max(256)
  }).strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict()
]);
const normalizedUtcIso = z.string().refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}, "Tiden måste vara normaliserad UTC ISO-tid");
const resultStartSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("AVAILABLE"),
    resultRevision: z.number().int().min(1).max(2_147_483_647),
    startedAt: normalizedUtcIso
  }).strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict()
]);

/** Participant pixels and control positions only; geographic and storage coordinates stay server-side. */
export const participantPrivateRouteOverlayResponseSchema = z.object({
  formatVersion: z.literal(4),
  routeUploadId: uuid,
  contextRevision: z.number().int().min(1).max(2_147_483_647),
  imageWidth: z.number().int().min(1).max(200_000),
  imageHeight: z.number().int().min(1).max(200_000),
  points: z.array(z.object({
    x: pixel,
    y: pixel,
    segment: z.number().int().min(0).max(1_999)
  }).strict()).min(2).max(100_000),
  controls: z.array(z.object({
    sequence: z.number().int().min(1).max(256),
    controlCode: z.number().int().positive(),
    x: pixel,
    y: pixel
  }).strict()).min(1).max(256),
  metadata: participantPrivateRouteDetailResponseSchema.shape.metadata,
  playback: publicParticipantRoutePlaybackSchema,
  resultStart: resultStartSchema,
  resultSplits: resultSplitsSchema,
  notice: z.literal("ROUTE_NOT_GPS_VERIFIED")
}).strict().superRefine((value, context) => {
  if (value.resultStart.status === "AVAILABLE" && value.resultSplits.status === "AVAILABLE") {
    if (value.resultStart.resultRevision !== value.resultSplits.resultRevision) {
      context.addIssue({
        code: "custom",
        path: ["resultSplits", "resultRevision"],
        message: "Resultatstart och sträcktider måste komma från samma revision"
      });
    }

    const seenSplits = new Set<string>();
    value.resultSplits.splits.forEach((split, index) => {
      const identity = `${split.controlCode}:${split.occurrence}`;
      if (seenSplits.has(identity)) {
        context.addIssue({
          code: "custom",
          path: ["resultSplits", "splits", index],
          message: "Kontrollkod och förekomst måste vara unik inom sträcktiderna"
        });
      }
      seenSplits.add(identity);
    });
  }

  if (value.metadata.pointCount !== value.points.length) {
    context.addIssue({ code: "custom", path: ["metadata", "pointCount"], message: "Punktantalet måste motsvara rutten" });
  }

  if (value.playback.status === "UNAVAILABLE") {
    if (value.metadata.timing.status === "AVAILABLE") {
      context.addIssue({ code: "custom", path: ["playback"], message: "Tillgänglig GPX-tid kräver tidsuppspelning" });
    }
    return;
  }

  if (value.metadata.timing.status !== "AVAILABLE") {
    context.addIssue({ code: "custom", path: ["playback"], message: "Tidsuppspelning kräver komplett GPX-tid" });
    return;
  }

  const elapsed = value.playback.pointElapsedMilliseconds;
  const duration = value.metadata.timing.durationMilliseconds;
  if (elapsed.length !== value.points.length) {
    context.addIssue({ code: "custom", path: ["playback", "pointElapsedMilliseconds"], message: "Tidsuppspelning kräver en relativ tid per punkt" });
  }
  if (elapsed[0] !== 0) {
    context.addIssue({ code: "custom", path: ["playback", "pointElapsedMilliseconds", 0], message: "Första tidsuppspelningspunkten måste vara relativ nolltid" });
  }
  if (elapsed.some((time, index, all) => time > duration || (index > 0 && time < (all[index - 1] ?? 0)))) {
    context.addIssue({ code: "custom", path: ["playback", "pointElapsedMilliseconds"], message: "Tidsuppspelning måste vara monoton och ligga inom ruttens varaktighet" });
  }
});

export type ParticipantPrivateRouteOverlayResponse = z.infer<typeof participantPrivateRouteOverlayResponseSchema>;
