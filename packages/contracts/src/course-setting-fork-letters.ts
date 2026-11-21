import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * ADR-0175, tillägg 2026-11-21 (b): det som berörs om banläggningens nycklar ordnas om eller låset hävs, per gafflad bana
 * (banläggningens id): kartor med variant i tryckjobben, publicerad startlista och löpare med en tilldelad variant.
 */
export const courseSettingForkLettersSchema = z.object({
  raceId: uuid,
  courses: z.array(z.object({
    course: z.string().min(1).max(64),
    printedMaps: z.number().int().nonnegative().nullable(),
    startListPublished: z.boolean(),
    runners: z.array(z.object({ name: z.string().min(1).max(400), className: z.string().max(160), code: z.string().max(32) }).strict()).max(200),
    runnerCount: z.number().int().nonnegative()
  }).strict()).max(1000)
}).strict();
export type CourseSettingForkLetters = z.infer<typeof courseSettingForkLettersSchema>;
