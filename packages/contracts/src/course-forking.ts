import { z } from "zod";

/**
 * Gafflingsstruktur (steg 49, ADR-0175): grundföljd med enkla gafflingar (FORK) och fjärilar (LOOP). Samma form som
 * domänens `CourseForking`. Schemat tillåter också en härledd struktur för bilden (fler alternativ eller ett tomt
 * alternativ); reglerna för att spara prövas i domänen (`validateCourseForking`).
 */
const controlCode = z.number().int().positive().max(2_147_483_647);
const branch = z.array(controlCode).max(1000);
export const courseForkingItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CONTROL"), code: controlCode }).strict(),
  z.object({ kind: z.literal("FORK"), branches: z.array(branch).min(1).max(100) }).strict(),
  z.object({ kind: z.literal("LOOP"), center: controlCode, loops: z.array(branch).min(1).max(10) }).strict()
]);
export const courseForkingSchema = z.object({ items: z.array(courseForkingItemSchema).min(1).max(1000) }).strict();
export const forkingChoiceSchema = z.union([z.number().int().min(0).max(99), z.array(z.number().int().min(0).max(99)).max(10), z.null()]);
export const forkingModeSchema = z.enum(["BALANCED", "UNEQUAL"]);
const variantCode = z.string().min(1).max(32);

/** Banans struktur med varje variants val (för bilden och markeringen av löparens variant). */
export const courseForkingViewSchema = z.object({
  items: z.array(courseForkingItemSchema).min(1).max(1000),
  variants: z.array(z.object({ code: variantCode, choices: z.array(forkingChoiceSchema).max(1000),
    lengthMeters: z.number().int().min(1).max(1_000_000).nullable() }).strict()).max(100)
}).strict();

export type CourseForkingItem = z.infer<typeof courseForkingItemSchema>;
export type CourseForkingValue = z.infer<typeof courseForkingSchema>;
export type CourseForkingView = z.infer<typeof courseForkingViewSchema>;
export type ForkingChoiceValue = z.infer<typeof forkingChoiceSchema>;
