import { z } from "zod";
import { eventorExternalIdSchema, eventorProfileSchema } from "./eventor-import";

const canonicalUuid = z.string().length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const hash = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const safeName = z.string().min(2).max(160).refine((value) =>
  [...value].every((character) => {
    const code = character.codePointAt(0)!;
    return code >= 32 && !(code >= 127 && code <= 159) && !(code >= 0xd800 && code <= 0xdfff);
  }) && value.trim() === value
);

export const eventorEntryImportPreviewRequestSchema = z.object({
  formatVersion: z.literal(1),
  grantId: canonicalUuid,
}).strict();

export const eventorEntryImportSourceClassSchema = z.object({
  externalClassId: eventorExternalIdSchema,
  name: safeName,
  entryCount: z.number().int().min(0).max(10_000),
}).strict();

export const eventorEntryImportTargetClassSchema = z.object({
  classId: canonicalUuid,
  name: safeName,
}).strict();

export const eventorEntryImportPreviewResponseSchema = z.object({
  formatVersion: z.literal(2),
  grantId: canonicalUuid,
  environment: eventorProfileSchema,
  eventClassesSourceHash: hash,
  entriesSourceHash: hash,
  entriesCount: z.number().int().min(0).max(10_000),
  sourceClasses: z.array(eventorEntryImportSourceClassSchema).max(500),
  targetClasses: z.array(eventorEntryImportTargetClassSchema).max(500)
}).strict().refine((value) =>
  value.entriesCount === value.sourceClasses.reduce((total, sourceClass) => total + sourceClass.entryCount, 0) &&
  new Set(value.sourceClasses.map((sourceClass) => sourceClass.externalClassId)).size === value.sourceClasses.length &&
  new Set(value.targetClasses.map((targetClass) => targetClass.classId)).size === value.targetClasses.length
);

export const eventorEntryImportClassMappingSchema = z.object({
  externalClassId: eventorExternalIdSchema,
  classId: canonicalUuid,
}).strict();

export const eventorEntryImportCommitRequestSchema = z.object({
  formatVersion: z.literal(1),
  grantId: canonicalUuid,
  eventClassesSourceHash: hash,
  entriesSourceHash: hash,
  mappings: z.array(eventorEntryImportClassMappingSchema).min(1).max(500)
}).strict().refine((value) =>
  new Set(value.mappings.map((mapping) => mapping.externalClassId)).size === value.mappings.length &&
  new Set(value.mappings.map((mapping) => mapping.classId)).size === value.mappings.length
);

export const eventorEntryImportIdempotencyKeySchema = z.string().length(21 + 36)
  .regex(/^eventor-entry-import:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const eventorEntryImportResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuid,
  raceId: canonicalUuid,
  grantId: canonicalUuid,
  eventClassesSourceHash: hash,
  entriesSourceHash: hash,
  entriesSeen: z.number().int().min(0).max(10_000),
  entriesCreated: z.number().int().min(0).max(10_000),
  entriesUnchanged: z.number().int().min(0).max(10_000),
  snapshotVersionBefore: z.number().int().positive(),
  snapshotVersionAfter: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
}).strict().refine((value) =>
  value.entriesCreated + value.entriesUnchanged === value.entriesSeen &&
  value.snapshotVersionAfter === value.snapshotVersionBefore + (value.entriesCreated > 0 ? 1 : 0)
);

export const eventorEntryImportErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: z.enum(["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "CONFLICT", "SOURCE_UNAVAILABLE", "INTERNAL_ERROR"]),
}).strict();

export type EventorEntryImportPreviewRequest = z.infer<typeof eventorEntryImportPreviewRequestSchema>;
export type EventorEntryImportPreviewResponse = z.infer<typeof eventorEntryImportPreviewResponseSchema>;
export type EventorEntryImportCommitRequest = z.infer<typeof eventorEntryImportCommitRequestSchema>;
export type EventorEntryImportResponse = z.infer<typeof eventorEntryImportResponseSchema>;
