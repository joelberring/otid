import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { races } from "./core";

/** Inställningarna för Mastermind med kontroller (samma form som `GameSettings` i `@o-tid/domain/mastermind`). */
export type MastermindSettingsRow = { codes: number[]; positions: number; maxGuesses: number; allowRepeats: boolean };
/** En gissning: färgernas index, svaret (räknat på servern) och utläsningens tid (ISO). */
export type MastermindGuessRow = { colors: number[]; score: { exact: number; colorOnly: number }; at: string };
/** Den senaste utlästa stämplingen på brickan och när den lästes ut. */
export type MastermindMarkerRow = { count: number; code: number; time?: string; at?: string };

/** Mastermind med kontroller (ADR-0228, migration 0131): träningens inställningar och lagens namn. */
export const mastermindRaces = pgTable("mastermind_race", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  settings: jsonb("settings").$type<MastermindSettingsRow>().notNull(),
  settingsAt: timestamp("settings_at", { withTimezone: true }),
  names: jsonb("names").$type<Record<string, { name: string; at: string }>>().notNull(),
  /** "Spela på egen dator" är påslaget (av administratören); NULL = av. */
  openStationsAt: timestamp("open_stations_at", { withTimezone: true }),
  openStationsBy: uuid("open_stations_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

/** Ett spel på en bricka. `id` är datorns id för spelet; nyckeln är tävling + id. */
export const mastermindGames = pgTable("mastermind_game", {
  raceId: uuid("race_id").notNull().references(() => races.id),
  id: uuid("id").notNull(),
  cardNumber: integer("card_number").notNull(),
  status: text("status").$type<"playing" | "won" | "lost" | "abandoned">().notNull(),
  secret: jsonb("secret").$type<number[]>().notNull(),
  settings: jsonb("settings").$type<MastermindSettingsRow>().notNull(),
  guesses: jsonb("guesses").$type<MastermindGuessRow[]>().notNull(),
  marker: jsonb("marker").$type<MastermindMarkerRow>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
  /** Spelet kom från en dator utan inloggning (SHA-256 av datorns nyckel); NULL = arrangörens eller funktionärens dator. */
  stationKeyHash: text("station_key_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, table => [primaryKey({ columns: [table.raceId, table.id] })]);
