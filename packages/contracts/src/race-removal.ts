import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * Ta bort och stryka (PLAN.md steg 27). "Ta bort deltagare" tar bort en anmälan som aldrig lästs ut och saknar resultat,
 * med allt som bara hör till den; "Stryk" döljer en anmälan som har läst ut eller har ett resultat i alla listor men behåller
 * historiken och de råa avläsningarna. "Ta bort klass" och "Ta bort bana" kräver att inget hänger på dem. Ett hinder är ett
 * vanligt svar (`BLOCKED`) med orsak, inte ett fel, så att arbetsytan kan säga vad som måste flyttas först.
 */
const version = z.number().int().positive().max(2_147_483_647);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const entryRemovalRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, entryId: uuid, mode: z.enum(["DELETE", "STRIKE"]), expectedEntryVersion: version
}).strict();
export const classRemovalRequestSchema = z.object({ formatVersion: z.literal(1), requestId: uuid, classId: uuid }).strict();
export const courseRemovalRequestSchema = z.object({ formatVersion: z.literal(1), requestId: uuid, courseId: uuid }).strict();

export const removalBlockerSchema = z.enum([
  /** Deltagaren har läst ut eller har ett resultat: kan bara strykas. */
  "HAS_RESULT",
  /** Sträcklöpare i ett lag: byt sträcklöpare under Lag i stället. */
  "RELAY_RUNNER",
  /** Klassen har anmälda (`count`): flytta dem till en annan klass först. */
  "CLASS_HAS_ENTRIES",
  /** Klassen har strukna deltagare med resultat eller lag; dess historik finns kvar. */
  "CLASS_HAS_HISTORY",
  /** Banan används av klasser (`names`): byt bana på dem först. */
  "COURSE_USED_BY_CLASS",
  /** Det finns resultat som bedömts mot banan. */
  "COURSE_HAS_RESULTS"
]);

const outcome = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.enum(["DELETED", "STRUCK"]) }).strict(),
  z.object({ outcome: z.literal("BLOCKED"), blocker: removalBlockerSchema, count: z.number().int().nonnegative().max(100_000).optional(),
    names: z.array(z.string().min(1).max(160)).max(1_000).optional() }).strict()
]);
const receipt = { formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, savedAt: instant };

export const entryRemovalResponseSchema = z.object({ ...receipt, request: entryRemovalRequestSchema, result: outcome }).strict();
export const classRemovalResponseSchema = z.object({ ...receipt, request: classRemovalRequestSchema, result: outcome }).strict();
export const courseRemovalResponseSchema = z.object({ ...receipt, request: courseRemovalRequestSchema, result: outcome }).strict();

export type EntryRemovalRequest = z.infer<typeof entryRemovalRequestSchema>;
export type ClassRemovalRequest = z.infer<typeof classRemovalRequestSchema>;
export type CourseRemovalRequest = z.infer<typeof courseRemovalRequestSchema>;
export type RemovalBlocker = z.infer<typeof removalBlockerSchema>;
export type RemovalOutcome = z.infer<typeof outcome>;
export type EntryRemovalResponse = z.infer<typeof entryRemovalResponseSchema>;
export type ClassRemovalResponse = z.infer<typeof classRemovalResponseSchema>;
export type CourseRemovalResponse = z.infer<typeof courseRemovalResponseSchema>;
