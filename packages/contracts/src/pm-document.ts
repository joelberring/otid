import { z } from "zod";

export const PM_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const uuid = z.string().regex(new RegExp(`^${uuidPattern}$`));
const revision = z.number().int().min(0).max(2_147_483_647);

// Reject rather than transform: an exact retry must retain its original intent.
const title = z.string().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 120 && value === value.trim() &&
    value === value.normalize("NFC") &&
    !/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(value);
}, "Titeln måste vara 1–120 tecken i NFC utan kantblanksteg eller styrtecken");

export const pmDocumentUploadRequestSchema = z.object({
  formatVersion: z.literal(1),
  title,
  byteLength: z.number().int().min(1).max(PM_DOCUMENT_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mediaType: z.literal("application/pdf")
}).strict();

/** Login-only contract; upload, scan and publication each remain separate intents. */
export const pmDocumentLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(new RegExp(`^otid_org_pm_document_v1\\.${uuidPattern}\\.[A-Za-z0-9_-]{43}$`))
}).strict();

// Shape validation only. The application must resolve upload/scan provenance.
export const pmDocumentPublishRequestSchema = z.object({
  formatVersion: z.literal(1),
  uploadId: uuid,
  expectedPublicationRevision: revision
}).strict();

export const pmDocumentWithdrawRequestSchema = z.object({
  formatVersion: z.literal(1),
  publicationId: uuid,
  expectedPublicationRevision: revision.min(1)
}).strict();

export const pmDocumentUploadIdempotencyKeySchema = z.string().regex(new RegExp(`^pm-upload:${uuidPattern}$`));
export const pmDocumentPublishIdempotencyKeySchema = z.string().regex(new RegExp(`^pm-publish:${uuidPattern}$`));
export const pmDocumentWithdrawIdempotencyKeySchema = z.string().regex(new RegExp(`^pm-withdraw:${uuidPattern}$`));

export type PmDocumentUploadRequest = z.infer<typeof pmDocumentUploadRequestSchema>;
export type PmDocumentLoginRequest = z.infer<typeof pmDocumentLoginRequestSchema>;
export type PmDocumentPublishRequest = z.infer<typeof pmDocumentPublishRequestSchema>;
export type PmDocumentWithdrawRequest = z.infer<typeof pmDocumentWithdrawRequestSchema>;
