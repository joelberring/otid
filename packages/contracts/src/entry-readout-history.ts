import { z } from "zod";
import { readoutHistoryListResponseSchema } from "./readout-result-history-admin";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

/** A page for one authorized entry, not a claim of complete result history. */
export const entryReadoutHistoryResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  entry: z.object({ id: uuid, displayName: z.string().trim().min(1).max(321) }).strict(),
  page: readoutHistoryListResponseSchema
}).strict().superRefine((response, context) => {
  if (response.page.raceId !== response.raceId) {
    context.addIssue({ code: "custom", path: ["page", "raceId"], message: "Historiksidan måste höra till loppet" });
  }
  for (const [index, item] of response.page.items.entries()) {
    if (item.entry?.id !== response.entry.id || item.entry.displayName !== response.entry.displayName) {
      context.addIssue({ code: "custom", path: ["page", "items", index, "entry"], message: "Avläsningen måste höra till den valda deltagaren" });
    }
  }
});
export type EntryReadoutHistoryResponse = z.infer<typeof entryReadoutHistoryResponseSchema>;
