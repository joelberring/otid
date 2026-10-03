import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);

// Exact stored values are preserved for concurrency and historical responses.
export const entryIdentityValuesSchema = z.object({
  givenName: z.string().min(1).max(160),
  familyName: z.string().min(1).max(160),
  organisationName: z.string().min(1).max(240).nullable()
}).strict();
const newValues = z.object({
  givenName: z.string().trim().min(1).max(160),
  familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(200).nullable()
}).strict();

export const entryIdentityAdminLoginRequestSchema = z.object({
  formatVersion: z.literal(1),
  accessCredential: z.string().regex(/^otid_org_entry_identity_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();
export const entryIdentityAdminLoginResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, capability: z.literal("CHANGE_ENTRY_IDENTITY"),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();
export const entryIdentityAdminListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version,
  entries: z.array(z.object({
    id: uuid, classId: uuid, className: z.string().min(1).max(160), version,
    identity: entryIdentityValuesSchema
  }).strict()).max(10_000)
}).strict().refine((value) => new Set(value.entries.map((row) => row.id)).size === value.entries.length);

export const entryIdentityChangeRequestSchema = z.object({
  formatVersion: z.literal(1), expectedEntryVersion: version, expectedClassId: uuid,
  expectedSnapshotVersion: version, expectedIdentity: entryIdentityValuesSchema,
  identity: newValues
}).strict();
export const entryIdentityChangeIdempotencyKeySchema = z.string().regex(
  /^entry-identity-change:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);
const identityChangeRecord = z.object({
  requestId: uuid, classId: uuid, previousIdentity: entryIdentityValuesSchema,
  identity: entryIdentityValuesSchema.extend({ organisationName: z.string().min(1).max(200).nullable() }),
  entryVersionBefore: version, entryVersionAfter: version,
  snapshotVersionBefore: version, snapshotVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true })
}).strict();
const isActualChange = (value: z.infer<typeof identityChangeRecord>) =>
  (value.previousIdentity.givenName !== value.identity.givenName ||
    value.previousIdentity.familyName !== value.identity.familyName ||
    value.previousIdentity.organisationName !== value.identity.organisationName) &&
  value.entryVersionAfter === value.entryVersionBefore + 1 &&
  value.snapshotVersionAfter === value.snapshotVersionBefore + 1;
export const entryIdentityChangeResponseSchema = identityChangeRecord.extend({
  formatVersion: z.literal(1), replayed: z.boolean(), raceId: uuid, entryId: uuid
}).strict().refine(isActualChange);

export const entryIdentityHistoryResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, entryId: uuid,
  items: z.array(identityChangeRecord.refine(isActualChange)).max(50),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/).nullable()
}).strict().refine((value) =>
  (value.nextCursor === null || value.items.length > 0) &&
  new Set(value.items.map((item) => item.requestId)).size === value.items.length &&
  value.items.every((item, index) => index === 0 ||
    item.entryVersionBefore < value.items[index - 1]!.entryVersionBefore)
);

export { entryClassAdminErrorResponseSchema as entryIdentityAdminErrorResponseSchema } from "./entry-class-admin";
export type { EntryClassAdminErrorCode as EntryIdentityAdminErrorCode } from "./entry-class-admin";
export type EntryIdentityValues = z.infer<typeof entryIdentityValuesSchema>;
export type EntryIdentityAdminLoginRequest = z.infer<typeof entryIdentityAdminLoginRequestSchema>;
export type EntryIdentityAdminListResponse = z.infer<typeof entryIdentityAdminListResponseSchema>;
export type EntryIdentityChangeRequest = z.infer<typeof entryIdentityChangeRequestSchema>;
export type EntryIdentityChangeResponse = z.infer<typeof entryIdentityChangeResponseSchema>;
export type EntryIdentityHistoryResponse = z.infer<typeof entryIdentityHistoryResponseSchema>;
