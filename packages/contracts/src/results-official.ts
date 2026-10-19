import { z } from "zod";
import { uuidSchema as uuid } from "./ids";
import { raceResultFinalizationMetadataSchema, resultFinalizationBlockerCodeSchema } from "./result-finalization-admin";

/**
 * "Resultaten är klara" (PLAN.md steg 27): en knapp som fastställer hela loppet (varje klass och sedan loppet, i en
 * transaktion), gör listorna till "Officiella resultat" och ger IOF-filen för Eventor. "Gör resultaten preliminära igen"
 * ångrar; fastställandena själva ändras aldrig. Ett hinder (resultat som saknas, okänd bricka …) är ett vanligt svar.
 */
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const resultsOfficialRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, action: z.enum(["OFFICIAL", "PRELIMINARY"])
}).strict();

const blockers = z.array(resultFinalizationBlockerCodeSchema).max(32);
export const resultsOfficialOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("OFFICIAL"), finalization: raceResultFinalizationMetadataSchema }).strict(),
  z.object({ outcome: z.literal("PRELIMINARY") }).strict(),
  z.object({ outcome: z.literal("BLOCKED"), raceBlockers: blockers,
    classes: z.array(z.object({ classId: uuid, className: z.string().min(1).max(160), blockerCodes: blockers.min(1) }).strict()).max(1_000)
  }).strict()
]);

export const resultsOfficialResponseSchema = z.object({
  formatVersion: z.literal(1), replayed: z.boolean(), requestId: uuid, raceId: uuid, savedAt: instant,
  request: resultsOfficialRequestSchema, result: resultsOfficialOutcomeSchema
}).strict();

/** Läget för knappen: aldrig klara, klara och oförändrade, eller klara men ändrade efteråt (visas som preliminära). */
export const resultsOfficialStateSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  official: z.object({ finalizationId: uuid, finalizedAt: instant, current: z.boolean() }).strict().nullable()
}).strict();

export type ResultsOfficialRequest = z.infer<typeof resultsOfficialRequestSchema>;
export type ResultsOfficialOutcome = z.infer<typeof resultsOfficialOutcomeSchema>;
export type ResultsOfficialResponse = z.infer<typeof resultsOfficialResponseSchema>;
export type ResultsOfficialState = z.infer<typeof resultsOfficialStateSchema>;
