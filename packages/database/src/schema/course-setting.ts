import { boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userAccounts } from "./accounts";
import { races } from "./core";
import { bytea } from "./types";

/**
 * Steg 62 (migration 0031, ADR-0180 beslut 1): banläggningens dokument (`CourseSettingDocument` i @o-tid/course-setting)
 * med version för att två flikar inte ska skriva över varandra. `originalPpen` = senast inlästa .ppen orörd.
 * `updatedBy` är kontots id utan främmande nyckel (ett borttaget hjälpkonto tar inte dokumentet med sig).
 */
export const courseSettings = pgTable("course_setting", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  document: jsonb("document").$type<Record<string, unknown> & { version: 1 }>().notNull(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  updatedBy: uuid("updated_by").notNull(),
  originalPpen: text("original_ppen"),
  originalFileName: text("original_file_name"),
  originalImportedAt: timestamp("original_imported_at", { withTimezone: true }),
  /** Steg 66: arbetssättet ("Huvudbanläggare" eller "Gemensamt"). */
  mode: text("mode").$type<"LEAD" | "SHARED">().notNull().default("LEAD")
});

/** Steg 66 (migration 0033): behörighet för banläggningen per person och tävling (ägare och admin har EDIT utan rad). */
export const courseSettingGrants = pgTable("course_setting_grant", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  level: text("level").$type<"EDIT" | "SUGGEST" | "COMMENT" | "MAP">().notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  grantedBy: uuid("granted_by").notNull(),
  requestId: uuid("request_id").notNull()
}, (table) => [uniqueIndex("course_setting_grant_race_account_key").on(table.raceId, table.accountId),
  uniqueIndex("course_setting_grant_request_key").on(table.requestId)]);

/** Steg 66: vad varje version ändrade (konflikter) och svaret på sparningen (idempotens). */
export const courseSettingChanges = pgTable("course_setting_change", {
  raceId: uuid("race_id").notNull().references(() => races.id),
  version: integer("version").notNull(),
  touches: jsonb("touches").$type<string[] | "ALL">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  requestId: uuid("request_id"),
  result: jsonb("result").$type<Record<string, unknown>>()
}, (table) => [primaryKey({ columns: [table.raceId, table.version] })]);

/** Steg 66: notiser på kartan och i banorna, utanför dokumentet. */
export const courseSettingNotes = pgTable("course_setting_note", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  target: text("target").$type<"POINT" | "CONTROL" | "LEG" | "COURSE" | "SKETCH">().notNull(),
  /** ADR-0181 beslut 8: banläggning eller kartfel (bara på punkt eller ritning) och ritningens linjer och ytor (mm). */
  kind: text("kind").$type<"COURSE_SETTING" | "MAP_ERROR">().notNull().default("COURSE_SETTING"),
  sketch: jsonb("sketch").$type<unknown[]>(),
  atX: doublePrecision("at_x"),
  atY: doublePrecision("at_y"),
  controlId: text("control_id"),
  fromControlId: text("from_control_id"),
  toControlId: text("to_control_id"),
  courseId: text("course_id"),
  text: text("text").notNull(),
  status: text("status").$type<"OPEN" | "DONE">().notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by"),
  /** ADR-0214: kartritaren gjorde kartfelet klart med länken ("Åtgärdat i kartan"); då är `resolvedBy` tom. */
  resolvedMapLinkId: uuid("resolved_map_link_id"),
  photo: bytea("photo"),
  photoMediaType: text("photo_media_type"),
  requestId: uuid("request_id").notNull(),
  /** ADR-0214 beslut 9: när texten senast redigerades (den tidigare texten i `course_setting_note_edit`). */
  editedAt: timestamp("edited_at", { withTimezone: true })
});

export const courseSettingNoteReplies = pgTable("course_setting_note_reply", {
  id: uuid("id").primaryKey(),
  noteId: uuid("note_id").notNull().references(() => courseSettingNotes.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  /** Kontot som skrev svaret; tomt när kartritaren svarade med länken (ADR-0214, då finns `mapLinkId`). */
  createdBy: uuid("created_by"),
  requestId: uuid("request_id").notNull(),
  /** ADR-0214: länken som svaret skrevs med (ingen främmande nyckel: svaret följer med kopia och säkerhetskopia). */
  mapLinkId: uuid("map_link_id"),
  /** Namnet kartritaren skrev (valfritt; annars visas "Kartritaren"). */
  authorName: text("author_name"),
  /** Kartritarens besked: åtgärdat i kartan eller inte åtgärdat. */
  verdict: text("verdict").$type<"FIXED" | "NOT_FIXED">(),
  editedAt: timestamp("edited_at", { withTimezone: true })
});

/** ADR-0214 beslut 9: tidigare texter för en notis eller ett svar som redigerats (bara för historiken, inte publikt). */
export const courseSettingNoteEdits = pgTable("course_setting_note_edit", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  noteId: uuid("note_id").notNull().references(() => courseSettingNotes.id),
  replyId: uuid("reply_id").references(() => courseSettingNoteReplies.id),
  previousText: text("previous_text").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
  editedBy: uuid("edited_by").notNull()
});

/**
 * ADR-0214: länken till kartritaren (kartfelen utan konto). Bara nyckelns sha256 sparas; högst en länk som inte är
 * avstängd per tävling. Ingen IP-adress eller webbläsare, bara när länken senast öppnades.
 */
export const courseSettingMapLinks = pgTable("course_setting_map_link", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  tokenHash: text("token_hash").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  showRaceName: boolean("show_race_name").notNull().default(false),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by"),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true })
});

/** Steg 66: förslag (åtgärder mot en version) som den med EDIT godkänner helt, delvis eller avböjer. */
export const courseSettingSuggestions = pgTable("course_setting_suggestion", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  baseVersion: integer("base_version").notNull(),
  edits: jsonb("edits").$type<unknown[]>().notNull(),
  created: jsonb("created").$type<unknown[]>().notNull(),
  comment: text("comment").notNull(),
  status: text("status").$type<"OPEN" | "APPROVED" | "PARTIAL" | "DECLINED">().notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: uuid("decided_by"),
  decisionComment: text("decision_comment"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  requestId: uuid("request_id").notNull()
});

/** Steg 67: "kollad" per kontroll (fältläget), utanför dokumentet; `checked` false = avbockad (den senaste vinner). */
export const courseSettingInspections = pgTable("course_setting_inspection", {
  raceId: uuid("race_id").notNull().references(() => races.id),
  controlId: text("control_id").notNull(),
  checked: boolean("checked").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
  changedBy: uuid("changed_by").notNull(),
  atX: doublePrecision("at_x"),
  atY: doublePrecision("at_y")
}, (table) => [primaryKey({ columns: [table.raceId, table.controlId] })]);

/** Steg 62: tidigare versioner av banläggningen (de senaste 50). */
export const courseSettingRevisions = pgTable("course_setting_revision", {
  raceId: uuid("race_id").notNull().references(() => races.id),
  version: integer("version").notNull(),
  kind: text("kind").$type<"SAVE" | "IMPORT" | "RESTORE">().notNull(),
  document: jsonb("document").$type<Record<string, unknown> & { version: 1 }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull()
}, (table) => [primaryKey({ columns: [table.raceId, table.version] })]);
