import { z } from "zod";
import { canonicalJsonBytes } from "./canonical-json";
import { StartCheckinOperationSchema, StartCheckinReceiptSchema } from "./start-checkin";

/** Online return only. Actor, source, sequence and action are server-owned. */
export const administratorReturnRequestSchema = StartCheckinOperationSchema.pick({
  formatVersion: true, requestId: true, entryId: true, packageVersion: true,
  expectedEntryVersion: true, expectedRevision: true, observedAt: true
}).extend({ expectedStartState: z.enum(["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"]) }).strict();

/** STORED is durable, not necessarily applied: a conflict must remain visible. */
export const administratorReturnResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(),
  request: administratorReturnRequestSchema, receipt: StartCheckinReceiptSchema
}).strict().superRefine((value, context) => {
  const { request, receipt } = value;
  if (request.requestId !== receipt.requestId || request.entryId !== receipt.entryId ||
    (receipt.effect.kind === "APPLIED" && receipt.effect.revision !== request.expectedRevision + 1) ||
    (receipt.effect.kind === "UNCHANGED" && receipt.effect.revision !== request.expectedRevision)) {
    context.addIssue({ code: "custom", message: "Återkomstkvittensen motsäger avsikten" });
  }
});

export function canonicalAdministratorReturnRequest(value: unknown): Uint8Array {
  return canonicalJsonBytes(administratorReturnRequestSchema.parse(value));
}

export type AdministratorReturnRequest = z.infer<typeof administratorReturnRequestSchema>;
export type AdministratorReturnResponse = z.infer<typeof administratorReturnResponseSchema>;

/** Explicit administrative start observation, never a start timestamp. */
export const administratorStartCorrectionRequestSchema = administratorReturnRequestSchema
  .omit({ expectedStartState: true }).extend({ targetStartState: z.enum(["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"]) }).strict();
export const administratorStartCorrectionResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(),
  request: administratorStartCorrectionRequestSchema, receipt: StartCheckinReceiptSchema
}).strict().superRefine((value, context) => {
  const { request, receipt } = value;
  if (request.requestId !== receipt.requestId || request.entryId !== receipt.entryId ||
    (receipt.effect.kind === "APPLIED" && receipt.effect.revision !== request.expectedRevision + 1) ||
    (receipt.effect.kind === "UNCHANGED" && receipt.effect.revision !== request.expectedRevision)) {
    context.addIssue({ code: "custom", message: "Startkvittensen motsäger avsikten" });
  }
});
export function canonicalAdministratorStartCorrectionRequest(value: unknown): Uint8Array {
  return canonicalJsonBytes(administratorStartCorrectionRequestSchema.parse(value));
}
export type AdministratorStartCorrectionRequest = z.infer<typeof administratorStartCorrectionRequestSchema>;
