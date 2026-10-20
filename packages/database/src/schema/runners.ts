import { boolean, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Löpardatabasen från Eventor (migration 0008, PLAN.md steg 29). En per Eventor-organisation (klubben som nyckeln
 * tillhör), delad av alla tävlingar som är kopplade till klubben. Ersätts helt vid varje uppdatering; raderas med
 * knappen eller när organisationen tas bort (ON DELETE CASCADE). Bara admin och funktionärer läser den, aldrig publikt.
 */
export const runnerDatabases = pgTable("runner_database", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventorOrganisationId: text("eventor_organisation_id").notNull(),
  organisationName: text("organisation_name").notNull(),
  extraOrganisationIds: text("extra_organisation_ids").array().notNull().default([]),
  wholeCountry: boolean("whole_country").notNull().default(false),
  competitorCount: integer("competitor_count").notNull(),
  cardCount: integer("card_count").notNull(),
  clubCount: integer("club_count").notNull(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("runner_database_organisation_uidx").on(table.eventorOrganisationId)]);

/** En löpare: födelseår (inte datum), kön, klubb och SPORTident-brickor. */
export const runnerDatabaseCompetitors = pgTable("runner_database_competitor", {
  id: uuid("id").primaryKey().defaultRandom(),
  runnerDatabaseId: uuid("runner_database_id").notNull().references(() => runnerDatabases.id, { onDelete: "cascade" }),
  eventorPersonId: text("eventor_person_id"),
  givenName: text("given_name").notNull(),
  familyName: text("family_name").notNull(),
  birthYear: smallint("birth_year"),
  sex: text("sex").$type<"F" | "M">(),
  clubEventorId: text("club_eventor_id"),
  clubName: text("club_name"),
  clubShortName: text("club_short_name"),
  cardNumbers: text("card_numbers").array().notNull().default([])
}, (table) => [
  uniqueIndex("runner_database_competitor_person_uidx").on(table.runnerDatabaseId, table.eventorPersonId),
  index("runner_database_competitor_club_idx").on(table.runnerDatabaseId, table.clubEventorId)
]);

/** Organisationerna i Eventor för klubbfältets förslag; typen är adapterns tolkning (inte provad mot riktiga Eventor). */
export const runnerDatabaseClubs = pgTable("runner_database_club", {
  id: uuid("id").primaryKey().defaultRandom(),
  runnerDatabaseId: uuid("runner_database_id").notNull().references(() => runnerDatabases.id, { onDelete: "cascade" }),
  eventorId: text("eventor_id").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  type: text("type").$type<"FEDERATION" | "DISTRICT" | "CLUB" | "OTHER">().notNull()
}, (table) => [uniqueIndex("runner_database_club_uidx").on(table.runnerDatabaseId, table.eventorId)]);
