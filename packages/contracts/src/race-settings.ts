import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * ADR-0170 beslut 1: tävlingstypen väljs när tävlingen skapas och kan ändras under Inställningar.
 * Typen styr bara vad arbetsytan visar och vilka förval som gäller; inga data tas bort.
 */
export const raceTypes = ["TRAINING", "SMALL", "STANDARD", "FORKED", "RELAY", "ROGAINING"] as const;
export const raceTypeSchema = z.enum(raceTypes);
export type RaceType = z.infer<typeof raceTypeSchema>;

const name = z.string().trim().min(2).max(160);

/** Inställningar: tävlingens namn, loppets namn, datum och typ. Sparas direkt (inget resultat ändras). */
export const raceSettingsRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
    eventName: name,
  raceName: name,
  raceDate: z.iso.date(),
  raceType: raceTypeSchema
}).strict();
export const raceSettingsIdempotencyKeySchema = z.string().regex(/^race-settings:[0-9a-f-]{36}$/);

export const raceSettingsResponseSchema = z.object({
  formatVersion: z.literal(1),
  replayed: z.boolean(),
  requestId: uuid,
  raceId: uuid,
  request: raceSettingsRequestSchema,
  snapshotVersionAfter: z.number().int().min(1).max(2_147_483_647),
  savedAt: z.iso.datetime({ offset: true })
}).strict();

export type RaceSettingsRequest = z.infer<typeof raceSettingsRequestSchema>;
export type RaceSettingsResponse = z.infer<typeof raceSettingsResponseSchema>;
