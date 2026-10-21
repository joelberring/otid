import { z } from "zod";
import { UUID_PATTERN, prefixedUuidPattern } from "./ids";

/**
 * Ett statusflöde (ADR-0173 beslut 1): arrangörens beslut om en löpare. Samma kontrakt för ej start, brutit, disk,
 * utom tävlan, utan tidtagning, manuellt godkännande, ändrad mål- eller starttid och återtagande av beslutet.
 */
const uuid = z.string().regex(UUID_PATTERN,
  "Id måste vara ett kanoniskt gemener-UUID");
const revisionNumber = z.number().int().min(0).max(2_147_483_647);
const instant = z.iso.datetime({ offset: true });
/** Arrangörens orsak till ett manuellt beslut (steg 31), t.ex. "glömde stämpla mål". */
const note = z.string().trim().min(1).max(500);

export const entryStatusDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DID_NOT_START") }).strict(),
  z.object({ kind: z.literal("DID_NOT_FINISH"), note: note.optional() }).strict(),
  z.object({ kind: z.literal("DISQUALIFIED"), reason: z.string().trim().min(1).max(240).optional() }).strict(),
  z.object({ kind: z.literal("OUT_OF_COMPETITION") }).strict(),
  z.object({ kind: z.literal("WITHOUT_TIMING") }).strict(),
  z.object({ kind: z.literal("APPROVE_MANUALLY"), note: note.optional() }).strict(),
  z.object({ kind: z.literal("FINISH_TIME"), finishTime: instant }).strict(),
  z.object({ kind: z.literal("START_TIME"), startTime: instant }).strict(),
  /** Steg 31: manuell tid (måltid, starttid eller löptid) med status och orsak, med eller utan avläsning. */
  z.object({ kind: z.literal("MANUAL_TIME"), startTime: instant.optional(), finishTime: instant.optional(),
    elapsedMs: z.number().int().positive().max(86_400_000).optional(), status: z.enum(["OK", "MP"]), note }).strict()
    .refine((value) => value.finishTime !== undefined || value.elapsedMs !== undefined, "Måltid eller löptid krävs"),
  /** Steg 31: godkänn valda saknade kontroller med orsak. */
  z.object({ kind: z.literal("APPROVE_CONTROLS"), controls: z.array(z.number().int().positive().max(9_999)).min(1).max(100),
    note }).strict(),
  /** Steg 38: felstämplingen är kontrollerad, med valfri orsak. */
  z.object({ kind: z.literal("CONFIRM_MISPUNCH"), note: note.optional() }).strict(),
  z.object({ kind: z.literal("WITHDRAW") }).strict()
]);
export const entryStatusDecisionKinds = ["DID_NOT_START", "DID_NOT_FINISH", "DISQUALIFIED", "OUT_OF_COMPETITION",
  "WITHOUT_TIMING", "APPROVE_MANUALLY", "FINISH_TIME", "START_TIME", "MANUAL_TIME", "APPROVE_CONTROLS", "CONFIRM_MISPUNCH",
  "WITHDRAW"] as const;

export const entryStatusRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  /** Löparens senaste revision när arrangören öppnade beslutet (0 utan resultat). */
  expectedRevision: revisionNumber,
  decision: entryStatusDecisionSchema
}).strict();

export const entryStatusIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("entry-status"),
  "Idempotency-Key måste vara entry-status:<request-id>");

const statusSchema = z.enum(["OK", "OVERTIME", "MP", "DSQ", "DNF", "OOC", "DNS", "NT"]);
export const entryStatusGoverningDecisionSchema = z.enum(["NONE", "DNS", "CHECKIN_DNS", "DSQ", "APPROVAL", "DNF", "OOC",
  "NT", "FINISH_TIME", "START_TIME", "MANUAL_TIME", "CONTROL_APPROVAL", "MP_CONFIRMED"]);
export const entryStatusReadinessSchema = z.enum(["READY", "HAS_RESULT", "NO_ACTIVE_RESULT", "UNSUPPORTED_RESULT",
  "STALE_RESULT", "NOT_PUNCH_START", "NO_ACTIVE_DECISION", "INVALID_TIME", "INVALID_CONTROL", "ACTIVE_DID_NOT_START",
  "ACTIVE_DISQUALIFICATION", "ACTIVE_APPROVAL", "ACTIVE_DID_NOT_FINISH", "ACTIVE_OUT_OF_COMPETITION", "ACTIVE_WITHOUT_TIMING",
  "ACTIVE_MANUAL_TIME", "ACTIVE_MISPUNCH_CONFIRMATION"]);

const splitSchema = z.object({ controlCode: z.number().int().positive(), occurrence: z.number().int().positive(),
  elapsedMs: z.number().int().min(0), legMs: z.number().int().min(0) }).strict();
/** Tiderna i det resultat som en tidsrättning utgår från (eller som ett återtagande återställer). */
const timingSchema = z.object({ status: z.enum(["OK", "OVERTIME", "MP"]), startTime: instant, finishTime: instant,
  elapsedMs: z.number().int().positive(), latestMatchedSplitElapsedMs: z.number().int().min(0).nullable(),
  splits: z.array(splitSchema).max(1_000) }).strict();

/** Läget för en löpare: senaste revisionen, beslutet som gäller och vilka beslut som går att fatta. */
export const entryStatusResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  entryId: uuid,
  entryName: z.string().min(1).max(321),
  className: z.string().min(1).max(160),
  headRevision: revisionNumber,
  governingDecision: entryStatusGoverningDecisionSchema,
  noActiveResult: z.boolean(),
  readiness: z.record(z.enum(entryStatusDecisionKinds), entryStatusReadinessSchema),
  /** Status efter ett återtagande; null när inget resultat finns kvar (ej start tas bort). */
  withdrawRestores: z.object({ status: statusSchema }).strict().nullable(),
  timing: timingSchema.nullable(),
  withdrawTiming: timingSchema.nullable(),
  /** Steg 31: underlaget för "Ange tid manuellt": känd start, avläsningens målstämpling och om avläsning finns. */
  manualTime: z.object({ knownStartTime: instant.nullable(), readoutFinishTime: instant.nullable(), hasReadout: z.boolean() }).strict(),
  /** Steg 31: saknade kontroller som kan godkännas en och en (tom när det inte går). */
  approvableControls: z.array(z.number().int().positive()).max(1_000)
}).strict();

export const entryStatusReceiptSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuid,
  raceId: uuid,
  entryId: uuid,
  resultRevisionId: uuid,
  revision: revisionNumber,
  cause: z.string().min(1).max(80),
  status: statusSchema,
  reason: z.string().min(1).max(80),
  decidedAt: instant
}).strict();

/** 409: beslutet gällde inte längre löparens senaste revision eller kan inte fattas. */
export const entryStatusConflictSchema = z.object({
  formatVersion: z.literal(1),
  error: z.literal("CONFLICT"),
  headRevision: revisionNumber,
  readiness: entryStatusReadinessSchema
}).strict();

export type EntryStatusDecision = z.infer<typeof entryStatusDecisionSchema>;
export type EntryStatusRequest = z.infer<typeof entryStatusRequestSchema>;
export type EntryStatusResponse = z.infer<typeof entryStatusResponseSchema>;
export type EntryStatusReceipt = z.infer<typeof entryStatusReceiptSchema>;
export type EntryStatusConflict = z.infer<typeof entryStatusConflictSchema>;
export type EntryStatusReadiness = z.infer<typeof entryStatusReadinessSchema>;
export type EntryStatusGoverningDecision = z.infer<typeof entryStatusGoverningDecisionSchema>;
