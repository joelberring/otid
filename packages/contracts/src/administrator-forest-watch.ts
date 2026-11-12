import { z } from "zod";
import { StartCheckinOperationSchema } from "./start-checkin";
import { StartCheckinRosterResponseSchema } from "./start-checkin-roster";

/** Admin-only extension; personnel/offline responses keep their original schema. */
export const administratorForestWatchResponseSchema = StartCheckinRosterResponseSchema.safeExtend({
  /** Tävlingsdagen: före den räknas ingen som kvar i skogen (PLAN.md steg 22). */
  raceDate: z.iso.date(),
  reportedStarts: z.array(z.object({
    entryId: StartCheckinOperationSchema.shape.entryId,
    observedAt: StartCheckinOperationSchema.shape.observedAt.nullable()
  }).strict()).max(10_000),
  /**
   * Användartestet 2026-11-12: löpare vars bricka har stämplat vid en radiokontroll. De räknas alltid som ute även om den
   * lottade starttiden ligger framåt i tiden (`remainsInForest` i domänen).
   */
  radioPunched: z.array(StartCheckinOperationSchema.shape.entryId).max(10_000)
}).superRefine((value, ctx) => {
  const entries = new Map(value.entries.map(entry => [entry.entryId, entry]));
  if (value.reportedStarts.length !== entries.size || new Set(value.reportedStarts.map(row => row.entryId)).size !== entries.size ||
      value.reportedStarts.some(row => !entries.has(row.entryId) || (entries.get(row.entryId)?.startState !== "STARTED" && row.observedAt !== null))) {
    ctx.addIssue({ code: "custom", message: "Startobservationerna motsäger rostern" });
  }
  if (new Set(value.radioPunched).size !== value.radioPunched.length || value.radioPunched.some(id => !entries.has(id))) {
    ctx.addIssue({ code: "custom", message: "Radiostämplingarna motsäger rostern" });
  }
});
export type AdministratorForestWatchResponse = z.infer<typeof administratorForestWatchResponseSchema>;
