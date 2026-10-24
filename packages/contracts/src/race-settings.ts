import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * ADR-0170 beslut 1: tävlingstypen väljs när tävlingen skapas och kan ändras under Inställningar.
 * Typen styr bara vad arbetsytan visar och vilka förval som gäller; inga data tas bort.
 */
export const raceTypes = ["TRAINING", "SMALL", "STANDARD", "FORKED", "RELAY", "ROGAINING", "PARTY"] as const;
export const raceTypeSchema = z.enum(raceTypes);
export type RaceType = z.infer<typeof raceTypeSchema>;

const name = z.string().trim().min(2).max(160);

/**
 * Steg 33: kort info om tävlingen. Ren text (ingen HTML eller markdown), radbrytningar bevaras, högst 1000 tecken.
 * Inga styrtecken utom radbrytning och tab; inga inledande eller avslutande blanksteg.
 */
export const raceInfoSchema = z.string().min(1).max(1000)
  // eslint-disable-next-line no-control-regex
  .refine(value => value === value.trim() && !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(value));
/** Steg 33: första start som klockslag på tävlingsdagen (HH:MM). Bara information. */
export const raceFirstStartTimeSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

/** Inställningar: tävlingens namn, loppets namn, datum, typ, bricka i publik startlista, kort info och första start. Sparas direkt (inget resultat ändras). */
export const raceSettingsRequestSchema = z.object({
  formatVersion: z.literal(1),
  requestId: uuid,
  eventName: name,
  raceName: name,
  raceDate: z.iso.date(),
  raceType: raceTypeSchema,
  /** Steg 33. Saknas i förfrågningar sparade före steg 33; då ändras inte värdet. */
  publicStartListCardNumbers: z.boolean().optional(),
  info: raceInfoSchema.nullable().optional(),
  firstStartTime: raceFirstStartTimeSchema.nullable().optional(),
  /** "Uppdatera startlistan löpande" (Start → Publicera startlistan). Saknas = oförändrad. */
  startListLive: z.boolean().optional()
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
