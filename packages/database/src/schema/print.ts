import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { userAccounts } from "./accounts";
import { races } from "./core";
import { bytea } from "./types";

/**
 * Steg 61 (migration 0029): senaste utskriften av kartbuntslistan (`BUNDLE`) eller baksidorna (`BACKS`) med läget då
 * (domänens `PrintedMapState`), för "N ändringar sedan listan skrevs ut". Skrivs över vid nästa utskrift.
 */
export const mapPrints = pgTable("map_print", {
  raceId: uuid("race_id").notNull().references(() => races.id),
  list: text("list").$type<"BUNDLE" | "BACKS">().notNull(),
  printedAt: timestamp("printed_at", { withTimezone: true }).notNull(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull()
}, (table) => [
  primaryKey({ columns: [table.raceId, table.list] }),
  check("map_print_list_check", sql`${table.list} IN ('BUNDLE', 'BACKS')`)
]);

/**
 * Steg 65 (ADR-0184): PDF för tryck som jobb i en kö. `document` är banläggningen när jobbet skapades; `pdf` finns bara
 * när jobbet är klart (DONE) och rensas efter en tid (EXPIRED). Tas inte med i säkerhetskopian (deploy/backup.sh).
 */
export const courseSettingPrintJobs = pgTable("course_setting_print_job", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  requestId: uuid("request_id").notNull(),
  kind: text("kind").$type<"PRESS" | "PROCESS" | "OFFICE">().notNull(),
  status: text("status").$type<"QUEUED" | "RUNNING" | "DONE" | "FAILED" | "EXPIRED">().notNull().default("QUEUED"),
  label: text("label").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  document: jsonb("document").$type<Record<string, unknown>>().notNull(),
  documentVersion: integer("document_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  worker: text("worker"),
  error: text("error"),
  pdf: bytea("pdf"),
  byteLength: integer("byte_length"),
  pages: integer("pages"),
  sha256: text("sha256"),
  report: jsonb("report").$type<{ plates: string[]; overprint: boolean; notes: string[]; mapForms: number; milliseconds: number }>()
}, (table) => [unique("course_setting_print_job_request_unique").on(table.raceId, table.requestId)]);

/**
 * ADR-0197 (migration 0063): papperets bilder (logotyper, sponsorer), en gång per innehåll (sha256). PNG eller JPEG, högst
 * 2 MB. Dokumentet pekar på bilden med dess sha256; utskriftsarbetaren läser bilderna för PDF:en.
 */
export const courseSettingPaperImages = pgTable("course_setting_paper_image", {
  sha256: text("sha256").primaryKey(),
  mediaType: text("media_type").notNull(),
  image: bytea("image").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => userAccounts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

/** ADR-0197: papperets mallar i kontots bibliotek, för andra tävlingar (namnet unikt per konto). */
export const courseSettingPaperTemplates = pgTable("course_setting_paper_template", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  name: text("name").notNull(),
  template: jsonb("template").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, (table) => [unique("course_setting_paper_template_name_unique").on(table.accountId, table.name)]);

/**
 * Ägaren 2026-11-10 (migration 0111): utskrifternas PDF:er sparade i träningen, kvar tills någon tar bort dem. `source`:
 * en sparad PDF från tryckjobben (PRINT_JOB) eller en egen uppladdad (UPLOAD).
 */
export const racePrintFiles = pgTable("race_print_file", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  fileName: text("file_name").notNull(),
  label: text("label").notNull().default(""),
  source: text("source").$type<"UPLOAD" | "PRINT_JOB">().notNull(),
  pdf: bytea("pdf").notNull(),
  byteLength: integer("byte_length").notNull(),
  sha256: text("sha256").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [check("race_print_file_source_check", sql`${table.source} IN ('UPLOAD', 'PRINT_JOB')`)]);
