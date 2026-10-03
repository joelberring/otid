import { z } from "zod";

export const IOF_IMPORT_CONTENT_TYPE = "application/xml" as const;
export const IOF_IMPORT_MIN_BYTES = 1;
export const IOF_IMPORT_MAX_BYTES = 5_000_000;

export const iofImportRequestIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Request-id måste vara ett kanoniskt gemener-UUID"
);

export const iofImportIdempotencyKeySchema = z.string().regex(
  /^iof-import:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Idempotency-Key måste vara iof-import:<kanoniskt request-uuid>"
);

export const iofImportLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_import_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const iofImportLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: iofImportRequestIdSchema,
  capability: z.literal("IMPORT_IOF"),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();

const warningSchema = z.string().min(1).max(500);

export const iofCourseDataImportReportSchema = z.object({
  kind: z.literal("CourseData"),
  warnings: z.array(warningSchema).max(100),
  imported: z.object({
    courses: z.number().int().nonnegative(),
    classes: z.number().int().nonnegative()
  }).strict()
}).strict();

export const iofEntryListImportReportSchema = z.object({
  kind: z.literal("EntryList"),
  warnings: z.array(warningSchema).max(100),
  imported: z.object({
    entries: z.number().int().nonnegative()
  }).strict()
}).strict();

export const iofStartListImportReportSchema = z.object({
  kind: z.literal("StartList"),
  warnings: z.array(warningSchema).max(100),
  imported: z.object({
    classes: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative()
  }).strict(),
  changed: z.object({
    classes: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative()
  }).strict(),
  resultsRequiringRecalculation: z.number().int().nonnegative(),
  snapshotChanged: z.boolean()
}).strict();

export const iofImportReportSchema = z.discriminatedUnion("kind", [
  iofCourseDataImportReportSchema,
  iofEntryListImportReportSchema,
  iofStartListImportReportSchema
]);

export const iofImportResponseSchema = z.object({
  formatVersion: z.literal(1),
  status: z.enum(["stored", "duplicate"]),
  replayed: z.boolean(),
  requestId: iofImportRequestIdSchema,
  raceId: iofImportRequestIdSchema,
  importFileId: iofImportRequestIdSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  byteCount: z.number().int().min(IOF_IMPORT_MIN_BYTES).max(IOF_IMPORT_MAX_BYTES),
  report: iofImportReportSchema
}).strict();

export const iofImportErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID_REQUEST",
  "INVALID_IOF_XML",
  "CONFLICT",
  "INTERNAL_ERROR"
]);

export const iofImportErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: iofImportErrorCodeSchema
}).strict();

export type IofImportRequestId = z.infer<typeof iofImportRequestIdSchema>;
export type IofImportLoginRequest = z.infer<typeof iofImportLoginRequestSchema>;
export type IofImportLoginResponse = z.infer<typeof iofImportLoginResponseSchema>;
export type IofCourseDataImportReport = z.infer<typeof iofCourseDataImportReportSchema>;
export type IofEntryListImportReport = z.infer<typeof iofEntryListImportReportSchema>;
export type IofStartListImportReport = z.infer<typeof iofStartListImportReportSchema>;
export type IofImportReport = z.infer<typeof iofImportReportSchema>;
export type IofImportResponse = z.infer<typeof iofImportResponseSchema>;
export type IofImportErrorCode = z.infer<typeof iofImportErrorCodeSchema>;
export type IofImportErrorResponse = z.infer<typeof iofImportErrorResponseSchema>;
