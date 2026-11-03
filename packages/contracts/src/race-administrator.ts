import { z } from "zod";
import { uuidSchema as uuid } from "./ids";
import { courseSettingLevelSchema } from "./course-setting";


/** GET …/administrator/session: kontots roll på tävlingen (ADR-0172 beslut 3, ADR-0173 beslut 4). */
export const raceSessionResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  /** ADMIN: ägare eller administratör. FUNCTIONARY: funktionär. */
  role: z.enum(["ADMIN", "FUNCTIONARY"]),
  expiresAt: z.iso.datetime({ offset: true }),
  /** Banläggningens behörighet (ADR-0181 beslut 5): admin har EDIT; funktionären bara med en egen behörighet. */
  courseSetting: courseSettingLevelSchema.optional()
}).strict();

/** Utan inloggning eller behörighet på tävlingen: 200 med `authenticated: false` i stället för 401 (PLAN.md steg 22). */
export const raceSessionAbsentSchema = z.object({ formatVersion: z.literal(1), raceId: uuid, authenticated: z.literal(false),
  /** Inloggad med bara banläggningen på tävlingen: arbetsytan skickar vidare dit (ägaren 2026-11-03). */
  courseSetting: courseSettingLevelSchema.optional() }).strict();
export const raceSessionStatusSchema = z.union([raceSessionResponseSchema, raceSessionAbsentSchema]);

export type RaceSessionResponse = z.infer<typeof raceSessionResponseSchema>;
