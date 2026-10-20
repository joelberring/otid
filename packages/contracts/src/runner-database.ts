import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * PLAN.md steg 29: löpardatabasen från Eventor. Den lagras per Eventor-organisation (klubben som tävlingens nyckel
 * tillhör) och delas av klubbens tävlingar. Bara administratören uppdaterar och raderar; administratören och
 * funktionären får förslag (avläsningssidan, Ny deltagare). Inget av detta finns i publika svar.
 */
export const eventorIdSchema = z.string().regex(/^[0-9A-Za-z_-]{1,64}$/);
const name = z.string().trim().min(1).max(160);
const cardNumber = z.string().regex(/^[1-9][0-9]{0,8}$/);
const count = z.number().int().min(0).max(1_000_000);

export const runnerClubTypeSchema = z.enum(["FEDERATION", "DISTRICT", "CLUB", "OTHER"]);
export const runnerSexSchema = z.enum(["F", "M"]);

/** Gränser för avläsningspaketets del (offline). Resten av en större databas söks på servern när nätet finns. */
export const RUNNER_LOOKUP_LIMITS = { runners: 10_000, clubs: 5_000, cardsPerRunner: 20 } as const;
export const MAX_EXTRA_ORGANISATIONS = 49;

export const runnerClubSchema = z.object({ id: eventorIdSchema, name, shortName: name.optional(), type: runnerClubTypeSchema }).strict();

/** En löpare i förslagen: Eventors person-id, namn, födelseår, kön, klubb (med Eventors id) och SI-brickor. */
export const runnerSuggestionSchema = z.object({
  personId: eventorIdSchema.optional(),
  givenName: name,
  familyName: name,
  birthYear: z.number().int().min(1900).max(2100).optional(),
  sex: runnerSexSchema.optional(),
  clubId: eventorIdSchema.optional(),
  club: name.optional(),
  cards: z.array(cardNumber).max(RUNNER_LOOKUP_LIMITS.cardsPerRunner)
}).strict();

/**
 * Avläsningspaketets uppslag (offline): den egna klubbens och de tillagda klubbarnas löpare och Eventors klubbar.
 * `wholeCountryOnServer`: hela landets löpare finns på servern och söks där när nätet finns. `truncated`: fler löpare
 * än gränsen; paketet har den egna klubben först.
 */
export const runnerLookupSchema = z.object({
  organisationName: name,
  refreshedAt: z.iso.datetime({ offset: true }),
  wholeCountryOnServer: z.boolean(),
  truncated: z.boolean(),
  clubs: z.array(runnerClubSchema).max(RUNNER_LOOKUP_LIMITS.clubs),
  runners: z.array(runnerSuggestionSchema).max(RUNNER_LOOKUP_LIMITS.runners)
}).strict();

const database = z.object({
  refreshedAt: z.iso.datetime({ offset: true }),
  competitorCount: count,
  cardCount: count,
  clubCount: count,
  wholeCountry: z.boolean(),
  extraClubs: z.array(z.object({ id: eventorIdSchema, name: name.nullable() }).strict()).max(MAX_EXTRA_ORGANISATIONS),
  /** Löpare i avläsningspaketet (offline) och om fler fanns än gränsen. */
  offlineCount: count,
  offlineTruncated: z.boolean()
}).strict();

/** Inställningar → Eventor → Löpardatabasen. Utan klubb (nyckeln ej testad) finns ingen databas att visa. */
export const runnerDatabaseSettingsResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  organisation: z.object({ id: eventorIdSchema, name }).strict().nullable(),
  database: database.nullable()
}).strict();

export const runnerDatabaseRefreshRequestSchema = z.object({
  formatVersion: z.literal(1),
  /** Hela landets löpare (stor hämtning). */
  wholeCountry: z.boolean(),
  /** Klubbar utöver den egna (Eventors id). */
  extraOrganisationIds: z.array(eventorIdSchema).max(MAX_EXTRA_ORGANISATIONS)
    .refine((ids) => new Set(ids).size === ids.length, "Klubbarna måste vara unika")
}).strict();

export const runnerDatabaseRefreshOutcomeSchema = z.enum(["REFRESHED", "NO_ORGANISATION", "NOT_CONFIGURED", "NO_KEY", "KEY_UNREADABLE",
  "REJECTED", "UNAVAILABLE", "TOO_LARGE"]);

export const runnerDatabaseRefreshResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  outcome: runnerDatabaseRefreshOutcomeSchema,
  settings: runnerDatabaseSettingsResponseSchema
}).strict();

/** Sökning (Ny deltagare och avläsningssidan när nätet finns): bricka, namn eller klubb. */
export const runnerSearchRequestSchema = z.discriminatedUnion("kind", [
  z.object({ formatVersion: z.literal(1), kind: z.literal("CARD"), cardNumber }).strict(),
  z.object({ formatVersion: z.literal(1), kind: z.literal("NAME"), text: z.string().trim().min(2).max(80) }).strict(),
  z.object({ formatVersion: z.literal(1), kind: z.literal("CLUB"), text: z.string().trim().min(1).max(80) }).strict()
]);

export const RUNNER_SEARCH_LIMIT = 12;

export const runnerSearchResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  runners: z.array(runnerSuggestionSchema).max(RUNNER_SEARCH_LIMIT),
  clubs: z.array(runnerClubSchema).max(RUNNER_SEARCH_LIMIT)
}).strict();

export type RunnerClub = z.infer<typeof runnerClubSchema>;
export type RunnerSuggestion = z.infer<typeof runnerSuggestionSchema>;
export type RunnerLookup = z.infer<typeof runnerLookupSchema>;
export type RunnerDatabaseSettingsResponse = z.infer<typeof runnerDatabaseSettingsResponseSchema>;
export type RunnerDatabaseRefreshRequest = z.infer<typeof runnerDatabaseRefreshRequestSchema>;
export type RunnerDatabaseRefreshOutcome = z.infer<typeof runnerDatabaseRefreshOutcomeSchema>;
export type RunnerDatabaseRefreshResponse = z.infer<typeof runnerDatabaseRefreshResponseSchema>;
export type RunnerSearchRequest = z.infer<typeof runnerSearchRequestSchema>;
export type RunnerSearchResponse = z.infer<typeof runnerSearchResponseSchema>;
