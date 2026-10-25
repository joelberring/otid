import { z } from "zod";
import { uuidSchema as uuid } from "./ids";
import { publicRadioPassageSchema } from "./radio";

/**
 * Live för publiken (PLAN.md steg 30): senast i mål, ledare per klass och radiopassager, utan inloggning. En egen,
 * smal projektion: inga bricknummer, inga interna id:n, inga strukna löpare och inga tekniska orsaker – bara det som
 * resultatlistan redan visar, med tidpunkten då resultatet kom in.
 */
const instant = z.iso.datetime({ precision: 3 });
const milliseconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const runner = {
  /** Löparens publika id (samma som resultatlistans länk); nyckeln när någon följer löparen. */
  publicResultId: uuid,
  givenName: z.string().trim().min(1).max(160),
  familyName: z.string().trim().min(1).max(160),
  organisationName: z.string().trim().min(1).max(240).nullable(),
  className: z.string().trim().min(1).max(160)
};

/** Status som publiken ser i Live. Ej start och ej fullföljt är inte målgångar och finns inte här. */
export const publicLiveStatusSchema = z.enum(["OK", "OVERTIME", "MP", "DSQ", "OOC", "NT"]);

export const publicLiveFinishSchema = z.object({
  ...runner,
  /** När resultatet kom in (första avläsningen), i UTC. */
  finishedAt: instant,
  status: publicLiveStatusSchema,
  /** Löptiden för godkänd, maxtid och utom tävlan; aldrig för felstämplad eller disk. */
  elapsedMs: milliseconds.optional(),
  /** Placering i klassen, bara för godkända som rangordnas. */
  place: z.number().int().min(1).max(10_000).optional(),
  /** Rogaining: summan poäng. */
  points: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  /** Steg 47: stafettsträcka – laget och sträckan; placeringen är sträckans. */
  relay: z.object({ teamNumber: z.number().int().min(1).max(99_999), teamName: z.string().max(160), leg: z.number().int().min(1).max(30) })
    .strict().optional()
}).strict().superRefine((row, context) => {
  if (row.place !== undefined && row.status !== "OK") context.addIssue({ code: "custom", path: ["place"], message: "Bara godkända har placering" });
  if (row.elapsedMs !== undefined && row.status !== "OK" && row.status !== "OVERTIME" && row.status !== "OOC") {
    context.addIssue({ code: "custom", path: ["elapsedMs"], message: "Tiden visas bara för godkänd, maxtid och utom tävlan" });
  }
});

export const publicLiveLeaderSchema = z.object({
  ...runner,
  elapsedMs: milliseconds,
  points: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  /** När ledarens resultat kom in. */
  since: instant.nullable(),
  /** Ledaren kom in inom `newLeaderWindowMs` före `generatedAt`. */
  newLeader: z.boolean()
}).strict();

export const publicLiveResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  generatedAt: instant,
  timeZone: z.string().trim().min(1).max(100),
  newLeaderWindowMs: z.number().int().min(0).max(3_600_000),
  /** Alla målgångar, nyaste först. Sidan visar de senaste och letar upp de följda här. */
  finishes: z.array(publicLiveFinishSchema).max(10_000),
  /** Ledaren (vid delad förstaplats flera) per klass, klasserna i namnordning. */
  leaders: z.array(publicLiveLeaderSchema).max(10_000),
  radio: z.object({
    enabled: z.boolean(),
    /** Senaste passagerna, nyaste först. */
    latest: z.array(publicRadioPassageSchema).max(50),
    /** Löpare som passerat en radiokontroll men inte läst av: senaste passagen. */
    onTheWay: z.array(publicRadioPassageSchema).max(10_000)
  }).strict()
}).strict();

export type PublicLiveStatus = z.infer<typeof publicLiveStatusSchema>;
export type PublicLiveFinish = z.infer<typeof publicLiveFinishSchema>;
export type PublicLiveLeader = z.infer<typeof publicLiveLeaderSchema>;
export type PublicLiveResponse = z.infer<typeof publicLiveResponseSchema>;
