import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
export const newEntryCardNumberSchema = z.string().trim().regex(/^[1-9][0-9]{0,31}$/);
const assignment = z.object({ id: uuid, cardNumber: z.string().min(1).max(32) }).strict();

export const entryCardAdminLoginRequestSchema = z.object({ formatVersion: z.literal(1),
  accessCredential: z.string().regex(/^otid_org_entry_card_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/)
}).strict();
export const entryCardAdminLoginResponseSchema = z.object({ formatVersion: z.literal(1), raceId: uuid,
  capability: z.literal("CHANGE_ENTRY_CARD"), expiresAt: z.iso.datetime({ offset: true }) }).strict();
export const entryCardAdminListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version,
  entries: z.array(z.object({ id: uuid, displayName: z.string().min(1).max(321), classId: uuid,
    className: z.string().min(1).max(160), version,
    activeAssignment: assignment.nullable(), multipleActiveAssignments: z.boolean()
  }).strict().refine((row) => !row.multipleActiveAssignments || row.activeAssignment === null)).max(10_000)
}).strict().refine((value) => new Set(value.entries.map((row) => row.id)).size === value.entries.length);
export const entryCardChangeRequestSchema = z.object({ formatVersion: z.literal(1),
  expectedEntryVersion: version, expectedClassId: uuid, expectedSnapshotVersion: version,
  expectedAssignment: assignment.nullable(), cardNumber: newEntryCardNumberSchema
}).strict();
export const entryCardChangeIdempotencyKeySchema = z.string().regex(
  /^entry-card-change:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const entryCardChangeResponseSchema = z.object({ formatVersion: z.literal(1), replayed: z.boolean(),
  requestId: uuid, raceId: uuid, entryId: uuid, classId: uuid,
  previousAssignment: assignment.nullable(), activeAssignment: assignment,
  entryVersionBefore: version, entryVersionAfter: version, snapshotVersionBefore: version, snapshotVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true })
}).strict().refine((row) => row.previousAssignment?.id !== row.activeAssignment.id &&
  row.previousAssignment?.cardNumber !== row.activeAssignment.cardNumber &&
  row.entryVersionAfter === row.entryVersionBefore + 1 && row.snapshotVersionAfter === row.snapshotVersionBefore + 1);
export { entryClassAdminErrorResponseSchema as entryCardAdminErrorResponseSchema } from "./entry-class-admin";
export type { EntryClassAdminErrorCode as EntryCardAdminErrorCode } from "./entry-class-admin";
export type EntryCardAdminLoginRequest = z.infer<typeof entryCardAdminLoginRequestSchema>;
export type EntryCardAdminListResponse = z.infer<typeof entryCardAdminListResponseSchema>;
export type EntryCardChangeRequest = z.infer<typeof entryCardChangeRequestSchema>;
export type EntryCardChangeResponse = z.infer<typeof entryCardChangeResponseSchema>;
