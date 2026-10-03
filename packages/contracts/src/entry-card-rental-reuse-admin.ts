import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const sourceAssignmentSchema = z.object({ id: uuid, cardNumber: z.string().min(1).max(32),
  isRental: z.literal(true), rentalReturned: z.literal(true) }).strict();

export const entryCardRentalReuseIdempotencyKeySchema = z.string().regex(
  /^entry-card-rental-reuse:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const entryCardRentalReuseRequestSchema = z.object({
  formatVersion: z.literal(1), expectedSnapshotVersion: version,
  source: z.object({ entryId: uuid, classId: uuid, entryVersion: version,
    assignment: sourceAssignmentSchema }).strict(),
  expectedTargetClassId: uuid, expectedTargetEntryVersion: version
}).strict();
export const entryCardRentalReuseResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid,
  source: z.object({ entryId: uuid, classId: uuid,
    assignment: z.object({ id: uuid, cardNumber: z.string().min(1).max(32) }).strict() }).strict(),
  target: z.object({ entryId: uuid, classId: uuid, assignment: z.object({ id: uuid, cardNumber: z.string().min(1).max(32),
    isRental: z.literal(true), rentalReturned: z.literal(false) }).strict() }).strict(),
  sourceEntryVersionBefore: version, sourceEntryVersionAfter: version,
  targetEntryVersionBefore: version, targetEntryVersionAfter: version,
  snapshotVersionBefore: version, snapshotVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true })
}).strict().refine((row) => row.source.entryId !== row.target.entryId &&
  row.source.assignment.id !== row.target.assignment.id &&
  row.source.assignment.cardNumber === row.target.assignment.cardNumber &&
  row.sourceEntryVersionAfter === row.sourceEntryVersionBefore + 1 &&
  row.targetEntryVersionAfter === row.targetEntryVersionBefore + 1 &&
  row.snapshotVersionAfter === row.snapshotVersionBefore + 1);

export type EntryCardRentalReuseRequest = z.infer<typeof entryCardRentalReuseRequestSchema>;
export type EntryCardRentalReuseResponse = z.infer<typeof entryCardRentalReuseResponseSchema>;
