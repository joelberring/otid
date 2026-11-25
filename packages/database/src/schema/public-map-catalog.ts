import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userAccounts } from "./accounts";
import { clubMaps, clubMapVersions, clubs, type ClubMapFormat } from "./clubs";
import { mapContents } from "./map-content";
import { mapProjects } from "./map-projects";

export type PublicMapAccessMode = "INFO_ONLY" | "USE_IN_OTID_LOCKED" | "OPEN_DOWNLOAD";
export type PublicMapNorm = "ISOM" | "ISSprOM" | "OTHER";
/** Förenklad WGS84-polygon [lon, lat][] för kartans utbredning på översiktskartan. */
export type PublicMapFootprint = [number, number][];

/**
 * Etapp 3.1 (migration 0145–0146): publik sökbar kartbank. En post pekar på antingen en klubbkarta
 * (`club_map_id`) eller ett enskilt kartprojekt (`map_project_id`). `show_preview` är av som standard
 * för avlysningssäkerhet.
 */
export const publicMapListings = pgTable("public_map_listing", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerAccountId: uuid("owner_account_id").notNull().references(() => userAccounts.id, { onDelete: "cascade" }),
  clubId: uuid("club_id").references(() => clubs.id, { onDelete: "cascade" }),
  clubMapId: uuid("club_map_id").references(() => clubMaps.id, { onDelete: "cascade" }),
  clubMapVersionId: uuid("club_map_version_id").references(() => clubMapVersions.id, { onDelete: "set null" }),
  mapProjectId: uuid("map_project_id").references(() => mapProjects.id, { onDelete: "cascade" }),
  contentSha256: text("content_sha256").notNull().references(() => mapContents.sha256),
  previewContentSha256: text("preview_content_sha256").references(() => mapContents.sha256, { onDelete: "set null" }),
  format: text("format").$type<ClubMapFormat>().notNull(),
  accessMode: text("access_mode").$type<PublicMapAccessMode>().notNull().default("INFO_ONLY"),
  showPreview: boolean("show_preview").notNull().default(false),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  clubName: text("club_name").notNull().default(""),
  maker: text("maker").notNull().default(""),
  scale: integer("scale"),
  norm: text("norm").$type<PublicMapNorm>().notNull().default("OTHER"),
  mapYear: integer("map_year"),
  licenseNote: text("license_note").notNull().default(""),
  contact: text("contact").notNull().default(""),
  municipalityCodes: text("municipality_codes").array().notNull().default([]),
  countyCodes: text("county_codes").array().notNull().default([]),
  minLon: doublePrecision("min_lon"),
  maxLon: doublePrecision("max_lon"),
  minLat: doublePrecision("min_lat"),
  maxLat: doublePrecision("max_lat"),
  footprint: jsonb("footprint").$type<PublicMapFootprint>(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("public_map_listing_club_map_uidx").on(table.clubMapId).where(sql`${table.clubMapId} IS NOT NULL`),
  uniqueIndex("public_map_listing_map_project_uidx").on(table.mapProjectId).where(sql`${table.mapProjectId} IS NOT NULL`),
  index("public_map_listing_municipality_gin_idx").using("gin", table.municipalityCodes),
  index("public_map_listing_county_gin_idx").using("gin", table.countyCodes),
  index("public_map_listing_bounds_idx").on(table.minLon, table.maxLon, table.minLat, table.maxLat),
  index("public_map_listing_club_idx").on(table.clubId),
  index("public_map_listing_owner_idx").on(table.ownerAccountId),
  index("public_map_listing_content_idx").on(table.contentSha256),
  index("public_map_listing_preview_idx").on(table.previewContentSha256),
  check("public_map_listing_format_check", sql`${table.format} IN ('OCD', 'OMAP')`),
  check("public_map_listing_access_mode_check", sql`${table.accessMode} IN ('INFO_ONLY', 'USE_IN_OTID_LOCKED', 'OPEN_DOWNLOAD')`),
  check("public_map_listing_norm_check", sql`${table.norm} IN ('ISOM', 'ISSprOM', 'OTHER')`)
]);
