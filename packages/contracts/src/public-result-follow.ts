import { z } from "zod";
import { publicResultIdSchema, publicResultV7Schema } from "./public-results";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);

export const publicResultFollowSetRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  publicResultId: publicResultIdSchema,
  followed: z.boolean()
}).strict();

export const publicResultFollowSetResponseSchema = z.object({
  formatVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  publicResultId: publicResultIdSchema,
  followed: z.boolean(),
  replayed: z.boolean()
}).strict();

export const publicResultFollowListItemSchema = z.object({
  raceId: canonicalUuidSchema,
  publicResultId: publicResultIdSchema,
  eventName: z.string().trim().min(1).max(160),
  raceName: z.string().trim().min(1).max(160),
  result: z.nullable(publicResultV7Schema)
}).strict();

export const publicResultFollowListResponseSchema = z.object({
  formatVersion: z.literal(1),
  items: z.array(publicResultFollowListItemSchema).max(1000)
}).strict();

export function publicResultFollowIdempotencyKey(requestId: string): string {
  return `public-result-follow:${requestId}`;
}

export type PublicResultFollowSetRequest = z.infer<typeof publicResultFollowSetRequestSchema>;
export type PublicResultFollowSetResponse = z.infer<typeof publicResultFollowSetResponseSchema>;
export type PublicResultFollowListResponse = z.infer<typeof publicResultFollowListResponseSchema>;
