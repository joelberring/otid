import { z } from "zod";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

const version = z.number().int().positive().max(2_147_483_647);
export const newEntryCardNumberSchema = z.string().trim().regex(/^[1-9][0-9]{0,31}$/);
const assignment = z.object({ id: uuid, cardNumber: z.string().min(1).max(32) }).strict();

export const entryCardAdminListResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: version,
  entries: z.array(z.object({ id: uuid, displayName: z.string().min(1).max(321), classId: uuid,
    className: z.string().min(1).max(160), version,
    activeAssignment: assignment.nullable(), multipleActiveAssignments: z.boolean()
  }).strict().refine((row) => !row.multipleActiveAssignments || row.activeAssignment === null)).max(10_000)
}).strict().refine((value) => new Set(value.entries.map((row) => row.id)).size === value.entries.length);
export const entryCardChangeRequestSchema = z.object({ formatVersion: z.literal(1),
  expectedEntryVersion: version, expectedClassId: uuid,   expectedAssignment: assignment.nullable(), cardNumber: newEntryCardNumberSchema
}).strict();
export const entryCardChangeIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("entry-card-change"));
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
export type EntryCardAdminListResponse = z.infer<typeof entryCardAdminListResponseSchema>;
export type EntryCardChangeRequest = z.infer<typeof entryCardChangeRequestSchema>;
export type EntryCardChangeResponse = z.infer<typeof entryCardChangeResponseSchema>;
