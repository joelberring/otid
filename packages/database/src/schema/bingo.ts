import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { races } from "./core";

/** Bingoorientering med telefonen (ADR-0225, migration 0125): påslagen för tävlingen. Rutnätet står i banläggningens dokument. */
export const bingoRaces = pgTable("bingo_race", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull(),
  enabledBy: uuid("enabled_by").notNull()
});

/** Ruta tagen: rutans namn och tiden (ms sedan 1970). */
export type BingoTakenRow = { cell: string; at: number };

/**
 * En löpare som anmält sig på plats utan konto (ADR-0225). `clientId` är telefonens id för loppet; spåret är `[x, y, sekund]`
 * i kartans mm (förenklat) och glappen `[från, till]` i sekunder från start. Spåret läses bara av admin.
 */
export const bingoRunners = pgTable("bingo_runner", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  clientId: uuid("client_id").notNull(),
  name: text("name").notNull(),
  groupCourse: text("group_course").notNull(),
  groupName: text("group_name").notNull(),
  status: text("status").$type<"RUNNING" | "FINISHED" | "ABANDONED">().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  distanceM: integer("distance_m").notNull(),
  taken: jsonb("taken").$type<BingoTakenRow[]>().notNull(),
  track: jsonb("track").$type<[number, number, number][]>().notNull(),
  gaps: jsonb("gaps").$type<[number, number][]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, table => [uniqueIndex("bingo_runner_client_uidx").on(table.raceId, table.clientId)]);
