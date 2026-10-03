import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const assignment = z.object({ id: uuid, cardNumber: z.string().min(1).max(32), isRental: z.boolean() }).strict();

export const entryCardRentalChangeRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: version,
  expectedClassId: uuid,
  expectedSnapshotVersion: version,
  expectedAssignment: assignment,
  isRental: z.boolean()
}).strict().refine(value => value.expectedAssignment.isRental !== value.isRental);

export const entryCardRentalChangeIdempotencyKeySchema = z.string().regex(
  /^entry-card-rental-change:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const entryCardRentalChangeResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, entryId: uuid, classId: uuid,
  assignment: z.object({ id: uuid, cardNumber: z.string().min(1).max(32) }).strict(),
  previousIsRental: z.boolean(), isRental: z.boolean(),
  entryVersionBefore: version, entryVersionAfter: version,
  snapshotVersionBefore: version, snapshotVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true })
}).strict().refine(value => value.previousIsRental !== value.isRental &&
  value.entryVersionAfter === value.entryVersionBefore + 1 &&
  value.snapshotVersionAfter === value.snapshotVersionBefore + 1);

export type EntryCardRentalChangeRequest = z.infer<typeof entryCardRentalChangeRequestSchema>;
export type EntryCardRentalChangeResponse = z.infer<typeof entryCardRentalChangeResponseSchema>;
