import { z } from "zod";
import { uuidSchema as uuid } from "./ids";
import { raceNameSchema } from "./race-name";

/**
 * ADR-0170 beslut 1: tävlingstypen väljs när tävlingen skapas och kan ändras under Inställningar.
 * Typen styr bara vad arbetsytan visar och vilka förval som gäller; inga data tas bort.
 */
export const raceTypes = ["TRAINING", "SMALL", "STANDARD", "FORKED", "RELAY", "ROGAINING", "PARTY"] as const;
export const raceTypeSchema = z.enum(raceTypes);
export type RaceType = z.infer<typeof raceTypeSchema>;

/**
 * ADR-0188 beslut 5: "Tävling med gafflade banor" är en del av Tävling; gaffling följer av banorna. `FORKED` finns kvar som
 * alias (befintliga tävlingar och äldre klienter) och behandlas som `STANDARD` överallt. Typerna att välja bland saknar den.
 */
export function normalizeRaceType<T extends RaceType>(raceType: T): Exclude<T, "FORKED"> | "STANDARD" {
  return (raceType === "FORKED" ? "STANDARD" : raceType) as Exclude<T, "FORKED"> | "STANDARD";
}
export const selectableRaceTypes = raceTypes.filter(type => type !== "FORKED") as readonly Exclude<RaceType, "FORKED">[];

/**
 * ADR-0188 beslut 4: startsättet för klasser som skapas från en banfil eller Eventor. En vanlig Tävling lottas (fast start);
 * fri start är naturlig för Träning, Liten tävling, Rogaining och Fest. Stafettklasser har egna regler.
 */
export function defaultStartRule(raceType: RaceType): "FIXED" | "PUNCH" {
  return normalizeRaceType(raceType) === "STANDARD" ? "FIXED" : "PUNCH";
}

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
  raceName: raceNameSchema,
  raceDate: z.iso.date(),
  raceType: raceTypeSchema,
  /** Steg 33. Saknas i förfrågningar sparade före steg 33; då ändras inte värdet. */
  publicStartListCardNumbers: z.boolean().optional(),
  info: raceInfoSchema.nullable().optional(),
  firstStartTime: raceFirstStartTimeSchema.nullable().optional(),
  /** "Uppdatera startlistan löpande" (Start → Publicera startlistan). Saknas = oförändrad. */
  startListLive: z.boolean().optional(),
  /** Steg 41: "Tillåt självregistrering på tävlingsdagen". Saknas = oförändrad. */
  selfRegistration: z.boolean().optional(),
  /**
   * ADR-0188 beslut 3: nytt datum när det finns starttider. Sant = arrangören har sett förhandsvisningen och starttiderna
   * flyttas till det nya datumet med samma klockslag. Utan det avvisas ett nytt datum när det finns starttider.
   */
  moveStartTimes: z.boolean().optional()
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

/**
 * ADR-0188 beslut 3: vad som händer om tävlingen flyttas till ett annat datum. Läser bara. `blocked` säger varför det inte
 * går: avläsningar, radiostämplingar, incheckning vid starten eller resultat.
 */
export const raceDateMovePreviewRequestSchema = z.object({ formatVersion: z.literal(1), raceDate: z.iso.date() }).strict();
export const raceDateMoveBlockSchema = z.enum(["READOUTS", "PUNCHES", "CHECKINS", "RESULTS"]);
const moveInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const moveCount = z.number().int().nonnegative().max(1_000_000);
export const raceDateMovePreviewResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: z.number().int().min(1).max(2_147_483_647),
  fromDate: z.iso.date(), toDate: z.iso.date(), timeZone: z.string().min(1).max(100),
  /** Löpare med fast starttid, lottade klasser och stafettsträckor med masstart eller omstart som flyttas. */
  startTimeCount: moveCount, drawClassCount: moveCount, relayLegCount: moveCount,
  /** Första och sista starttid före och efter flytten; null utan starttider. */
  firstBefore: moveInstant.nullable(), lastBefore: moveInstant.nullable(), firstAfter: moveInstant.nullable(), lastAfter: moveInstant.nullable(),
  /** Startlistan är publicerad och behöver publiceras igen. */
  startListPublished: z.boolean(),
  blocked: z.array(raceDateMoveBlockSchema).max(4)
}).strict();
export type RaceDateMovePreviewRequest = z.infer<typeof raceDateMovePreviewRequestSchema>;
export type RaceDateMovePreviewResponse = z.infer<typeof raceDateMovePreviewResponseSchema>;
export type RaceDateMoveBlock = z.infer<typeof raceDateMoveBlockSchema>;
