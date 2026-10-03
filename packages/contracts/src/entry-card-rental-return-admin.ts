import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);
const assignment = z.object({
  id: uuid,
  cardNumber: z.string().min(1).max(32),
  isRental: z.literal(true),
  rentalReturned: z.boolean()
}).strict();

export const entryCardRentalReturnChangeRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: version,
  expectedClassId: uuid,
  expectedSnapshotVersion: version,
  expectedAssignment: assignment,
  rentalReturned: z.boolean()
}).strict().refine(value => value.expectedAssignment.rentalReturned !== value.rentalReturned);

export const entryCardRentalReturnChangeIdempotencyKeySchema = z.string().regex(
  /^entry-card-rental-return-change:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const entryCardRentalReturnChangeResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, entryId: uuid, classId: uuid,
  assignment: z.object({ id: uuid, cardNumber: z.string().min(1).max(32) }).strict(),
  previousRentalReturned: z.boolean(), rentalReturned: z.boolean(),
  entryVersionBefore: version, entryVersionAfter: version,
  snapshotVersionBefore: version, snapshotVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true })
}).strict().refine(value => value.previousRentalReturned !== value.rentalReturned &&
  value.entryVersionAfter === value.entryVersionBefore + 1 &&
  value.snapshotVersionAfter === value.snapshotVersionBefore + 1);

export type EntryCardRentalReturnChangeRequest = z.infer<typeof entryCardRentalReturnChangeRequestSchema>;
export type EntryCardRentalReturnChangeResponse = z.infer<typeof entryCardRentalReturnChangeResponseSchema>;
