import { z } from "zod";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

/**
 * PLAN.md steg 46: "Stryk alla självregistrerade som inte läst ut" under Anmälda. Förhandsvisningen listar
 * självregistrerade deltagare utan resultat (ingen avläsning och inget beslut); åtgärden stryker de som arrangören
 * bekräftade och som fortfarande saknar resultat. Samma begäran igen gör inget nytt.
 */
const candidate = z.object({
  entryId: uuid,
  name: z.string().trim().min(1).max(321),
  className: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  cardNumber: z.string().min(1).max(32).nullable(),
  selfRegisteredAt: z.iso.datetime({ offset: true })
}).strict();

export const selfRegistrationCleanupPreviewSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  entries: z.array(candidate).max(10_000)
}).strict();

export const selfRegistrationCleanupRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  entryIds: z.array(uuid).min(1).max(10_000).refine((ids) => new Set(ids).size === ids.length, "Deltagarna måste vara unika")
}).strict();

export const selfRegistrationCleanupIdempotencyKeySchema = z.string().regex(prefixedUuidPattern("self-registration-cleanup"));

export const selfRegistrationCleanupResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuid,
  raceId: uuid,
  request: selfRegistrationCleanupRequestSchema,
  /** Strukna genom den här begäran (nu eller vid ett tidigare försök med samma id). */
  struckEntryIds: z.array(uuid).max(10_000),
  /** Inte längre kandidater (avläst, beslut, struken eller inte självregistrerad) och därför orörda. */
  skippedCount: z.number().int().min(0).max(10_000)
}).strict();

export type SelfRegistrationCleanupPreview = z.infer<typeof selfRegistrationCleanupPreviewSchema>;
export type SelfRegistrationCleanupRequest = z.infer<typeof selfRegistrationCleanupRequestSchema>;
export type SelfRegistrationCleanupResponse = z.infer<typeof selfRegistrationCleanupResponseSchema>;
