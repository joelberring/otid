import { z } from "zod";
export * from "./administrator-effective-result";
export * from "./manual-course-class";
export * from "./manual-class";
export * from "./manual-class-name";
export * from "./manual-course-version-class-relink";
export * from "./manual-course-result-impact";
export * from "./manual-course-result-bearing-relink";
export * from "./course-edit";
export * from "./source-sync";
export * from "./course-variant-assignment";
export * from "./class-edit";
export * from "./shortened-course-class-transfer";
export * from "./manual-finish-time-correction";
export * from "./manual-finish-time-correction-withdrawal";
export * from "./manual-punch-start-time-correction";
export * from "./manual-punch-start-time-correction-withdrawal";
export * from "./unknown-readout-resolution";

export * from "./canonical-json";
export * from "./did-not-start-admin";
export * from "./did-not-finish-admin";
export * from "./did-not-finish-withdrawal-admin";
export * from "./did-not-start-withdrawal-admin";
export * from "./entry-class-admin";
export * from "./entry-start-time-admin";
export * from "./entry-card-admin";
export * from "./entry-card-rental-admin";
export * from "./entry-card-rental-return-admin";
export * from "./entry-card-rental-reuse-admin";
export * from "./entry-payment-status-admin";
export * from "./entry-registration-admin";
export * from "./event-creation";
export * from "./account";
export * from "./organizer-account";
export * from "./superadmin";
export * from "./race-people";
export * from "./race-publication";
export * from "./iof-import-admin";
export * from "./iof-result-list-export";
export * from "./local-station-evaluation";
export * from "./out-of-competition-admin";
export * from "./out-of-competition-withdrawal-admin";
export * from "./without-timing-admin";
export * from "./without-timing-withdrawal-admin";
export * from "./pm-document";
export * from "./pm-object-manifest";
export * from "./pm-scan-evidence";
export * from "./pm-document-storage-receipt";
export * from "./public-frozen-race-results";
export * from "./public-results";
export * from "./public-result-event-stream";
export * from "./race-overview-admin";
export * from "./readout-result-history-admin";
export * from "./result-recalculation-admin";
export * from "./class-result-recalculation";
export * from "./class-control-neutralization";
export * from "./result-finalization-admin";
export * from "./result-approval-admin";
export * from "./result-approval-withdrawal-admin";
export * from "./result-disqualification-admin";
export * from "./result-disqualification-withdrawal-admin";
export * from "./result-outcome";
export * from "./readout-package";
export * from "./start-list-admin";
export * from "./start-list-publication";
export * from "./start-checkin";

export const createEventSchema = z.object({
  name: z.string().trim().min(2).max(160),
  raceName: z.string().trim().min(2).max(160),
  raceDate: z.iso.date(),
  timeZone: z.string().trim().min(1).default("Europe/Stockholm")
});

const readoutPunchesSchema = z.array(z.object({
  code: z.number().int().positive(),
  punchedAt: z.iso.datetime({ offset: true })
}).strict()).max(256);

export const simulatorPayloadSchema = z.object({
  cardNumber: z.string().trim().min(1).max(32),
  startPunchedAt: z.iso.datetime({ offset: true }).optional(),
  finishPunchedAt: z.iso.datetime({ offset: true }),
  punches: readoutPunchesSchema
}).strict();

/**
 * En avläsning från en SPORTident-station (steg 4, ADR-0168). Tiderna är redan
 * tolkade i tävlingens tidszon; de råa ramarna sparas oförändrade som hex.
 */
export const sportidentReadoutPayloadSchema = z.object({
  cardNumber: z.string().regex(/^[1-9][0-9]{0,8}$/),
  cardType: z.enum(["SI5", "SI6", "SI8", "SI9", "SI10", "SI11", "SIAC", "pCard"]),
  startPunchedAt: z.iso.datetime({ offset: true }).optional(),
  finishPunchedAt: z.iso.datetime({ offset: true }).optional(),
  checkPunchedAt: z.iso.datetime({ offset: true }).optional(),
  clearPunchedAt: z.iso.datetime({ offset: true }).optional(),
  punches: readoutPunchesSchema,
  untimedPunchCodes: z.array(z.number().int().positive()).max(6),
  frames: z.array(z.string().regex(/^(?:[0-9a-f]{2}){1,300}$/)).min(1).max(8),
  stationSerial: z.number().int().nonnegative().optional(),
  /** Sant när avläsningen kom från den falska övningsstationen. */
  simulated: z.boolean()
}).strict();

export type SportidentReadoutPayload = z.infer<typeof sportidentReadoutPayloadSchema>;

const localSequenceSchema = z.number().int().positive();
const stationReceivedAtSchema = z.iso.datetime({ offset: true });
const eventContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

// Nyckelordningen (sekvens, tid, transport, nyttolast, hash) är en del av det
// serialiserade formatet och får inte ändras.
export const deviceEventSchema = z.discriminatedUnion("transport", [
  z.object({ localSequence: localSequenceSchema, stationReceivedAt: stationReceivedAtSchema,
    transport: z.literal("simulator"), payload: simulatorPayloadSchema, contentHash: eventContentHashSchema }).strict(),
  z.object({ localSequence: localSequenceSchema, stationReceivedAt: stationReceivedAtSchema,
    transport: z.literal("sportident"), payload: sportidentReadoutPayloadSchema, contentHash: eventContentHashSchema }).strict()
]);

export const deviceBatchSchema = z.object({
  deviceId: z.uuid(),
  sessionId: z.uuid(),
  packageVersion: z.number().int().positive(),
  firstSequence: z.number().int().positive(),
  lastSequence: z.number().int().positive(),
  events: z.array(deviceEventSchema).min(1).max(100)
}).strict().superRefine((batch, context) => {
  const sequences = batch.events.map((event) => event.localSequence);
  if (Math.min(...sequences) !== batch.firstSequence || Math.max(...sequences) !== batch.lastSequence) {
    context.addIssue({ code: "custom", message: "Sekvensintervallet matchar inte händelserna" });
  }
  if (new Set(sequences).size !== sequences.length) {
    context.addIssue({ code: "custom", message: "Batchen innehåller dubbla sekvenser" });
  }
  if (batch.events.some((event, index) => event.localSequence !== batch.firstSequence + index) ||
      batch.lastSequence !== batch.firstSequence + batch.events.length - 1) {
    context.addIssue({
      code: "custom",
      message: "Batchens händelser måste bilda ett sammanhängande stigande sekvensintervall"
    });
  }
});

export const evaluationStatusSchema = z.enum(["OK", "MP", "UNKNOWN_CARD"]);
export const evaluationReasonSchema = z.enum([
  "COMPLETE",
  "UNKNOWN_CARD",
  "MISSING_START",
  "MISSING_FINISH",
  "MISSING_CONTROL",
  "WRONG_ORDER",
  "INVALID_TIME_ORDER"
]);

const serverResultVersionFields = {
  engineVersion: z.string().trim().min(1),
  snapshotVersion: z.number().int().positive(),
  evaluationHash: z.string().regex(/^[a-f0-9]{64}$/)
};

const persistedServerResultFields = {
  resultRevisionId: z.uuid(),
  revision: z.number().int().positive(),
  courseVersionId: z.uuid(),
  ...serverResultVersionFields
};

export const serverResultSummarySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("UNKNOWN_CARD"),
    reason: z.literal("UNKNOWN_CARD"),
    ...serverResultVersionFields
  }).strict(),
  z.object({
    status: z.literal("OK"),
    reason: z.literal("COMPLETE"),
    ...persistedServerResultFields
  }).strict(),
  z.object({
    status: z.literal("MP"),
    reason: z.enum([
      "MISSING_START",
      "MISSING_FINISH",
      "MISSING_CONTROL",
      "WRONG_ORDER",
      "INVALID_TIME_ORDER"
    ]),
    ...persistedServerResultFields
  }).strict()
]);

const acknowledgedDeviceEventSchema = z.object({
  localSequence: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  rawMessageId: z.uuid(),
  serverResult: serverResultSummarySchema.optional()
}).strict();

export const deviceEventAcknowledgementSchema = z.discriminatedUnion("status", [
  acknowledgedDeviceEventSchema.extend({ status: z.literal("stored") }),
  acknowledgedDeviceEventSchema.extend({ status: z.literal("duplicate") }),
  z.object({
    localSequence: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal("rejected"),
    reason: z.enum([
      "CONTENT_HASH_MISMATCH",
      "SEQUENCE_HASH_CONFLICT",
      "SEQUENCE_CONTEXT_CONFLICT"
    ])
  }).strict()
]);

export const deviceBatchAcknowledgementSchema = z.object({
  deviceId: z.uuid(),
  highestContiguousSequence: z.number().int().nonnegative(),
  currentPackageVersion: z.number().int().positive(),
  packageVersionStatus: z.enum(["current", "stale", "ahead"]),
  packageUpdateRequired: z.boolean(),
  acknowledgements: z.array(deviceEventAcknowledgementSchema).min(1).max(100)
}).strict().superRefine((acknowledgement, context) => {
  if (acknowledgement.packageUpdateRequired !== (acknowledgement.packageVersionStatus === "stale")) {
    context.addIssue({
      code: "custom",
      message: "Paketuppdatering får endast krävas för en stale paketversion"
    });
  }
  const sequences = acknowledgement.acknowledgements.map((event) => event.localSequence);
  if (new Set(sequences).size !== sequences.length) {
    context.addIssue({
      code: "custom",
      message: "Kvittensen innehåller flera besked för samma lokala sekvens"
    });
  }
  if (sequences.some((sequence, index) => index > 0 && sequence <= sequences[index - 1]!)) {
    context.addIssue({
      code: "custom",
      message: "Kvittensbeskeden måste ligga i stigande sekvensordning"
    });
  }
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type SimulatorPayload = z.infer<typeof simulatorPayloadSchema>;
export type DeviceBatch = z.infer<typeof deviceBatchSchema>;
export type ServerResultSummary = z.infer<typeof serverResultSummarySchema>;
export type DeviceEventAcknowledgement = z.infer<typeof deviceEventAcknowledgementSchema>;
export type DeviceBatchAcknowledgement = z.infer<typeof deviceBatchAcknowledgementSchema>;
export * from "./start-draw";
export * from "./class-start-rule-change";
export * from "./start-checkin-roster";
export * from "./start-checkin-conflict-review";
export * from "./speaker-board";
export * from "./pm-document-reservation";
export * from "./entry-readout-history";
export * from "./entry-identity-admin";
export * from "./race-administrator";
export * from "./entry-transfer";
export * from "./class-capacity";
export * from "./administrator-entry-changes";
export * from "./administrator-return";
export * from "./checkin-history";
export * from "./administrator-forest-watch";
export * from "./relay";
export * from "./race-settings";
export * from "./rogaining";
export * from "./race-map";
export * from "./radio";
