import { z } from "zod";
import { eventTimeZoneSchema, fixedStartTimeSchema } from "./entry-start-time-admin";
import { newEntryCardNumberSchema } from "./entry-card-admin";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";
const version = z.number().int().positive().max(2_147_483_647);
export const entryRegistrationClassesResponseSchema = z.object({ formatVersion: z.literal(1), raceId: uuid,
  snapshotVersion: version, timeZone: eventTimeZoneSchema, classes: z.array(z.object({ id: uuid, name: z.string().min(1).max(160),
    courseVersionId: uuid, startRule: z.enum(["FIXED", "PUNCH"]) }).strict()).max(1_000)
}).strict().refine((row) => new Set(row.classes.map((item) => item.id)).size === row.classes.length);
export const entryRegistrationRequestSchema = z.object({ formatVersion: z.literal(1),
  classId: uuid, expectedCourseVersionId: uuid, expectedStartRule: z.enum(["FIXED", "PUNCH"]),   givenName: z.string().trim().min(1).max(160), familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(200).nullable(), cardNumber: newEntryCardNumberSchema.nullable(),
  // Minutstart utan tid: en lottad klass ger första lediga tid (PLAN.md steg 9), annars ges tiden vid lottningen (steg 24).
  fixedStartTime: fixedStartTimeSchema.nullable()
}).strict().refine((row) => row.expectedStartRule === "FIXED" || row.fixedStartTime === null);
export const entryRegistrationIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("entry-registration"));
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
export type EntryRegistrationClassesResponse = z.infer<typeof entryRegistrationClassesResponseSchema>;
export type EntryRegistrationRequest = z.infer<typeof entryRegistrationRequestSchema>;
export type EntryRegistrationResponse = z.infer<typeof entryRegistrationResponseSchema>;

export const entryRegistrationCandidatesRequestSchema = z.object({
  formatVersion: z.literal(1),   givenName: z.string().trim().min(1).max(160),
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
