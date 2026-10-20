import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * Läs om avläsningar från rådata (PLAN.md steg 36): varje sparad riktig avläsning avkodas på nytt från råramarna med
 * den nuvarande brickavkodningen och samma tidsreferens som vid avläsningen. Förhandsvisningen listar bara avläsningar
 * där stämplingarna eller tiderna blir andra, och de som inte går att läsa om. Sparandet tar de valda med deras hash.
 */
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const cardNumber = z.string().regex(/^[1-9][0-9]{0,8}$/);
const resultStatus = z.enum(["OK", "OVERTIME", "MP", "UNKNOWN_CARD"]);

/** Ett manuellt beslut som ligger kvar över den nya avläsningen (steg 31 B2). */
export const readoutRereadManualDecisionSchema = z.enum(["DSQ", "APPROVAL", "DNF", "OOC", "NT", "FINISH_TIME", "START_TIME",
  "MANUAL_TIME", "CONTROL_APPROVAL"]);

const sideSchema = z.object({
  punchCount: z.number().int().min(0).max(1_000),
  status: resultStatus,
  elapsedMs: z.number().int().nullable()
}).strict();

const entrySchema = { readoutId: uuid, entryId: uuid, displayName: z.string().min(1).max(321), className: z.string().min(1).max(160),
  cardNumber };

export const readoutRereadItemSchema = z.object({
  ...entrySchema,
  before: sideSchema,
  after: sideSchema,
  manualDecision: readoutRereadManualDecisionSchema.nullable(),
  itemHash: hash
}).strict();
export type ReadoutRereadItem = z.infer<typeof readoutRereadItemSchema>;

export const readoutRereadUnreadableSchema = z.object({
  ...entrySchema,
  /** FRAMES: råramarna går inte att avkoda (fel kontrollsumma, saknade block). TIME: tiderna går inte att placera. */
  reason: z.enum(["FRAMES", "TIME", "PAYLOAD"]),
  detail: z.string().min(1).max(200)
}).strict();
export type ReadoutRereadUnreadable = z.infer<typeof readoutRereadUnreadableSchema>;

export const readoutRereadPreviewRequestSchema = z.object({ formatVersion: z.literal(1), entryId: uuid.optional() }).strict();

export const readoutRereadPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid.optional(),
  /** Riktiga avläsningar (inte övningsstationen) som lästes om. */
  checkedCount: z.number().int().min(0),
  items: z.array(readoutRereadItemSchema).max(10_000),
  unreadable: z.array(readoutRereadUnreadableSchema).max(10_000)
}).strict();
export type ReadoutRereadPreviewResponse = z.infer<typeof readoutRereadPreviewResponseSchema>;

export const readoutRereadCommitRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid,
  items: z.array(z.object({ readoutId: uuid, entryId: uuid, itemHash: hash }).strict()).min(1).max(1_000)
}).strict().refine((value) => new Set(value.items.map((item) => `${item.readoutId}:${item.entryId}`)).size === value.items.length,
  { path: ["items"] });
export type ReadoutRereadCommitRequest = z.infer<typeof readoutRereadCommitRequestSchema>;

export const readoutRereadCommitResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, requestId: uuid, replayed: z.boolean(),
  saved: z.array(z.object({
    entryId: uuid,
    /** Avläsningen som lästes om (oförändrad) och den nya. */
    replacedReadoutId: uuid, readoutId: uuid,
    resultRevisionId: uuid, revision: z.number().int().positive()
  }).strict()).min(1).max(1_000),
  appliedAt: z.iso.datetime({ offset: true })
}).strict();
export type ReadoutRereadCommitResponse = z.infer<typeof readoutRereadCommitResponseSchema>;
