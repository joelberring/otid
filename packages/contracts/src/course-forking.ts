import { z } from "zod";

/**
 * Gafflingsstruktur (steg 49, ADR-0175): grundföljd med enkla gafflingar (FORK) och fjärilar (LOOP). Samma form som
 * domänens `CourseForking`. Schemat tillåter också en härledd struktur för bilden (fler alternativ eller ett tomt
 * alternativ); reglerna för att spara prövas i domänen (`validateCourseForking`).
 */
const controlCode = z.number().int().positive().max(2_147_483_647);
const branch = z.array(controlCode).max(1000);
/**
 * Tillägg 2026-11-12 (b) i ADR-0175: alternativets bokstav (null = nytt alternativ, får nästa lediga bokstav). Saknas
 * `letters` gäller bokstäver i följd som för strukturer sparade före tillägget.
 */
const letter = z.string().regex(/^[A-Z]$/);
const letters = z.array(letter.nullable()).max(100).optional();
const retiredLetters = z.array(letter).max(26).optional();
export const courseForkingItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CONTROL"), code: controlCode }).strict(),
  z.object({ kind: z.literal("FORK"), branches: z.array(branch).min(1).max(100), letters }).strict(),
  z.object({ kind: z.literal("LOOP"), center: controlCode, loops: z.array(branch).min(1).max(10), letters }).strict()
]);
export const courseForkingSchema = z.object({ items: z.array(courseForkingItemSchema).min(1).max(1000), retiredLetters }).strict();
export const forkingChoiceSchema = z.union([z.number().int().min(0).max(99), z.array(z.number().int().min(0).max(99)).max(10), z.null()]);
export const forkingModeSchema = z.enum(["BALANCED", "UNEQUAL"]);
const variantCode = z.string().min(1).max(32);

/** Banans struktur med varje variants val (för bilden och markeringen av löparens variant). */
export const courseForkingViewSchema = z.object({
  items: z.array(courseForkingItemSchema).min(1).max(1000),
  /** Bokstäver som har tagits bort från banan (delas inte ut igen). */
  retiredLetters,
  variants: z.array(z.object({ code: variantCode, choices: z.array(forkingChoiceSchema).max(1000),
    lengthMeters: z.number().int().min(1).max(1_000_000).nullable() }).strict()).max(100)
}).strict();

export type CourseForkingItem = z.infer<typeof courseForkingItemSchema>;
export type CourseForkingView = z.infer<typeof courseForkingViewSchema>;
