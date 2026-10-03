import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const positiveVersionSchema = z.number().int().positive();

export const entryClassAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_entry_class_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const entryClassAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("CHANGE_ENTRY_CLASS"),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();

const entryClassAdminClassSchema = z.object({
  id: canonicalUuidSchema,
  name: z.string().trim().min(1).max(160)
}).strict();

const entryClassAdminEntrySchema = z.object({
  id: canonicalUuidSchema,
  displayName: z.string().trim().min(1).max(321),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  classId: canonicalUuidSchema,
  version: positiveVersionSchema
}).strict();

export const entryClassAdminListResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: positiveVersionSchema,
  classes: z.array(entryClassAdminClassSchema),
  entries: z.array(entryClassAdminEntrySchema)
}).strict().superRefine((response, context) => {
  const classIds = new Set(response.classes.map((raceClass) => raceClass.id));
  if (classIds.size !== response.classes.length) {
    context.addIssue({ code: "custom", path: ["classes"], message: "Klass-id måste vara unika" });
  }
  const entryIds = new Set(response.entries.map((entry) => entry.id));
  if (entryIds.size !== response.entries.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Deltagar-id måste vara unika" });
  }
  for (const [index, entry] of response.entries.entries()) {
    if (!classIds.has(entry.classId)) {
      context.addIssue({
        code: "custom",
        path: ["entries", index, "classId"],
        message: "Deltagarens klass saknas i klasslistan"
      });
    }
  }
});

export const entryClassChangeRequestSchema = z.object({
  formatVersion: z.literal(1),
  classId: canonicalUuidSchema,
  expectedEntryVersion: positiveVersionSchema
}).strict();

export const entryClassChangeIdempotencyKeySchema = z.string().regex(
  /^entry-class-change:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara entry-class-change:<kanoniskt request-uuid>"
);

export const entryClassChangeResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  entryId: canonicalUuidSchema,
  previousClassId: canonicalUuidSchema,
  classId: canonicalUuidSchema,
  entryVersionBefore: positiveVersionSchema,
  entryVersionAfter: positiveVersionSchema,
  snapshotVersionBefore: positiveVersionSchema,
  snapshotVersionAfter: positiveVersionSchema,
  changedAt: z.iso.datetime({ offset: true })
}).strict().superRefine((response, context) => {
  if (response.previousClassId === response.classId) {
    context.addIssue({ code: "custom", path: ["classId"], message: "Klassen måste ändras" });
  }
  if (response.entryVersionAfter !== response.entryVersionBefore + 1) {
    context.addIssue({ code: "custom", path: ["entryVersionAfter"], message: "Deltagarversionen måste öka ett" });
  }
  if (response.snapshotVersionAfter !== response.snapshotVersionBefore + 1) {
    context.addIssue({ code: "custom", path: ["snapshotVersionAfter"], message: "Snapshotversionen måste öka ett" });
  }
});

export const entryClassAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const entryClassAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: entryClassAdminErrorCodeSchema
}).strict();

// Tillfällig exportkompatibilitet medan den gamla PATCH-routen ersätts. Den
// pekar på det nya strikta kontraktet och låter därför inte den gamla bodyn
// `{classId}` mutera något.
export const changeEntryClassSchema = entryClassChangeRequestSchema;

export type EntryClassAdminLoginRequest = z.infer<typeof entryClassAdminLoginRequestSchema>;
export type EntryClassAdminLoginResponse = z.infer<typeof entryClassAdminLoginResponseSchema>;
export type EntryClassAdminListResponse = z.infer<typeof entryClassAdminListResponseSchema>;
export type EntryClassChangeRequest = z.infer<typeof entryClassChangeRequestSchema>;
export type EntryClassChangeResponse = z.infer<typeof entryClassChangeResponseSchema>;
export type EntryClassAdminErrorCode = z.infer<typeof entryClassAdminErrorCodeSchema>;
export type EntryClassAdminErrorResponse = z.infer<typeof entryClassAdminErrorResponseSchema>;
