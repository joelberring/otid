import { z } from "zod";

/**
 * Radiokontroller via ROC eller OResults (ADR-0172 beslut 5, PLAN.md steg 20). Admin kopplar tävlingen till
 * en enhet och väljer radiokontroller; servern hämtar stämplingarna. Publikt syns mellantider och placeringar
 * vid radiokontrollerna, aldrig bricknummer.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().min(0).max(2_147_483_647);

export const radioSources = ["ROC", "ORESULTS"] as const;
export const radioSourceSchema = z.enum(radioSources);
export type RadioSource = z.infer<typeof radioSourceSchema>;

/** Varför senaste hämtningen misslyckades. Texterna finns i i18n. */
export const radioErrorCodes = ["INVALID_INPUT", "INVALID_RESPONSE", "UPSTREAM_UNAVAILABLE", "REJECTED", "NOT_FOUND",
  "RESPONSE_TOO_LARGE", "TIMEOUT"] as const;
export const radioErrorCodeSchema = z.enum(radioErrorCodes);
export type RadioErrorCode = z.infer<typeof radioErrorCodeSchema>;

export const radioControlCodeSchema = z.number().int().min(1).max(9_999);
export const radioUnitIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** En radiokontroll: kontrollkoden och ett valfritt namn ("Radio 1", "Förvarning"). */
export const radioControlSchema = z.object({
  code: radioControlCodeSchema,
  label: z.string().trim().min(1).max(40).nullable()
}).strict();
export type RadioControl = z.infer<typeof radioControlSchema>;

export const radioSettingsRequestSchema = z.object({
  formatVersion: z.literal(1),
  source: radioSourceSchema,
  unitId: radioUnitIdSchema,
  enabled: z.boolean(),
  controls: z.array(radioControlSchema).max(30)
    .refine(controls => new Set(controls.map(control => control.code)).size === controls.length, "Samma kontroll två gånger")
}).strict();
export type RadioSettingsRequest = z.infer<typeof radioSettingsRequestSchema>;

/**
 * Hämtningens läge. OFF: avstängd. TODAY: hämtar automatiskt (tävlingsdagen i tävlingens tidszon).
 * NOT_TODAY: påslagen men inte tävlingsdagen; "Hämta nu" fungerar ändå.
 */
export const radioPollingSchema = z.enum(["OFF", "TODAY", "NOT_TODAY"]);

export const radioStatusSchema = z.object({
  polling: radioPollingSchema,
  lastAttemptAt: instant.nullable(),
  lastSuccessAt: instant.nullable(),
  lastError: radioErrorCodeSchema.nullable(),
  lastErrorAt: instant.nullable(),
  consecutiveFailures: count,
  lastPunchId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  /** Sparade stämplingar, de som hör till en anmäld bricka, okända brickor och kontroller som inte är radiokontroller. */
  punches: count,
  matchedPunches: count,
  unknownCards: count,
  otherControls: count,
  malformedLines: count
}).strict();
export type RadioStatus = z.infer<typeof radioStatusSchema>;

/** Senaste radiostämplingarna för admin, även okända brickor. */
export const radioAdminPunchSchema = z.object({
  controlCode: radioControlCodeSchema,
  cardNumber: z.string().regex(/^[1-9]\d{0,7}$/),
  punchedAt: instant,
  runner: z.string().max(321).nullable(),
  className: z.string().max(160).nullable()
}).strict();

export const radioSettingsResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  raceDate: z.iso.date(),
  timeZone: z.string().min(1).max(64),
  link: z.object({ source: radioSourceSchema, unitId: radioUnitIdSchema, enabled: z.boolean(), controls: z.array(radioControlSchema).max(30) })
    .strict().nullable(),
  status: radioStatusSchema.nullable(),
  /** Kontrollerna i tävlingens banor att välja bland, med banorna som har dem. */
  candidates: z.array(z.object({ code: radioControlCodeSchema, courses: z.array(z.string().max(160)).max(500) }).strict()).max(2_000),
  /** Tävlingen har stafettklasser: deras löpare får inga mellantider än. */
  relay: z.boolean(),
  latest: z.array(radioAdminPunchSchema).max(50)
}).strict();
export type RadioSettingsResponse = z.infer<typeof radioSettingsResponseSchema>;

export const radioFetchResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  /** FETCHED: hämtningen lyckades (kanske utan nya stämplingar). NOT_CONFIGURED: ingen koppling sparad. */
  outcome: z.union([z.literal("FETCHED"), z.literal("NOT_CONFIGURED"), radioErrorCodeSchema]),
  newPunches: count,
  settings: radioSettingsResponseSchema
}).strict();
export type RadioFetchResponse = z.infer<typeof radioFetchResponseSchema>;

/** En löpares passage vid en radiokontroll, publikt. */
export const publicRadioPassageSchema = z.object({
  /** Löparens publika id (länk till resultatsidan när löparen har ett resultat). */
  publicResultId: uuid,
  givenName: z.string().max(160),
  familyName: z.string().max(160),
  organisationName: z.string().max(240).nullable(),
  className: z.string().max(160),
  controlCode: radioControlCodeSchema,
  label: z.string().max(40).nullable(),
  /** När löparen passerade, om det är känt. */
  passedAt: instant.nullable(),
  /** Tid sedan start, om starttiden är känd. */
  elapsedMs: z.number().int().min(0).max(7 * 86_400_000).nullable(),
  /** Placering vid kontrollen i klassen (preliminär för den som inte är avläst). */
  place: z.number().int().min(1).max(100_000).nullable(),
  finished: z.boolean()
}).strict();
export type PublicRadioPassage = z.infer<typeof publicRadioPassageSchema>;

export const publicRadioResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  /** Radion är påslagen för tävlingen. */
  enabled: z.boolean(),
  timeZone: z.string().min(1).max(64),
  classes: z.array(z.object({
    className: z.string().max(160),
    controls: z.array(z.object({ controlCode: radioControlCodeSchema, label: z.string().max(40).nullable(),
      passages: z.array(publicRadioPassageSchema).max(10_000) }).strict()).max(50),
    /** Inte avlästa löpare som passerat en radiokontroll: den senaste passagen. */
    onTheWay: z.array(publicRadioPassageSchema).max(10_000)
  }).strict()).max(1_000),
  /** Senaste radiostämplingarna i tävlingen, nyaste först. */
  latest: z.array(publicRadioPassageSchema).max(50)
}).strict();
export type PublicRadioResponse = z.infer<typeof publicRadioResponseSchema>;
