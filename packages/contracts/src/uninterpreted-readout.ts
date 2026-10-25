import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * Steg 45: avläsningar vars tider inte gick att tolka (SiTimeError, även med datorns klocka). Avläsningssidan skickar
 * råramarna till servern så att de finns kvar även om webbläsaren rensas. Servern sparar dem som ett råmeddelande med
 * transporten `sportident-uninterpreted` och `parser_status` `uninterpreted`, utan avläsning och utan resultat.
 * Administratören ser dem under Avläsning och läser om dem från råramarna med datorns klocka eller en angiven tid.
 */
export const UNINTERPRETED_READOUT_TRANSPORT = "sportident-uninterpreted";
const cardNumber = z.string().regex(/^[1-9][0-9]{0,8}$/);
const instant = z.iso.datetime({ offset: true });

export const uninterpretedReadoutPayloadSchema = z.object({
  cardNumber,
  frames: z.array(z.string().regex(/^(?:[0-9a-f]{2}){1,300}$/)).min(1).max(12),
  /** Felet vid tolkningen, som funktionären såg det. */
  error: z.string().trim().min(1).max(300),
  stationSerial: z.number().int().nonnegative().optional(),
  clockSource: z.enum(["station", "device"]).optional(),
  clockOffsetMs: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).optional(),
  simulated: z.boolean()
}).strict();
export type UninterpretedReadoutPayload = z.infer<typeof uninterpretedReadoutPayloadSchema>;

/** Avläsningssidan: en otolkad avläsning. `requestId` är stabil per avläsning, så samma begäran igen ger samma kvitto. */
export const uninterpretedReadoutRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  deviceId: uuid,
  sessionId: uuid,
  packageVersion: z.number().int().positive(),
  stationReceivedAt: instant,
  payload: uninterpretedReadoutPayloadSchema
}).strict();
export type UninterpretedReadoutRequest = z.infer<typeof uninterpretedReadoutRequestSchema>;

export const uninterpretedReadoutReceiptSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, requestId: uuid, rawMessageId: uuid, status: z.enum(["stored", "duplicate"])
}).strict();
export type UninterpretedReadoutReceipt = z.infer<typeof uninterpretedReadoutReceiptSchema>;

const resultStatus = z.enum(["OK", "OVERTIME", "MP", "UNKNOWN_CARD"]);

/** Administratören: de otolkade avläsningarna och om de lästs om. */
export const uninterpretedReadoutListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  readouts: z.array(z.object({
    rawMessageId: uuid, cardNumber, stationReceivedAt: instant, error: z.string().min(1).max(300), simulated: z.boolean(),
    /** Omläst: avläsningen som skapades och vad servern bedömde. */
    reread: z.object({ readoutId: uuid, status: resultStatus, readAt: instant }).strict().nullable()
  }).strict()).max(10_000)
}).strict();
export type UninterpretedReadoutListResponse = z.infer<typeof uninterpretedReadoutListResponseSchema>;

/** "Läs om": med datorns klocka vid avläsningen (DEVICE) eller en angiven tid för avläsningen (GIVEN). */
export const uninterpretedReadoutRereadRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, rawMessageId: uuid,
  reference: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("DEVICE") }).strict(),
    z.object({ kind: z.literal("GIVEN"), readAt: instant }).strict()
  ])
}).strict();
export type UninterpretedReadoutRereadRequest = z.infer<typeof uninterpretedReadoutRereadRequestSchema>;

export const uninterpretedReadoutRereadResponseSchema = z.discriminatedUnion("result", [
  z.object({ formatVersion: z.literal(1), raceId: uuid, requestId: uuid, rawMessageId: uuid, result: z.literal("READ"),
    replayed: z.boolean(), readoutId: uuid, status: resultStatus, punchCount: z.number().int().min(0).max(1_000) }).strict(),
  /** Gick fortfarande inte: TIME = tiderna går inte att placera, FRAMES = råramarna går inte att avkoda. Inget sparas. */
  z.object({ formatVersion: z.literal(1), raceId: uuid, requestId: uuid, rawMessageId: uuid, result: z.literal("UNREADABLE"),
    reason: z.enum(["TIME", "FRAMES"]), detail: z.string().min(1).max(200) }).strict()
]);
export type UninterpretedReadoutRereadResponse = z.infer<typeof uninterpretedReadoutRereadResponseSchema>;
