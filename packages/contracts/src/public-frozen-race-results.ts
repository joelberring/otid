import { z } from "zod";

const safeMillisecondsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const publicFrozenRaceResultStatusSchema = z.enum(["OK", "MP", "DSQ", "DNF", "OOC", "DNS"]);

export const publicFrozenRaceResultSchema = z.object({
  className: z.string().trim().min(1).max(160),
  givenName: z.string().trim().min(1).max(160),
  familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  status: publicFrozenRaceResultStatusSchema,
  elapsedMs: safeMillisecondsSchema.nullable(),
  position: z.number().int().positive().max(10_000).nullable(),
  timeBehindMs: safeMillisecondsSchema.nullable()
}).strict().superRefine((result, context) => {
  const hasPosition = result.position !== null;
  const hasTimeBehind = result.timeBehindMs !== null;
  if (hasPosition !== hasTimeBehind) {
    context.addIssue({ code: "custom", path: ["position"], message: "Placering och tid efter måste förekomma tillsammans" });
  }
  if (result.status === "OK" && (result.elapsedMs === null || !hasPosition)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Fastställt OK kräver tid och ranking" });
  }
  if (result.status !== "OK" && (hasPosition || hasTimeBehind)) {
    context.addIssue({ code: "custom", path: ["position"], message: "Orankat fastställt resultat får inte ha ranking" });
  }
  if ((result.status === "DNS" || result.status === "DNF") && result.elapsedMs !== null) {
    context.addIssue({ code: "custom", path: ["elapsedMs"], message: "Fastställt DNS/DNF måste sakna tid" });
  }
  if (result.elapsedMs !== null && result.timeBehindMs !== null && result.timeBehindMs > result.elapsedMs) {
    context.addIssue({ code: "custom", path: ["timeBehindMs"], message: "Tid efter får inte överstiga totaltiden" });
  }
});

/** A deliberately narrow read model for one immutable RACE finalization. */
export const publicFrozenRaceResultsResponseSchema = z.object({
  formatVersion: z.literal(1),
  eventName: z.string().trim().min(1).max(160),
  finalizedAt: z.iso.datetime({ offset: true }),
  results: z.array(publicFrozenRaceResultSchema).min(1).max(10_000)
}).strict();

export type PublicFrozenRaceResult = z.infer<typeof publicFrozenRaceResultSchema>;
export type PublicFrozenRaceResultsResponse = z.infer<typeof publicFrozenRaceResultsResponseSchema>;
