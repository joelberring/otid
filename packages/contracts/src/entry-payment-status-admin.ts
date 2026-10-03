import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const version = z.number().int().positive().max(2_147_483_647);

/** Private administrative mark; it is never a payment transaction or proof. */
export const entryPaymentStatusSchema = z.enum(["UNMARKED", "UNPAID", "PAID", "WAIVED"]);

export const entryPaymentStatusChangeRequestSchema = z.object({
  formatVersion: z.literal(1),
  expectedEntryVersion: version,
  expectedClassId: uuid,
  expectedPaymentStatus: entryPaymentStatusSchema,
  expectedPaymentStatusVersion: version,
  paymentStatus: entryPaymentStatusSchema
}).strict().refine(value => value.expectedPaymentStatus !== value.paymentStatus);

export const entryPaymentStatusChangeIdempotencyKeySchema = z.string().regex(
  /^entry-payment-status-change:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);

export const entryPaymentStatusChangeResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuid,
  raceId: uuid,
  entryId: uuid,
  classId: uuid,
  previousPaymentStatus: entryPaymentStatusSchema,
  paymentStatus: entryPaymentStatusSchema,
  entryVersionAtChange: version,
  paymentStatusVersionBefore: version,
  paymentStatusVersionAfter: version,
  changedAt: z.iso.datetime({ offset: true })
}).strict().refine(value => value.previousPaymentStatus !== value.paymentStatus &&
  value.paymentStatusVersionAfter === value.paymentStatusVersionBefore + 1);

export type EntryPaymentStatus = z.infer<typeof entryPaymentStatusSchema>;
export type EntryPaymentStatusChangeRequest = z.infer<typeof entryPaymentStatusChangeRequestSchema>;
export type EntryPaymentStatusChangeResponse = z.infer<typeof entryPaymentStatusChangeResponseSchema>;
