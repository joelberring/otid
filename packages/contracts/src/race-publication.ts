import { z } from "zod";

/**
 * Publicering av tävlingen (ADR-0172 beslut 4). En ny tävling syns inte publikt förrän admin publicerar den.
 * Tävlingssidan har en kort adress (/t/{kod}) som skapas med tävlingen.
 */
const canonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

/** Sex tecken ur ett alfabet utan förväxlingsbara tecken (inga 0, 1, i, l, o). */
export const raceShortCodeSchema = z.string().regex(/^[2-9a-hjkmnp-z]{6}$/);

export const racePublicationStateSchema = z.object({
  shortCode: raceShortCodeSchema,
  /** Null = inte publicerad. */
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Superadmin har dolt tävlingen: den syns inte publikt även om den är publicerad. */
  hiddenBySuperadmin: z.boolean()
}).strict();
export type RacePublicationState = z.infer<typeof racePublicationStateSchema>;

export const racePublicationResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: canonicalUuidSchema,
  publication: racePublicationStateSchema
}).strict();
export type RacePublicationResponse = z.infer<typeof racePublicationResponseSchema>;
