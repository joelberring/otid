import { z } from "zod";

/**
 * "Ny tävling som …" (PLAN.md steg 21): kopierar en tävling till ett nytt event med ett lopp. Banor, klasser,
 * inställningar, karta och radiokontroller följer med; deltagare, lag, starttider, avläsningar och resultat gör det inte.
 * Funktionärer och administratörer följer med när `includePeople` är sant. Begäran är idempotent på `requestId`.
 */
const canonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const raceCopyRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  eventName: z.string().trim().min(2).max(160),
  raceName: z.string().trim().min(2).max(160),
  raceDate: z.iso.date(),
  includePeople: z.boolean()
}).strict();
export type RaceCopyRequest = z.infer<typeof raceCopyRequestSchema>;

/** Vad kopian fick: antal och om kartan och radiokontrollerna kom med. */
export const raceCopySummarySchema = z.object({
  courses: z.number().int().nonnegative(),
  classes: z.number().int().nonnegative(),
  controls: z.number().int().nonnegative(),
  relayLegs: z.number().int().nonnegative(),
  radioControls: z.number().int().nonnegative(),
  map: z.boolean(),
  /** Administratörer och funktionärer utöver den som kopierade (som blir ägare). */
  people: z.number().int().nonnegative(),
  /** Källan var kopplad till Eventor; kopian är inte det och kopplas till ett nytt Eventor-event vid behov. */
  eventorNotCopied: z.boolean()
}).strict();
export type RaceCopySummary = z.infer<typeof raceCopySummarySchema>;

export const raceCopyResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: canonicalUuidSchema,
  sourceRaceId: canonicalUuidSchema,
  eventId: canonicalUuidSchema,
  raceId: canonicalUuidSchema,
  copied: raceCopySummarySchema,
  createdAt: z.iso.datetime({ offset: true })
}).strict();
export type RaceCopyResponse = z.infer<typeof raceCopyResponseSchema>;

/**
 * Förvalt datum för kopian: samma dag om källans datum inte har passerat, annars samma veckodag
 * en eller flera veckor senare – den första som inte har passerat. `today` och svaret är ÅÅÅÅ-MM-DD.
 */
export function defaultRaceCopyDate(sourceDate: string, today: string): string {
  if (sourceDate >= today) return sourceDate;
  const day = 24 * 60 * 60 * 1000;
  const source = Date.parse(`${sourceDate}T00:00:00Z`);
  const target = Date.parse(`${today}T00:00:00Z`);
  const weeks = Math.max(1, Math.ceil((target - source) / (7 * day)));
  return new Date(source + weeks * 7 * day).toISOString().slice(0, 10);
}
