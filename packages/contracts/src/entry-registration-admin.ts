import { z } from "zod";
import { eventTimeZoneSchema, fixedStartTimeSchema } from "./entry-start-time-admin";
import { newEntryCardNumberSchema } from "./entry-card-admin";
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
export const entryRegistrationAdminLoginRequestSchema = z.object({ formatVersion: z.literal(1),
  accessCredential: z.string().regex(/^otid_org_entry_registration_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();
export const entryRegistrationAdminLoginResponseSchema = z.object({ formatVersion: z.literal(1), raceId: uuid,
  capability: z.literal("REGISTER_ENTRY"), expiresAt: z.iso.datetime({ offset: true }) }).strict();
export const entryRegistrationClassesResponseSchema = z.object({ formatVersion: z.literal(1), raceId: uuid,
  snapshotVersion: version, timeZone: eventTimeZoneSchema, classes: z.array(z.object({ id: uuid, name: z.string().min(1).max(160),
    courseVersionId: uuid, startRule: z.enum(["FIXED", "PUNCH"]) }).strict()).max(1_000)
}).strict().refine((row) => new Set(row.classes.map((item) => item.id)).size === row.classes.length);
export const entryRegistrationRequestSchema = z.object({ formatVersion: z.literal(1),
  classId: uuid, expectedCourseVersionId: uuid, expectedStartRule: z.enum(["FIXED", "PUNCH"]), expectedSnapshotVersion: version,
  givenName: z.string().trim().min(1).max(160), familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(200).nullable(), cardNumber: newEntryCardNumberSchema.nullable(),
  // Fast start utan tid: klassen är lottad och appen ger första lediga tid (PLAN.md steg 9).
  fixedStartTime: fixedStartTimeSchema.nullable()
}).strict().refine((row) => row.expectedStartRule === "FIXED" || row.fixedStartTime === null);
export const entryRegistrationIdempotencyKeySchema = z.string().regex(
  /^entry-registration:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const entryRegistrationResponseSchema = z.object({ formatVersion: z.literal(1), replayed: z.boolean(),
  requestId: uuid, raceId: uuid, entryId: uuid, entryVersion: z.literal(1), classId: uuid,
  givenName: z.string().min(1).max(160), familyName: z.string().min(1).max(160),
  organisationName: z.string().min(1).max(200).nullable(), cardNumber: newEntryCardNumberSchema.nullable(),
  assignmentId: uuid.nullable(), fixedStartTime: fixedStartTimeSchema.nullable(),
  /** Tiden gavs av appen från klassens lottning. */
  startTimeAssigned: z.boolean(),
  snapshotVersionBefore: version, snapshotVersionAfter: version, createdAt: z.iso.datetime({ offset: true })
}).strict().refine((row) => row.snapshotVersionAfter === row.snapshotVersionBefore + 1 &&
  (row.cardNumber === null) === (row.assignmentId === null) && (!row.startTimeAssigned || row.fixedStartTime !== null));
export { entryClassAdminErrorResponseSchema as entryRegistrationAdminErrorResponseSchema } from "./entry-class-admin";
export type EntryRegistrationAdminLoginRequest = z.infer<typeof entryRegistrationAdminLoginRequestSchema>;
export type EntryRegistrationClassesResponse = z.infer<typeof entryRegistrationClassesResponseSchema>;
export type EntryRegistrationRequest = z.infer<typeof entryRegistrationRequestSchema>;
export type EntryRegistrationResponse = z.infer<typeof entryRegistrationResponseSchema>;

export const entryRegistrationCandidatesRequestSchema = z.object({
  formatVersion: z.literal(1), expectedSnapshotVersion: version,
  givenName: z.string().trim().min(1).max(160),
  familyName: z.string().trim().min(1).max(160),
  cardNumber: newEntryCardNumberSchema.nullable()
}).strict();
export const entryRegistrationCandidateSchema = z.object({
  entryId: uuid, classId: uuid, className: z.string().min(1).max(160),
  givenName: z.string().min(1).max(160), familyName: z.string().min(1).max(160),
  organisationName: z.string().min(1).max(240).nullable(),
  reasons: z.array(z.enum(["SAME_NAME", "CARD_ALREADY_ASSIGNED"])).min(1).max(2)
    .refine((values) => new Set(values).size === values.length)
}).strict();
export const entryRegistrationCandidatesResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version,
  totalMatches: z.number().int().min(0).max(10_000),
  candidates: z.array(entryRegistrationCandidateSchema).max(20)
}).strict().refine((row) => row.candidates.length === Math.min(row.totalMatches, 20) &&
  new Set(row.candidates.map((candidate) => candidate.entryId)).size === row.candidates.length);
export type EntryRegistrationCandidatesRequest = z.infer<typeof entryRegistrationCandidatesRequestSchema>;
export type EntryRegistrationCandidate = z.infer<typeof entryRegistrationCandidateSchema>;
export type EntryRegistrationCandidatesResponse = z.infer<typeof entryRegistrationCandidatesResponseSchema>;
