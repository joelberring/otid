import { z } from "zod";
import { courseEditChangeSchema } from "./course-edit";

/**
 * ADR-0170 beslut 4: Eventor och banfiler, även uppdateringar. Källan läses, skillnaderna
 * visas (nya, ändrade, strukna) och administratören godkänner dem. Ändringar som påverkar
 * resultat får samma besked och omräkning som "Redigera bana".
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().nonnegative().max(100_000);
const instant = z.iso.datetime();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const externalId = z.string().min(1).max(64);
const text = z.string().min(1).max(400);

export const eventorEventFormSchema = z.enum(["INDIVIDUAL", "RELAY", "OTHER"]);
export const eventorEventSummarySchema = z.object({ id: externalId, name: text, date, form: eventorEventFormSchema }).strict();
const organisation = z.object({ id: externalId, name: text }).strict();

/** Läget för tävlingens Eventor-koppling. Nyckeln visas aldrig, bara att den finns. */
export const eventorSettingsResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  /** Driftens masternyckel: saknas (Eventor inte konfigurerat), felaktig eller ok. */
  server: z.enum(["MISSING", "INVALID", "OK"]),
  key: z.enum(["NONE", "SAVED", "UNREADABLE"]),
  organisation: organisation.nullable(),
  event: eventorEventSummarySchema.nullable(),
  lastAppliedAt: instant.nullable()
}).strict();

export const eventorKeyRequestSchema = z.object({
  formatVersion: z.literal(1), apiKey: z.string().trim().regex(/^[\x21-\x7e]{16,128}$/)
}).strict();

/** Resultatet av att testa anslutningen (efter att nyckeln sparats eller med "Testa anslutningen"). */
export const eventorConnectionOutcomeSchema = z.enum(["CONNECTED", "REJECTED", "UNAVAILABLE", "NOT_CONFIGURED", "NO_KEY", "KEY_UNREADABLE"]);
export const eventorTestResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, outcome: eventorConnectionOutcomeSchema, settings: eventorSettingsResponseSchema
}).strict();

export const eventorEventsResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, outcome: eventorConnectionOutcomeSchema,
  events: z.array(eventorEventSummarySchema).max(2_000)
}).strict();

export const eventorEventChoiceRequestSchema = z.object({
  formatVersion: z.literal(1), eventId: z.string().trim().regex(/^[0-9]{1,12}$/)
}).strict();
export const eventorEventChoiceResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, outcome: z.union([eventorConnectionOutcomeSchema, z.literal("NOT_FOUND")]),
  settings: eventorSettingsResponseSchema
}).strict();

export const sourceKindSchema = z.enum(["EVENTOR", "COURSE_FILE"]);
export const syncFieldSchema = z.enum(["NAME", "CLUB", "CLASS", "CARD", "COURSE", "CONTROLS", "VARIANTS", "TEAM_NAME", "CLASS_NAME", "LEGS"]);
/** Varför en rad inte kan godkännas här, eller vad den innebär. Texterna finns i i18n. */
export const syncNoteSchema = z.enum([
  "WITHDRAWN_READ_OUT", "WITHDRAWN_HAS_RESULT", "CARD_IN_USE", "CARD_AFTER_READOUT", "TEAM_CLASS_CHANGED", "RELAY_CLASS_MISMATCH",
  "CLASS_CANCELLED", "NOT_IN_FILE", "COURSE_IN_USE"
]);

export const syncRowSchema = z.object({
  /** Kort, stabilt id för raden (samma källa och samma läge ger samma id). */
  id: z.string().regex(/^r[a-f0-9]{12}$/),
  kind: z.enum(["NEW", "CHANGED", "WITHDRAWN", "CONFLICT"]),
  subject: z.enum(["CLASS", "ENTRY", "TEAM", "COURSE"]),
  label: text,
  context: z.string().max(400).nullable(),
  changes: z.array(z.object({ field: syncFieldSchema, from: z.string().max(4_000).nullable(), to: z.string().max(4_000).nullable() }).strict()).max(20),
  /** Matchad på namn, klubb och klass (inte på Eventors id): visas för granskning. */
  matchedByName: z.boolean(),
  readOut: z.boolean(),
  /** Kan bockas ur. Nya klasser och banor skapas alltid när något som behöver dem godkänns. */
  optional: z.boolean(),
  note: syncNoteSchema.nullable()
}).strict();

export const syncConsequenceSchema = z.object({
  readOutCount: count, becomesOkCount: count, becomesMispunchedCount: count, unchangedCount: count, notRecalculatedCount: count,
  changes: z.array(courseEditChangeSchema).max(10_000),
  /** Löpare som läst ut och får ny bricka: resultatet behålls (löparen sprang med den avlästa brickan). */
  cardsAfterReadout: z.array(z.object({ displayName: z.string().min(1).max(400), cardNumber: z.string().max(16) }).strict()).max(10_000),
  requiresConfirmation: z.boolean()
}).strict();

export const syncPreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, source: sourceKindSchema, snapshotId: uuid, snapshotVersion: version,
  fetchedAt: instant, sourceName: text, rows: z.array(syncRowSchema).max(20_000),
  summary: z.object({ new: count, changed: count, withdrawn: count, conflicts: count, unchanged: count }).strict(),
  consequence: syncConsequenceSchema
}).strict();

/** Eventor kunde inte läsas: läget i stället för skillnader. */
export const eventorSyncProblemSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  problem: z.enum(["NOT_CONFIGURED", "NO_KEY", "KEY_UNREADABLE", "NO_EVENT", "REJECTED", "UNAVAILABLE", "NOT_FOUND"])
}).strict();

/** Urvalet anges som de rader som bockats ur (oftast få), så att begäran hålls liten. */
const excluded = z.array(z.string().regex(/^r[a-f0-9]{12}$/)).max(200);
export const syncConsequenceRequestSchema = z.object({
  formatVersion: z.literal(1), snapshotId: uuid, expectedSnapshotVersion: version, excludedRowIds: excluded
}).strict();
export const syncConsequenceResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotId: uuid, snapshotVersion: version, consequence: syncConsequenceSchema
}).strict();

export const syncApplyRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, snapshotId: uuid, expectedSnapshotVersion: version, excludedRowIds: excluded,
  confirmResultChanges: z.boolean()
}).strict();
export const syncApplyIdempotencyKeySchema = z.string().regex(/^source-sync:[0-9a-f-]{36}$/);
export const syncApplyResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, source: sourceKindSchema, snapshotId: uuid,
  request: syncApplyRequestSchema, appliedRows: count, recalculatedCount: count, snapshotVersionAfter: version, appliedAt: instant
}).strict();

/** När varje källa senast lästes in (godkändes). */
export const sourceSyncStatusSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  courseFile: z.object({ fileName: z.string().max(260).nullable(), appliedAt: instant }).strict().nullable()
}).strict();

export type EventorSettingsResponse = z.infer<typeof eventorSettingsResponseSchema>;
export type EventorConnectionOutcome = z.infer<typeof eventorConnectionOutcomeSchema>;
export type EventorTestResponse = z.infer<typeof eventorTestResponseSchema>;
export type EventorEventsResponse = z.infer<typeof eventorEventsResponseSchema>;
export type EventorEventChoiceResponse = z.infer<typeof eventorEventChoiceResponseSchema>;
export type EventorEventSummary = z.infer<typeof eventorEventSummarySchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type SyncRow = z.infer<typeof syncRowSchema>;
export type SyncField = z.infer<typeof syncFieldSchema>;
export type SyncNote = z.infer<typeof syncNoteSchema>;
export type SyncConsequence = z.infer<typeof syncConsequenceSchema>;
export type SyncPreviewResponse = z.infer<typeof syncPreviewResponseSchema>;
export type EventorSyncProblem = z.infer<typeof eventorSyncProblemSchema>;
export type SyncConsequenceResponse = z.infer<typeof syncConsequenceResponseSchema>;
export type SyncApplyRequest = z.infer<typeof syncApplyRequestSchema>;
export type SyncApplyResponse = z.infer<typeof syncApplyResponseSchema>;
export type SourceSyncStatus = z.infer<typeof sourceSyncStatusSchema>;
