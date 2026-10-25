import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * Rättningar för hela tävlingen (PLAN.md steg 31): tidsjustering för en station, kontroll ur funktion, flytta en klass
 * starttider och räkna om hela tävlingen. Varje åtgärd visas först ("Visa vad som händer") och sparas sedan med
 * förhandsbeskedets hash, så att inget sparas om läget hunnit ändras.
 */
const reason = z.string().trim().min(1).max(500);
const controlCode = z.number().int().min(1).max(9999);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const offsetSeconds = z.number().int().min(-86_400).max(86_400).refine((value) => value !== 0, "Ange en ändring");
const resultStatus = z.enum(["OK", "OVERTIME", "MP", "UNKNOWN_CARD"]);

/** Steg 45: ALL = alla enheter (start, mål och alla kontroller). */
export const raceCorrectionStationSchema = z.enum(["START", "FINISH", "CONTROL", "ALL"]);

export const raceCorrectionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ADD_TIME_ADJUSTMENT"), station: raceCorrectionStationSchema,
    controlCode: controlCode.optional(), offsetSeconds, reason }).strict()
    .refine((value) => (value.station === "CONTROL") === (value.controlCode !== undefined), { path: ["controlCode"] }),
  z.object({ action: z.literal("ADD_CONTROL_OUT_OF_ORDER"), controlCode, reason }).strict(),
  z.object({ action: z.literal("REMOVE"), correctionId: uuid }).strict(),
  z.object({ action: z.literal("SHIFT_START_TIMES"), classId: uuid, offsetSeconds, reason }).strict(),
  z.object({ action: z.literal("RECALCULATE_ALL") }).strict()
]);
export type RaceCorrectionAction = z.infer<typeof raceCorrectionActionSchema>;

export const raceCorrectionPreviewRequestSchema = z.object({ formatVersion: z.literal(1), correction: raceCorrectionActionSchema }).strict();

export const raceCorrectionCommitRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, expectedPreviewHash: hash, correction: raceCorrectionActionSchema
}).strict();

const changeSchema = z.object({
  entryId: uuid, displayName: z.string().min(1).max(321), className: z.string().min(1).max(160),
  before: resultStatus, after: resultStatus
}).strict();

const startTimesSchema = z.object({
  count: z.number().int().min(0),
  firstBefore: z.string().nullable(), firstAfter: z.string().nullable(),
  lastBefore: z.string().nullable(), lastAfter: z.string().nullable()
}).strict();

export const raceCorrectionSummarySchema = z.object({
  /** Löpare med avläsning som prövades. */
  readOutCount: z.number().int().min(0),
  /** Löpare vars tid eller status ändras. */
  affectedCount: z.number().int().min(0),
  /** Löpare med manuellt rättad tid som inte räknas om (rättningen ligger kvar). */
  notRecalculatedCount: z.number().int().min(0),
  changes: z.array(changeSchema).max(10_000),
  startTimes: startTimesSchema.optional()
}).strict();

export const raceCorrectionPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, previewHash: hash, correction: raceCorrectionActionSchema,
  summary: raceCorrectionSummarySchema
}).strict();
export type RaceCorrectionPreviewResponse = z.infer<typeof raceCorrectionPreviewResponseSchema>;

export const raceCorrectionCommitResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, requestId: uuid, replayed: z.boolean(), correction: raceCorrectionActionSchema,
  summary: raceCorrectionSummarySchema, recalculatedCount: z.number().int().min(0), appliedAt: z.iso.datetime({ offset: true })
}).strict();
export type RaceCorrectionCommitResponse = z.infer<typeof raceCorrectionCommitResponseSchema>;

export const raceCorrectionSchema = z.object({
  id: uuid, kind: z.enum(["TIME_ADJUSTMENT", "CONTROL_OUT_OF_ORDER"]), station: raceCorrectionStationSchema,
  controlCode: controlCode.nullable(), offsetMs: z.number().int().nullable(), reason,
  createdAt: z.iso.datetime({ offset: true }), removedAt: z.iso.datetime({ offset: true }).nullable()
}).strict();
export type RaceCorrection = z.infer<typeof raceCorrectionSchema>;

export const raceCorrectionListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, corrections: z.array(raceCorrectionSchema).max(1_000)
}).strict();
export type RaceCorrectionListResponse = z.infer<typeof raceCorrectionListResponseSchema>;
