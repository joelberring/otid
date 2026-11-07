import { index, integer, jsonb, pgTable, text, timestamp, uuid, foreignKey } from "drizzle-orm/pg-core";
import { entries, races } from "./core";
import { bytea } from "./types";

/** Kartans georeferens (ADR-0171): tre punkter med pixel och WGS84 och den affina transformen pixel → lon/lat. */
export type RaceMapTiePoint = { pixelX: number; pixelY: number; longitude: number; latitude: number };
export type RaceMapTransform = { a: number; b: number; c: number; d: number; e: number; f: number };

/** PLAN.md steg 16 (migration 0098): tävlingens karta för vägval, en per lopp. Bilden ligger i databasen. */
export const raceMaps = pgTable("race_map", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  fileName: text("file_name").notNull(),
  mediaType: text("media_type").$type<"image/png" | "image/jpeg">().notNull(),
  /** Gamla rader (före migration 0044); nya har `contentSha256` (ADR-0189). Aldrig båda. */
  image: bytea("image"),
  contentSha256: text("content_sha256"),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  tiePoints: jsonb("tie_points").$type<RaceMapTiePoint[]>(),
  transform: jsonb("transform").$type<RaceMapTransform>(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  georeferencedAt: timestamp("georeferenced_at", { withTimezone: true })
});

/** Steg 59: kartfilens georeferens (mm → projicerade meter), samma fält som `MapGeoreference` i `@o-tid/map-file`. */
export type RaceMapSourceGeoreference = {
  scale: number;
  crs: { kind: "EPSG"; code: number } | { kind: "UNKNOWN"; description: string };
  refPoint: { easting: number; northing: number };
  mapRefPoint: { x: number; y: number };
  grivationDegrees: number;
  combinedScaleFactor: number;
};
/** Bildens upplösning och kartans punkt (mm, y uppåt) i bildens övre vänstra hörn. */
export type RaceMapSourceRender = { pxPerMm: number; originX: number; originY: number };
export type RaceMapSourceBounds = { minX: number; minY: number; maxX: number; maxY: number };
/** Det som arbetsytan visar efter uppladdningen. */
export type RaceMapSourceSummary = { objectCount: number; warnings: { code: string; count: number; text: string }[]; simplifications: string[] };

/**
 * Steg 59 (migration 0028, ADR-0179): banläggarens kartfil orörd (OCAD eller Mapper, högst 60 MB). Bilden i `race_map`
 * är ritad ur den i webbläsaren; `render` kopplar kartans mm till bildens pixlar.
 */
export const raceMapSources = pgTable("race_map_source", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  fileName: text("file_name").notNull(),
  format: text("format").$type<"OCD" | "OMAP">().notNull(),
  version: text("version").notNull(),
  /** Gamla rader (före migration 0044); nya har `contentSha256` (ADR-0189). Aldrig båda. */
  file: bytea("file"),
  contentSha256: text("content_sha256"),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  scale: integer("scale").notNull(),
  bounds: jsonb("bounds").$type<RaceMapSourceBounds>().notNull(),
  georeference: jsonb("georeference").$type<RaceMapSourceGeoreference>(),
  render: jsonb("render").$type<RaceMapSourceRender>().notNull(),
  summary: jsonb("summary").$type<RaceMapSourceSummary>().notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull()
});

/**
 * ADR-0189 (migration 0044): kartbilder och kartfiler lagras en gång, adresserade med sha256, i delar om högst 1 MiB. Raderna i
 * `race_map`, `race_map_source` och träningsgruppens bibliotek pekar hit med `content_sha256`. Innehållet tas bort av en
 * utlösare när den sista referensen försvinner. `uploadedBy` är kontot vars kvot innehållet räknas mot.
 */
export const mapContents = pgTable("map_content", {
  sha256: text("sha256").primaryKey(),
  contentId: uuid("content_id").notNull(),
  byteLength: integer("byte_length").notNull(),
  uploadedBy: uuid("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

/** PLAN.md steg 16 (migration 0098): löparens GPS-rutt. Punkterna är [tid ms, lat, lon] i tidsordning. */
export const participantRoutes = pgTable("participant_route", {
  entryId: uuid("entry_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  fileName: text("file_name").notNull(),
  gpx: bytea("gpx").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  points: jsonb("points").$type<(readonly [number, number, number])[]>().notNull(),
  pointCount: integer("point_count").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull()
}, (table) => [
  index("participant_route_race_idx").on(table.raceId),
  foreignKey({ name: "participant_route_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] })
]);

/** Steg 60: en publicerad bästa väg per sträcka (kartfilens mm), för en bana eller variant. */
export type RouteChoicePublishedCourse = {
  courseId: string; variantCode: string | null; publishedAt: string; legs: Record<string, [number, number][]>;
};
export type RouteChoicePublished = { mapSha256: string; courses: RouteChoicePublishedCourse[] };

/**
 * Steg 60 (migration 0030, ADR-0179 beslut 11–12): vägvalsanalysens inställningar (`RouteChoiceSettings`) och de bästa
 * vägar som arrangören publicerat, med kartfilen (sha256) som de räknades på.
 */
export const raceRouteChoices = pgTable("race_route_choice", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  settings: jsonb("settings").$type<Record<string, unknown> & { version: 1 }>().notNull(),
  published: jsonb("published").$type<RouteChoicePublished>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});
