import { z } from "zod";

/**
 * Steg 45: ett beslut som döljer en ny avläsning (domänens `decisionHidingReadout`): beslutet som gäller och vad
 * avläsningen under ger. Bara i arbetsytan.
 */
export const decisionReviewSchema = z.object({
  decision: z.enum(["DSQ", "APPROVAL", "DNF", "OOC", "NT", "FINISH_TIME", "START_TIME", "MANUAL_TIME", "CONTROL_APPROVAL",
    "MP_CONFIRMED"]),
  status: z.enum(["OK", "MP", "OVERTIME"]),
  elapsedMs: z.number().int().positive().max(2_147_483_647).optional()
}).strict();
export type DecisionReview = z.infer<typeof decisionReviewSchema>;
