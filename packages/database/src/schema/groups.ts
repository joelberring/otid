import { boolean, date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userAccounts } from "./accounts";
import { races } from "./core";

/**
 * Steg 68 (ADR-0182, migration 0035): träningsgrupper. Kartbibliotekets bilder och filer (bytea) kopieras med SQL i
 * application och finns därför inte här; tabellerna nedan har de kolumner som läses och skrivs med Drizzle.
 */
export type TrainingGroupPageVisibility = "LINK" | "MEMBERS";
export type TrainingGroupNameDisplay = "FIRST" | "FULL" | "NONE";
export type TrainingGroupStatsVisibility = "LEADERS" | "MEMBERS";
export type TrainingGroupPointsMode = "NONE" | "ATTENDANCE" | "PLACEMENT";
export type TrainingGroupMemberRole = "LEADER" | "MEMBER";
export type MapOwnership = "CLUB" | "EXTERNAL";
export type MapOwnerKind = "CLUB" | "MUNICIPALITY" | "MAPPER" | "OTHER";

export const trainingGroups = pgTable("training_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  pageVisibility: text("page_visibility").$type<TrainingGroupPageVisibility>().notNull().default("LINK"),
  nameDisplay: text("name_display").$type<TrainingGroupNameDisplay>().notNull().default("FIRST"),
  statsVisibility: text("stats_visibility").$type<TrainingGroupStatsVisibility>().notNull().default("LEADERS"),
  pointsMode: text("points_mode").$type<TrainingGroupPointsMode>().notNull().default("NONE"),
  templateRaceId: uuid("template_race_id"),
  settingsVersion: integer("settings_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  requestId: uuid("request_id").notNull()
});

export const trainingGroupMembers = pgTable("training_group_member", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id").notNull().references(() => trainingGroups.id),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  role: text("role").$type<TrainingGroupMemberRole>().notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  addedBy: uuid("added_by").notNull(),
  requestId: uuid("request_id").notNull()
});

export const trainingGroupSeries = pgTable("training_group_series", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id").notNull().references(() => trainingGroups.id),
  sourceRaceId: uuid("source_race_id").notNull(),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull(),
  firstDate: date("first_date").notNull(),
  lastDate: date("last_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  requestId: uuid("request_id").notNull(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
  undoneBy: uuid("undone_by")
});

/** Avtalsfälten, lika i biblioteket och på tävlingen. */
const agreementColumns = () => ({
  ownership: text("ownership").$type<MapOwnership>().notNull(),
  ownerKind: text("owner_kind").$type<MapOwnerKind>(),
  ownerName: text("owner_name"),
  agreement: text("agreement"),
  validUntil: date("valid_until"),
  contact: text("contact"),
  trainingOnly: boolean("training_only").notNull(),
  feePerPrint: boolean("fee_per_print").notNull(),
  noPublicDisplay: boolean("no_public_display").notNull()
});

/** Bibliotekets karta: namn, avtal och bildens mått (bilden, kartfilen och banläggningen kopieras med SQL). */
export const trainingGroupMaps = pgTable("training_group_map", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id").notNull().references(() => trainingGroups.id),
  name: text("name").notNull(),
  ...agreementColumns(),
  fileName: text("file_name").notNull(),
  /** ADR-0189: bilden i `map_content` (nya rader); gamla rader har den i kolumnen `image`, som läses med SQL. */
  contentSha256: text("content_sha256"),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  transform: jsonb("transform"),
  sourceRaceId: uuid("source_race_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  requestId: uuid("request_id").notNull()
});

export const trainingGroupMapSources = pgTable("training_group_map_source", {
  mapId: uuid("map_id").primaryKey().references(() => trainingGroupMaps.id),
  fileName: text("file_name").notNull(),
  format: text("format").notNull(),
  scale: integer("scale").notNull(),
  contentSha256: text("content_sha256")
});

export const trainingGroupMapCourseSettings = pgTable("training_group_map_course_setting", {
  mapId: uuid("map_id").primaryKey().references(() => trainingGroupMaps.id),
  originalFileName: text("original_file_name")
});

/** Kartans avtal på tävlingen (kopia ur biblioteket) och om admin medvetet visar kartan publikt ändå. */
export const raceMapAgreements = pgTable("race_map_agreement", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  sourceMapId: uuid("source_map_id"),
  mapName: text("map_name").notNull(),
  ...agreementColumns(),
  publicUseAcknowledgedAt: timestamp("public_use_acknowledged_at", { withTimezone: true }),
  publicUseAcknowledgedBy: uuid("public_use_acknowledged_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

/** Svaret på "Ny träning" och upprepningen per requestId (idempotens). */
export const trainingGroupRequests = pgTable("training_group_request", {
  requestId: uuid("request_id").primaryKey(),
  groupId: uuid("group_id").notNull().references(() => trainingGroups.id),
  actorAccountId: uuid("actor_account_id").notNull(),
  kind: text("kind").$type<"SESSIONS">().notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});
