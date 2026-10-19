import { z } from "zod";
import { prefixedUuidPattern, uuidSchema as uuid } from "./ids";

const version = z.number().int().positive().max(2_147_483_647);
const assignment = z.object({ id: uuid, cardNumber: z.string().min(1).max(32), isRental: z.boolean() }).strict();

export const entryCardRentalChangeRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: version,
  expectedClassId: uuid,
    expectedAssignment: assignment,
  isRental: z.boolean()
}).strict().refine(value => value.expectedAssignment.isRental !== value.isRental);

export const entryCardRentalChangeIdempotencyKeySchema = z.string().regex(
  prefixedUuidPattern("entry-card-rental-change"));

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
