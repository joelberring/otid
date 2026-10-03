import { z } from "zod";
import { StartCheckinOperationSchema, StartCheckinReceiptSchema } from "./start-checkin";

export const checkinHistoryRowSchema = z.object({
  requestId: StartCheckinOperationSchema.shape.requestId,
  observedAt: StartCheckinOperationSchema.shape.observedAt,
  receivedAt: StartCheckinReceiptSchema.shape.receivedAt,
  source: z.enum(["MANAGE_RACE", "START_CHECKIN", "FINISH_FOREST_WATCH"]),
  sourceLabel: z.string().min(1).max(256),
  action: StartCheckinOperationSchema.shape.action,
  effect: StartCheckinReceiptSchema.shape.effect,
  reviewed: z.object({ decision: z.literal("KEEP_CURRENT_STATE"), reason: z.string().trim().min(1).max(500), reviewedAt: StartCheckinReceiptSchema.shape.receivedAt }).strict().nullable().optional()
}).strict().superRefine((row, ctx) => {
  if (row.reviewed && row.effect.kind !== "CONFLICT") ctx.addIssue({ code: "custom", message: "Endast konfliktrapporter kan granskas" });
  if ((row.source === "START_CHECKIN" && row.action.kind !== "MARK_START") ||
      (row.source === "FINISH_FOREST_WATCH" && row.action.kind !== "FINISH_CORRECTION")) {
    ctx.addIssue({ code: "custom", message: "Källrollen motsäger journalåtgärden" });
  }
});

export const checkinHistoryResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: StartCheckinOperationSchema.shape.raceId,
  entryId: StartCheckinOperationSchema.shape.entryId,
  rows: z.array(checkinHistoryRowSchema).max(50),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/).nullable()
}).strict().superRefine((value, ctx) => {
  if (new Set(value.rows.map(row => row.requestId)).size !== value.rows.length ||
      (value.rows.length === 0 && value.nextCursor !== null)) {
    ctx.addIssue({ code: "custom", message: "Ogiltig journalsida" });
  }
});
export type CheckinHistoryResponse = z.infer<typeof checkinHistoryResponseSchema>;
