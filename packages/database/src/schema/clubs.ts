import { boolean, customType, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { MapFingerprint } from "@o-tid/domain";
import { userAccounts } from "./accounts";

/**
 * ADR-0194 (migration 0059–0061): klubben och klubbarkivet. Kartversionernas filer ligger i `map_content` (ADR-0189);
 * banfilerna (små) ligger i `club_archive_course_file.content`.
 */
export type ClubRole = "OWNER" | "ADMIN" | "LEADER" | "READER";
export type ClubMapFormat = "OCD" | "OMAP";
export type ClubCourseFileKind = "PPEN" | "COURSE_DATA";
export type ClubMapResolution = "FOLDER" | "NAME" | "MANUAL" | "MISSING" | "NONE";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const clubs = pgTable("club", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  requestId: uuid("request_id").notNull()
});

export const clubMembers = pgTable("club_member", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  role: text("role").$type<ClubRole>().notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  addedBy: uuid("added_by").notNull(),
  requestId: uuid("request_id").notNull()
});

export const clubInvitations = pgTable("club_invitation", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  email: text("email").notNull(),
  role: text("role").$type<ClubRole>().notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedAccountId: uuid("accepted_account_id").references(() => userAccounts.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
});

export const clubImportTokens = pgTable("club_import_token", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  tokenSha256: text("token_sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true })
});

export const clubJournal = pgTable("club_journal", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  action: text("action").notNull(),
  actorAccountId: uuid("actor_account_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const clubMaps = pgTable("club_map", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  name: text("name").notNull(),
  ownership: text("ownership").$type<"CLUB" | "EXTERNAL">().notNull(),
  ownerKind: text("owner_kind").$type<"CLUB" | "MUNICIPALITY" | "MAPPER" | "OTHER">(),
  ownerName: text("owner_name"),
  agreement: text("agreement"),
  validUntil: date("valid_until"),
  contact: text("contact"),
  trainingOnly: boolean("training_only").notNull(),
  feePerPrint: boolean("fee_per_print").notNull(),
  noPublicDisplay: boolean("no_public_display").notNull(),
  importKey: text("import_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  /** ADR-0210 (migration 0077): beskrivning och kartritare, satta en gång på kartan. */
  description: text("description"),
  maker: text("maker")
});

export const clubMapVersions = pgTable("club_map_version", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  mapId: uuid("map_id").notNull().references(() => clubMaps.id),
  contentSha256: text("content_sha256").notNull(),
  fileName: text("file_name").notNull(),
  format: text("format").$type<ClubMapFormat>().notNull(),
  byteLength: integer("byte_length").notNull(),
  versionDate: date("version_date"),
  note: text("note"),
  uploadedBy: uuid("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  sourcePath: text("source_path"),
  /** ADR-0210: året som någon skrivit in (annars gissas det), och versionens kartritare. */
  versionYear: integer("version_year"),
  maker: text("maker")
});

export const clubArchiveEntries = pgTable("club_archive_entry", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  trainingDate: date("training_date"),
  year: integer("year"),
  place: text("place").notNull(),
  title: text("title").notNull(),
  leader: text("leader"),
  tags: text("tags").array().notNull(),
  notes: text("notes"),
  sourcePath: text("source_path"),
  importKey: text("import_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const clubArchiveEntryMaps = pgTable("club_archive_entry_map", {
  entryId: uuid("entry_id").notNull().references(() => clubArchiveEntries.id),
  versionId: uuid("version_id").notNull().references(() => clubMapVersions.id)
}, (table) => [primaryKey({ columns: [table.entryId, table.versionId] })]);

/** Sammanfattningen av en banfil (räknad på servern när filen tas emot). */
export interface ClubCourseFileSummary {
  readonly courses: readonly { readonly name: string; readonly controls: number; readonly lengthM: number | null }[];
  readonly scale: number | null;
  readonly problem?: string | undefined;
}

export const clubArchiveCourseFiles = pgTable("club_archive_course_file", {
  id: uuid("id").primaryKey(),
  entryId: uuid("entry_id").notNull().references(() => clubArchiveEntries.id),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  kind: text("kind").$type<ClubCourseFileKind>().notNull(),
  fileName: text("file_name").notNull(),
  content: bytea("content").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  summary: jsonb("summary").$type<ClubCourseFileSummary>().notNull(),
  mapVersionId: uuid("map_version_id").references(() => clubMapVersions.id),
  mapReference: text("map_reference"),
  mapResolution: text("map_resolution").$type<ClubMapResolution>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

/** ADR-0196 (migration 0062): kontrollen av en kartversion, ritad i webbläsaren. */
export type ClubMapCheckStatus = "OK" | "UNSUPPORTED_VERSION" | "NOT_A_MAP_FILE" | "TRUNCATED" | "INVALID" | "EMPTY" | "TOO_LARGE" | "FAILED";

export const clubMapVersionChecks = pgTable("club_map_version_check", {
  versionId: uuid("version_id").primaryKey().references(() => clubMapVersions.id),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  readerVersion: integer("reader_version").notNull(),
  status: text("status").$type<ClubMapCheckStatus>().notNull(),
  detail: text("detail"),
  fileVersion: text("file_version"),
  thumbnail: bytea("thumbnail"),
  thumbnailWidth: integer("thumbnail_width"),
  thumbnailHeight: integer("thumbnail_height"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  /** ADR-0210: fingeravtrycket (ytan, skalan, symbolerna), räknat i webbläsaren vid kontrollen. */
  fingerprint: jsonb("fingerprint").$type<MapFingerprint>()
});

/** ADR-0196: träningens bild (längsta banan på kartversionen), eller varför kartan inte kunde ritas. */
export const clubArchiveEntryThumbnails = pgTable("club_archive_entry_thumbnail", {
  entryId: uuid("entry_id").primaryKey().references(() => clubArchiveEntries.id),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  readerVersion: integer("reader_version").notNull(),
  status: text("status").$type<"OK" | "MAP_FAILED">().notNull(),
  detail: text("detail"),
  mapVersionId: uuid("map_version_id").references(() => clubMapVersions.id),
  courseName: text("course_name"),
  image: bytea("image"),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

/** ADR-0210: "Inte samma karta" för ett par (map_a < map_b). */
export const clubMapDuplicateDismissals = pgTable("club_map_duplicate_dismissal", {
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  mapA: uuid("map_a").notNull(),
  mapB: uuid("map_b").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull()
}, (table) => [primaryKey({ columns: [table.clubId, table.mapA, table.mapB] })]);

/** En uppgången karta som den var före sammanslagningen, med versionerna och gruppernas kartor som flyttades. */
export interface ClubMapMergeAbsorbed {
  readonly map: Record<string, unknown>;
  readonly versionIds: readonly string[];
  readonly groupMapIds: readonly string[];
}

/** ADR-0210: en sammanslagning, så att den går att ångra tills något annat ändrar kartan. */
export const clubMapMerges = pgTable("club_map_merge", {
  id: uuid("id").primaryKey(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  targetMapId: uuid("target_map_id").notNull(),
  absorbed: jsonb("absorbed").$type<ClubMapMergeAbsorbed[]>().notNull(),
  targetVersionIds: jsonb("target_version_ids").$type<string[]>().notNull(),
  targetUpdatedAt: timestamp("target_updated_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
  undoneBy: uuid("undone_by")
});
