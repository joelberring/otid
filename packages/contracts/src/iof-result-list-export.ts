import { z } from "zod";

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  "Id måste vara ett kanoniskt gemener-UUID"
);
const instantSchema = z.iso.datetime({ offset: true });

export const iofResultListExportAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(
    /^otid_org_result_list_export_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/
  )
}).strict();

export const iofResultListExportAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  capability: z.literal("EXPORT_IOF_RESULT_LIST"),
  expiresAt: instantSchema
}).strict();

export const iofResultListExportMetadataSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  snapshotVersion: z.number().int().positive(),
  classCount: z.number().int().min(0).max(1000),
  resultCount: z.number().int().min(0).max(10000),
  staleResultCount: z.number().int().min(0).max(10000),
  omittedEntryCount: z.number().int().min(0).max(10000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict().superRefine((metadata, context) => {
  if (metadata.staleResultCount > metadata.resultCount) {
    context.addIssue({
      code: "custom",
      path: ["staleResultCount"],
      message: "Antalet inaktuella resultat kan inte överstiga exportantalet"
    });
  }
});

export const iofResultListExportAdminErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "TOO_LARGE",
  "INTERNAL_ERROR"
]);

export const iofResultListExportAdminErrorResponseSchema = z.object({
  formatVersion: z.literal(1),
  error: iofResultListExportAdminErrorCodeSchema
}).strict();

export type IofResultListExportAdminLoginRequest = z.infer<
  typeof iofResultListExportAdminLoginRequestSchema
>;
export type IofResultListExportAdminLoginResponse = z.infer<
  typeof iofResultListExportAdminLoginResponseSchema
>;
export type IofResultListExportMetadata = z.infer<typeof iofResultListExportMetadataSchema>;
export type IofResultListExportAdminErrorCode = z.infer<
  typeof iofResultListExportAdminErrorCodeSchema
>;
