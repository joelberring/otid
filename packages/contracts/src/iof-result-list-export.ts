import { z } from "zod";
import { UUID_PATTERN } from "./ids";

const canonicalUuidSchema = z.string().regex(
  UUID_PATTERN,
  "Id måste vara ett kanoniskt gemener-UUID"
);



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

export type IofResultListExportMetadata = z.infer<typeof iofResultListExportMetadataSchema>;
export type IofResultListExportAdminErrorCode = z.infer<
  typeof iofResultListExportAdminErrorCodeSchema
>;
