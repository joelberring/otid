import { bigint, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { clubMapVersions, clubs } from "./clubs";

/**
 * ADR-0208 (migration 0074): kartrevideringen. Grundversionen är en kartversion i klubbarkivet; ändringarna lagras per objekt
 * (`map_revision_object`) med en logg över varje ändring som kom fram (`map_revision_edit`). Konton har ingen främmande nyckel.
 */
export type MapRevisionStatus = "OPEN" | "CLOSED";
export type MapRevisionEditStatus = "APPLIED" | "CONFLICT";

export const mapRevisions = pgTable("map_revision", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  baseVersionId: uuid("base_version_id").notNull().references(() => clubMapVersions.id),
  baseSha256: text("base_sha256").notNull(),
  baseFormat: text("base_format").$type<"OCD" | "OMAP">().notNull(),
  title: text("title").notNull(),
  status: text("status").$type<MapRevisionStatus>().notNull(),
  seq: bigint("seq", { mode: "number" }).notNull().default(0),
  readerVersion: integer("reader_version").notNull(),
  sourceRaceId: uuid("source_race_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  closedBy: uuid("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  resultVersionId: uuid("result_version_id").references(() => clubMapVersions.id),
  requestId: uuid("request_id").notNull()
});

export const mapRevisionObjects = pgTable("map_revision_object", {
  revisionId: uuid("revision_id").notNull().references(() => mapRevisions.id),
  objectKey: text("object_key").notNull(),
  ref: jsonb("ref").$type<unknown>(),
  state: jsonb("state").$type<unknown>().notNull(),
  lastEditId: uuid("last_edit_id").notNull(),
  version: integer("version").notNull(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  authorAccountId: uuid("author_account_id").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull()
}, table => [primaryKey({ columns: [table.revisionId, table.objectKey] })]);

export const mapRevisionEdits = pgTable("map_revision_edit", {
  id: uuid("id").primaryKey(),
  revisionId: uuid("revision_id").notNull().references(() => mapRevisions.id),
  editId: uuid("edit_id").notNull(),
  objectKey: text("object_key").notNull(),
  baseEditId: uuid("base_edit_id"),
  kind: text("kind").notNull(),
  status: text("status").$type<MapRevisionEditStatus>().notNull(),
  state: jsonb("state").$type<unknown>().notNull(),
  seq: bigint("seq", { mode: "number" }),
  authorAccountId: uuid("author_account_id").notNull(),
  clientId: text("client_id").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull()
});

export const mapRevisionParticipants = pgTable("map_revision_participant", {
  revisionId: uuid("revision_id").notNull().references(() => mapRevisions.id),
  accountId: uuid("account_id").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull()
}, table => [primaryKey({ columns: [table.revisionId, table.accountId] })]);
