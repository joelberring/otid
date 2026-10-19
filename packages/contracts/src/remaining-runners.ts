import { z } from "zod";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

/**
 * PLAN.md steg 25: "Markera alla kvar i skogen som ej start" efter tävlingen. Förhandsvisningen delar löparna utan
 * avläsning och beslut i de som blir ej start och de som har startat (radiokontroll eller avprickning) men saknas i mål.
 * Åtgärden lägger till en ej start-revision per löpare i flödet `setEntryStatus` och är idempotent på begärans id.
 */
const runner = z.object({
  entryId: uuid,
  name: z.string().trim().min(1).max(321),
  className: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  cardNumber: z.string().min(1).max(32).nullable(),
  /** Bara för "saknas i mål": varför löparen anses ha startat. */
  evidence: z.enum(["RADIO", "START_CHECKIN"]).optional()
}).strict();

export const remainingRunnersResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  didNotStart: z.array(runner).max(10_000),
  missingAtFinish: z.array(runner).max(10_000)
}).strict();

export const markRemainingDidNotStartRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  /** Löparna i förhandsvisningen som arrangören bekräftade. */
  entryIds: z.array(uuid).min(1).max(10_000).refine((ids) => new Set(ids).size === ids.length, "Löparna måste vara unika")
}).strict();

export const markRemainingDidNotStartIdempotencyKeySchema = z.string().regex(prefixedUuidPattern("remaining-did-not-start"));

export const markRemainingDidNotStartResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuid,
  raceId: uuid,
  request: markRemainingDidNotStartRequestSchema,
  /** Löpare som är ej start genom den här begäran (nu eller vid ett tidigare försök med samma id). */
  marked: z.array(z.object({ entryId: uuid, revision: z.number().int().positive() }).strict()).max(10_000),
  /** Löpare som inte längre var kvar (avläst eller beslut under tiden) och därför lämnades orörda. */
  skippedCount: z.number().int().min(0).max(10_000)
}).strict();

export type RemainingRunnersResponse = z.infer<typeof remainingRunnersResponseSchema>;
export type MarkRemainingDidNotStartRequest = z.infer<typeof markRemainingDidNotStartRequestSchema>;
export type MarkRemainingDidNotStartResponse = z.infer<typeof markRemainingDidNotStartResponseSchema>;
