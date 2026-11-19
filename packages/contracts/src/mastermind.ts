import { z } from "zod";
import { uuidSchema as uuid } from "./ids";

/**
 * Mastermind med kontroller (ADR-0228). Datorn vid stationen skickar hela sitt läge för träningen (inställningarna, alla spel
 * och lagens namn) och får tillbaka serverns sammanslagna läge, så att flera datorer ser varandras spel. Servern kontrollerar
 * spelen och räknar om gissningarnas svar ur mönstret (`normalizeGame` i `@o-tid/domain/mastermind`); schemat här sätter bara
 * gränserna.
 */
export const MASTERMIND_GAMES_MAX = 1000;
const NAMES_MAX = 1000;

const instant = z.iso.datetime({ offset: true });
const color = z.number().int().min(0).max(7);

export const mastermindSettingsSchema = z.object({
  codes: z.array(z.number().int().min(1).max(999)).min(4).max(8),
  positions: z.number().int().min(3).max(6),
  maxGuesses: z.number().int().min(1).max(20),
  allowRepeats: z.boolean()
});

const game = z.object({
  id: uuid,
  cardNumber: z.number().int().min(1).max(99_999_999),
  secret: z.array(color).min(3).max(6),
  guesses: z.array(z.object({ colors: z.array(color).min(3).max(6), score: z.object({ exact: z.number().int().min(0), colorOnly: z.number().int().min(0) }),
    at: instant })).max(20),
  startedAt: instant,
  settings: mastermindSettingsSchema,
  marker: z.object({ count: z.number().int().min(0).max(1000), code: z.number().int().min(0).max(65_535), time: z.string().max(200).optional(),
    at: instant.optional() }).optional(),
  finishedAt: instant.optional(),
  abandonedAt: instant.optional()
});

/** Lagets namn per bricknummer och när det ändrades; ett tomt namn tar bort det. */
const names = z.record(z.string().regex(/^[1-9][0-9]{0,7}$/), z.object({ name: z.string().max(40), at: instant }))
  .refine(value => Object.keys(value).length <= NAMES_MAX);

export const mastermindStateSchema = z.object({
  formatVersion: z.literal(1),
  settings: mastermindSettingsSchema,
  settingsAt: instant.optional(),
  games: z.array(game).max(MASTERMIND_GAMES_MAX),
  names
});

/**
 * Serverns läge efter sammanslagningen, för träningen `raceId`. `openStations`: "Spela på egen dator" är påslaget;
 * `canOpen`: den inloggade får slå på och av det (administratören).
 */
export const mastermindSyncResponseSchema = mastermindStateSchema.extend({ raceId: uuid, openStations: z.boolean(), canOpen: z.boolean() });
export type MastermindSyncResponse = z.infer<typeof mastermindSyncResponseSchema>;

/**
 * Den publika ställningen (bara träningsdagen): lagets namn och brickans tre sista siffror (aldrig hela bricknumret), inga
 * mönster och inga gissningar. `place` för lösta spel; `startedAt` för spel som pågår (den löpande tiden).
 */
export const mastermindStandingsSchema = z.object({
  formatVersion: z.literal(1),
  /** "Spela på egen dator" är påslaget: tävlingssidan visar knappen. */
  openStations: z.boolean(),
  rows: z.array(z.object({
    name: z.string().optional(),
    cardEnd: z.string().regex(/^[0-9]{1,3}$/),
    status: z.enum(["playing", "won", "lost"]),
    guesses: z.number().int().min(0),
    place: z.number().int().min(1).optional(),
    durationMs: z.number().int().min(0).optional(),
    startedAt: instant.optional()
  }))
});
export type MastermindStandings = z.infer<typeof mastermindStandingsSchema>;

/** Administratören slår på eller av "Spela på egen dator" (knappen på tävlingssidan). */
export const mastermindOpenStationsRequestSchema = z.object({ formatVersion: z.literal(1), open: z.boolean() });

/** Datorns nyckel (slumpad i webbläsaren, sparad där); servern lagrar bara dess hash. */
export const mastermindStationKeySchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

/**
 * En dator utan inloggning ("Spela på egen dator", ADR-0228): dess egna spel och namnen på dess brickor. Inställningarna är
 * träningens (servern skickar dem). `website` är en fälla mot robotar (ett dolt fält).
 */
export const mastermindStationRequestSchema = z.object({
  formatVersion: z.literal(1),
  stationKey: mastermindStationKeySchema,
  games: z.array(game).max(MASTERMIND_GAMES_MAX),
  names,
  website: z.string().max(200).optional()
});

/** Svaret till en dator utan inloggning: träningen, dess inställningar och bara datorns egna spel och namn. */
export const mastermindStationResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  eventName: z.string(),
  raceName: z.string(),
  shortCode: z.string(),
  settings: mastermindSettingsSchema,
  games: z.array(game).max(MASTERMIND_GAMES_MAX),
  names
});
export type MastermindStationResponse = z.infer<typeof mastermindStationResponseSchema>;
