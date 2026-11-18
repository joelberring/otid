import { z } from "zod";
import { bingoModeSchema } from "./bingo";
import { courseSettingLevelSchema } from "./course-setting";
import { uuidSchema } from "./ids";
import { raceTypeSchema } from "./race-settings";

/**
 * Tävlingsraden (ADR-0227 tillägg 2026-11-18): det avläsningens statiska skal hämtar för Byt funktion – rollen, typen och
 * banläggningens nivå, som arrangemangets layout läser på servern. Svaret ger ingen behörighet; servern prövar varje anrop.
 */
export const raceNavigationResponseSchema = z.object({
  raceId: uuidSchema,
  eventName: z.string(),
  raceName: z.string(),
  raceDate: z.iso.date(),
  timeZone: z.string().min(1),
  raceType: raceTypeSchema,
  role: z.enum(["ADMIN", "FUNCTIONARY"]),
  courseSetting: courseSettingLevelSchema.optional(),
  bingo: z.object({ enabled: z.boolean(), mode: bingoModeSchema }).strict().optional()
}).strict();

export type RaceNavigationResponse = z.infer<typeof raceNavigationResponseSchema>;
