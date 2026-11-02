import {
  boolean,
  bigint,
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  userAccounts
} from "./accounts";
import {
  classes,
  courseVersions,
  courses,
  entries,
  events,
  races
} from "./core";

/** ADR-0169: Redigera bana. Oföränderlig journal för en ändrad kontrollföljd och dess omräkning. */
export const courseEditRequests = pgTable("course_edit_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  courseId: uuid("course_id").notNull(),
  previousCourseVersionId: uuid("previous_course_version_id").notNull(), courseVersionId: uuid("course_version_id").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("course_edit_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.courseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.previousCourseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.courseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  check("course_edit_request_versions_check", sql`${table.previousCourseVersionId} <> ${table.courseVersionId}`),
  check("course_edit_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

/** ADR-0169 beslut 4: idempotent journal för "Redigera klass" (namn, bana, startsätt). */
export const classEditRequests = pgTable("class_edit_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  classId: uuid("class_id").notNull(),
  previousCourseVersionId: uuid("previous_course_version_id").notNull().references(() => courseVersions.id),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  actorAccountId: uuid("actor_account_id").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("class_edit_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  check("class_edit_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

/** ADR-0170 beslut 5: idempotent journal för rogaining (kontrollernas poäng, klassernas tidsgräns och straff). */
export const rogainingChangeRequests = pgTable("rogaining_change_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  actorAccountId: uuid("actor_account_id").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("rogaining_change_request_scope_uidx").on(table.requestId, table.raceId),
  check("rogaining_change_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

/** PLAN.md steg 9: en sparad lottning av en eller flera klasser. Slumpfröet sparas för revision. */
export const startDrawRequests = pgTable("start_draw_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().unique(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorAccountId: uuid("actor_account_id").notNull(),
  seed: bigint("seed", { mode: "number" }).notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(), snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  drawnAt: timestamp("drawn_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("start_draw_request_scope_uidx").on(table.id, table.raceId),
  index("start_draw_request_race_time_idx").on(table.raceId, table.drawnAt),
  check("start_draw_request_seed_check", sql`${table.seed} BETWEEN 1 AND 4294967295`)
]);

/** Klassens plan i en lottning: MINUTE (lottad minutstart) eller MASS (masstart). */
export const startDrawClasses = pgTable("start_draw_class", {
  drawId: uuid("draw_id").notNull(), raceId: uuid("race_id").notNull(), classId: uuid("class_id").notNull(),
  method: text("method").$type<"MINUTE" | "MASS">().notNull(),
  firstStartTime: timestamp("first_start_time", { withTimezone: true }).notNull(),
  intervalSeconds: integer("interval_seconds").notNull(), vacancyCount: integer("vacancy_count").notNull()
}, table => [
  primaryKey({ columns: [table.drawId, table.classId] }),
  foreignKey({ name: "start_draw_class_draw_fk", columns: [table.drawId, table.raceId], foreignColumns: [startDrawRequests.id, startDrawRequests.raceId] }),
  foreignKey({ name: "start_draw_class_class_fk", columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] })
]);

/** Lottade tider i startordning; entryId null = vakant tid. */
export const startDrawSlots = pgTable("start_draw_slot", {
  drawId: uuid("draw_id").notNull(), classId: uuid("class_id").notNull(), position: integer("position").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  entryId: uuid("entry_id").references(() => entries.id)
}, table => [
  primaryKey({ columns: [table.drawId, table.classId, table.position] }),
  foreignKey({ name: "start_draw_slot_class_fk", columns: [table.drawId, table.classId], foreignColumns: [startDrawClasses.drawId, startDrawClasses.classId] })
]);

/** Ändrad variant på en löpare (ENTRY) och "Fördela gafflingar" i en klass (CLASS), migration 0093. */
export const courseVariantAssignmentRequests = pgTable("course_variant_assignment_request", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  kind: text("kind").$type<"ENTRY" | "CLASS">().notNull(),
  classId: uuid("class_id").notNull(),
  entryId: uuid("entry_id"),
  seed: bigint("seed", { mode: "number" }),
  actorAccountId: uuid("actor_account_id").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull()
});

/** ADR-0169 beslut 3 (migration 0094): sträckorna i en stafettklass med startsätt per sträcka. */
export const relayLegs = pgTable("relay_leg", {
  classId: uuid("class_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  leg: integer("leg").notNull(),
  startMethod: text("start_method").$type<"MASS_START" | "CHANGEOVER" | "RESTART" | "FLYING_RESTART">().notNull(),
  /** Masstart: starttiden. Omstart: tiden då lag som inte växlat startar. NULL för växling och flygande omstart. */
  startTime: timestamp("start_time", { withTimezone: true }),
  /** Variant för sträckan (gafflad bana); NULL = lagen fördelas över banans varianter. */
  courseVariantCode: text("course_variant_code"),
  /** Steg 47 (migration 0021): sträckans egen bana; NULL = klassens bana. */
  courseVersionId: uuid("course_version_id").references(() => courseVersions.id),
  /** Steg 47: flygande omstart, minuter efter ledarlagets växling till sträckan. */
  restartAfterMinutes: integer("restart_after_minutes"),
  /** Steg 48 (migration 0022): löpare per sträcka (1–4), när laget växlar och när sträckan är godkänd. */
  runners: integer("runners").notNull().default(1),
  changeoverRule: text("changeover_rule").$type<"FIRST" | "LAST">().notNull().default("FIRST"),
  approvalRule: text("approval_rule").$type<"ALL" | "ANY">().notNull().default("ALL")
}, table => [
  primaryKey({ columns: [table.classId, table.leg] }),
  foreignKey({ name: "relay_leg_class_fk", columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] })
]);

/** Ett stafettlag. Sträcklöparna är deltagare (entry) med lag och sträcka. */
export const teams = pgTable("team", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  classId: uuid("class_id").notNull(),
  number: integer("number").notNull(),
  name: text("name").notNull(),
  organisationName: text("organisation_name"),
  /** Lag från Eventor (migration 0096): lagets anmälnings-id. */
  externalSource: text("external_source"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Steg 47 (migration 0021): strukit lag med resultat; syns inte i listor, historiken står kvar. */
  struckAt: timestamp("struck_at", { withTimezone: true })
}, table => [
  uniqueIndex("team_race_number_uidx").on(table.raceId, table.number),
  uniqueIndex("team_external_uidx").on(table.raceId, table.externalSource, table.externalId),
  uniqueIndex("team_id_class_uidx").on(table.id, table.classId),
  index("team_class_idx").on(table.classId),
  foreignKey({ name: "team_class_fk", columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] })
]);

/** Journal för stafettens administration (migration 0094). */
export const relayRequests = pgTable("relay_request", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  kind: text("kind").$type<"CLASS" | "TEAM" | "LEG_RUNNER" | "START_TIMES" | "CLASS_EDIT" | "TEAM_EDIT" | "TEAM_STRIKE" |
    "TEAM_DID_NOT_START" | "LEG_VARIANT">().notNull(),
  classId: uuid("class_id").notNull(),
  teamId: uuid("team_id"),
  actorAccountId: uuid("actor_account_id").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

/** ADR-0170: Inställningar (namn, datum, tävlingstyp) med idempotent request-id. */
export const raceSettingsRequests = pgTable("race_settings_request", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorAccountId: uuid("actor_account_id").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [index("race_settings_request_race_idx").on(table.raceId)]);

/** Binära filer (kartbild, GPX) lagras i PostgreSQL; node-postgres ger och tar emot Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Kartans georeferens (ADR-0171): tre punkter med pixel och WGS84 och den affina transformen pixel → lon/lat. */
export type RaceMapTiePoint = { pixelX: number; pixelY: number; longitude: number; latitude: number };
export type RaceMapTransform = { a: number; b: number; c: number; d: number; e: number; f: number };

/** PLAN.md steg 16 (migration 0098): tävlingens karta för vägval, en per lopp. Bilden ligger i databasen. */
export const raceMaps = pgTable("race_map", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  fileName: text("file_name").notNull(),
  mediaType: text("media_type").$type<"image/png" | "image/jpeg">().notNull(),
  image: bytea("image").notNull(),
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
  file: bytea("file").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  scale: integer("scale").notNull(),
  bounds: jsonb("bounds").$type<RaceMapSourceBounds>().notNull(),
  georeference: jsonb("georeference").$type<RaceMapSourceGeoreference>(),
  render: jsonb("render").$type<RaceMapSourceRender>().notNull(),
  summary: jsonb("summary").$type<RaceMapSourceSummary>().notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull()
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

/** ADR-0172 beslut 5 (migration 0102): radiokontroller via ROC eller OResults. */
export type RadioSourceValue = "ROC" | "ORESULTS";
export type RadioErrorValue = "INVALID_INPUT" | "INVALID_RESPONSE" | "UPSTREAM_UNAVAILABLE" | "REJECTED" | "NOT_FOUND" |
  "RESPONSE_TOO_LARGE" | "TIMEOUT";

/** Tävlingens koppling till ROC/OResults, lastId och senaste hämtningens läge. */
export const raceRadioLinks = pgTable("race_radio_link", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  source: text("source").$type<RadioSourceValue>().notNull(),
  unitId: text("unit_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastPunchId: bigint("last_punch_id", { mode: "number" }).notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error").$type<RadioErrorValue>(),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  malformedLines: integer("malformed_lines").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

/** Kontrollerna som är radiokontroller, med valfritt namn. */
export const raceRadioControls = pgTable("race_radio_control", {
  raceId: uuid("race_id").notNull().references(() => races.id),
  controlCode: integer("control_code").notNull(),
  label: text("label")
}, (table) => [primaryKey({ columns: [table.raceId, table.controlCode] })]);

/** Radiostämplingarna som de kom (oföränderliga, skilda från avläsningarna). */
export const radioPunches = pgTable("radio_punch", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  source: text("source").$type<RadioSourceValue>().notNull(),
  unitId: text("unit_id").notNull(),
  punchId: bigint("punch_id", { mode: "number" }).notNull(),
  controlCode: integer("control_code").notNull(),
  cardNumber: text("card_number").notNull(),
  punchedAt: timestamp("punched_at", { withTimezone: true }).notNull(),
  localTime: text("local_time").notNull(),
  rawLine: text("raw_line").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("radio_punch_source_uidx").on(table.raceId, table.source, table.unitId, table.punchId),
  uniqueIndex("radio_punch_content_uidx").on(table.raceId, table.cardNumber, table.controlCode, table.punchedAt),
  index("radio_punch_race_time_idx").on(table.raceId, table.punchedAt)
]);

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

/**
 * ADR-0188 beslut 6 (migration 0043): en behörighet sparad för en e-postadress. Den blir en vanlig behörighet när ett konto
 * med adressen och bekräftad e-post loggar in eller öppnar tävlingen; svaret avslöjar aldrig om adressen har ett konto.
 */
export const racePersonInvitations = pgTable("race_person_invitation", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull().unique("race_person_invitation_request_uidx"),
  raceId: uuid("race_id").notNull().references(() => races.id),
  eventId: uuid("event_id").notNull().references(() => events.id),
  email: text("email").notNull(),
  role: text("role").$type<"ADMIN" | "FUNCTIONARY" | "COURSE_EDIT" | "COURSE_SUGGEST" | "COURSE_COMMENT" | "COURSE_MAP">().notNull(),
  actorAccountId: uuid("actor_account_id").notNull().references(() => userAccounts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedAccountId: uuid("accepted_account_id").references(() => userAccounts.id),
  acceptedGrantId: uuid("accepted_grant_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
}, (table) => [index("race_person_invitation_race_idx").on(table.raceId, table.createdAt)]);

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
  photo: bytea("photo"),
  photoMediaType: text("photo_media_type"),
  requestId: uuid("request_id").notNull()
});

export const courseSettingNoteReplies = pgTable("course_setting_note_reply", {
  id: uuid("id").primaryKey(),
  noteId: uuid("note_id").notNull().references(() => courseSettingNotes.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  requestId: uuid("request_id").notNull()
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

/** Steg 62: tidigare versioner av banläggningen (de senaste 50). */
export const courseSettingRevisions = pgTable("course_setting_revision", {
  raceId: uuid("race_id").notNull().references(() => races.id),
  version: integer("version").notNull(),
  kind: text("kind").$type<"SAVE" | "IMPORT" | "RESTORE">().notNull(),
  document: jsonb("document").$type<Record<string, unknown> & { version: 1 }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull()
}, (table) => [primaryKey({ columns: [table.raceId, table.version] })]);

/** PLAN.md steg 21 (migration 0103): "Ny tävling som …" – idempotent journal över kopior och deras källa. */
export const raceCopyRequests = pgTable("race_copy_request", {
  requestId: uuid("request_id").primaryKey(),
  actorAccountId: uuid("actor_account_id").notNull().references(() => userAccounts.id),
  sourceRaceId: uuid("source_race_id").notNull().references(() => races.id),
  eventId: uuid("event_id").notNull().references(() => events.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("race_copy_request_race_uidx").on(table.raceId),
  index("race_copy_request_source_idx").on(table.sourceRaceId, table.createdAt),
  check("race_copy_request_distinct_check", sql`${table.sourceRaceId} <> ${table.raceId}`),
  foreignKey({ name: "race_copy_request_race_event_fk", columns: [table.raceId, table.eventId], foreignColumns: [races.id, races.eventId] })
]);

/** ADR-0187 (migration 0041): kvittot för "Återställ tävling från säkerhetskopia", idempotent på `requestId`. */
export const raceRestoreRequests = pgTable("race_restore_request", {
  requestId: uuid("request_id").primaryKey(),
  actorAccountId: uuid("actor_account_id").notNull().references(() => userAccounts.id),
  eventId: uuid("event_id").notNull().references(() => events.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  fileSha256: text("file_sha256").notNull(),
  people: text("people").$type<"link" | "skip">().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [uniqueIndex("race_restore_request_race_uidx").on(table.raceId)]);
