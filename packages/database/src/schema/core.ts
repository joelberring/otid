import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const startRuleEnum = pgEnum("start_rule", ["FIXED", "PUNCH"]);

export const importKindEnum = pgEnum("import_kind", ["CourseData", "EntryList", "StartList"]);
export const revisionCauseEnum = pgEnum("revision_cause", [
  "CARD_READOUT",
  "CLASS_CHANGE_RECALCULATION",
  "EXPLICIT_RECALCULATION",
  "UNKNOWN_READOUT_RESOLUTION",
  "MANUAL_DID_NOT_START",
  "MANUAL_DISQUALIFICATION",
  "MANUAL_DISQUALIFICATION_WITHDRAWAL",
  "MANUAL_RESULT_APPROVAL",
  "MANUAL_RESULT_APPROVAL_WITHDRAWAL",
  "MANUAL_DID_NOT_FINISH",
  "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
  "MANUAL_OUT_OF_COMPETITION",
  "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
  "MANUAL_WITHOUT_TIMING",
  "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
  "START_CHECKIN_DID_NOT_START",
  "MANUAL_FINISH_TIME_CORRECTION",
  "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL",
  "MANUAL_PUNCH_START_TIME_CORRECTION",
  "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL",
  "SHORTENED_COURSE_CLASS_TRANSFER",
  "MANUAL_DID_NOT_START_WITHDRAWAL",
  "MANUAL_TIME",
  "MANUAL_TIME_WITHDRAWAL",
  "MANUAL_CONTROL_APPROVAL",
  "MANUAL_CONTROL_APPROVAL_WITHDRAWAL",
  "MANUAL_RESULT_REMOVED",
  /** Steg 36: avläsningen avkodad på nytt från råramarna (migration 0014). */
  "READOUT_REREAD",
  /** Steg 38: "Bekräfta felstämplad" och "Ta bort bekräftelsen" (migration 0015). */
  "MANUAL_MISPUNCH_CONFIRMATION",
  "MANUAL_MISPUNCH_CONFIRMATION_WITHDRAWAL"
]);
export const eventAdministrationRoleEnum = pgEnum("event_administration_role", ["OWNER", "ADMIN", "FUNCTIONARY"]);
export const auditActorKindEnum = pgEnum("audit_actor_kind", [
  "RACE_ADMIN_ACCESS_CREDENTIAL",
  "PAIRING_ADMIN_ACCESS_CREDENTIAL",
  "IOF_IMPORT_ACCESS_CREDENTIAL",
  "ENTRY_CLASS_ACCESS_CREDENTIAL",
  "ENTRY_START_TIME_ACCESS_CREDENTIAL",
  "CLASS_START_DRAW_ACCESS_CREDENTIAL",
  "ENTRY_CARD_ACCESS_CREDENTIAL",
  "ENTRY_IDENTITY_ACCESS_CREDENTIAL",
  "ENTRY_REGISTRATION_ACCESS_CREDENTIAL",
  "RESULT_RECALCULATION_ACCESS_CREDENTIAL",
  "EVENT_CREATION_ACCESS_CREDENTIAL",
  "USER_ACCOUNT",
  "RESULT_FINALIZATION_ACCESS_CREDENTIAL",
  "START_CHECKIN_ACCESS_CREDENTIAL",
  "FINISH_FOREST_WATCH_ACCESS_CREDENTIAL",
  "DID_NOT_START_ACCESS_CREDENTIAL",
  "DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL",
  "RESULT_DISQUALIFICATION_ACCESS_CREDENTIAL",
  "RESULT_DISQUALIFICATION_WITHDRAWAL_ACCESS_CREDENTIAL",
  "RESULT_APPROVAL_ACCESS_CREDENTIAL",
  "RESULT_APPROVAL_WITHDRAWAL_ACCESS_CREDENTIAL",
  "DID_NOT_FINISH_ACCESS_CREDENTIAL",
  "DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL",
  "OUT_OF_COMPETITION_ACCESS_CREDENTIAL",
  "OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL",
  "WITHOUT_TIMING_ACCESS_CREDENTIAL",
  "WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL"
  ,"START_LIST_PUBLICATION_ACCESS_CREDENTIAL"
]);
export const resultFinalizationScopeEnum = pgEnum("result_finalization_scope", ["CLASS", "RACE"]);

/** ADR-0170 beslut 1: Träning, Liten tävling, Tävling, Gafflade banor, Stafett, Rogaining. */
export type RaceTypeValue = "TRAINING" | "SMALL" | "STANDARD" | "FORKED" | "RELAY" | "ROGAINING" | "PARTY";

export const events = pgTable("event", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startsOn: date("starts_on").notNull(),
  timeZone: text("time_zone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const races = pgTable("race", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id),
  name: text("name").notNull(),
  raceDate: date("race_date").notNull(),
  snapshotVersion: integer("snapshot_version").notNull().default(1),
  /** ADR-0170 beslut 1: tävlingstyp, styr vad arbetsytan visar. */
  raceType: text("race_type").$type<RaceTypeValue>().notNull().default("STANDARD"),
  /** ADR-0172 beslut 2: superadmin döljer tävlingen från de publika sidorna. */
  hiddenBySuperadmin: boolean("hidden_by_superadmin").notNull().default(false),
  /** ADR-0172 beslut 4: när admin publicerade tävlingen. NULL = inte publicerad (syns inte publikt). */
  publishedAt: timestamp("published_at", { withTimezone: true }),
  /** Kort adress till tävlingssidan (/t/{kod}), sätts av databasen (migration 0101). */
  shortCode: text("short_code").notNull().default(sql`generate_race_short_code()`),
  /** Lottningens inställningar under "Avancerat" (migration 0005), sparade med senaste lottningen. NULL = standard. */
  startDrawSettings: jsonb("start_draw_settings"),
  /** "Resultaten är klara" (migration 0006): loppets fastställande som gäller som officiellt. NULL = preliminära. */
  officialResultFinalizationId: uuid("official_result_finalization_id"),
  /** Steg 33 (migration 0011): bricknummer i den publika startlistan. Påslaget som standard. */
  publicStartListCardNumbers: boolean("public_start_list_card_numbers").notNull().default(true),
  /** Steg 33: kort info om tävlingen (fritext, högst 1000 tecken) och första start (HH:MM, bara information). */
  info: text("info"),
  firstStartTime: text("first_start_time"),
  /** Steg 33 (migration 0012): "Uppdatera startlistan löpande". Av = den senast publicerade ögonblicksbilden. */
  startListLive: boolean("start_list_live").notNull().default(false),
  /** Steg 41 (migration 0018): "Tillåt självregistrering på tävlingsdagen". Av som standard. */
  selfRegistration: boolean("self_registration").notNull().default(false),
  /** Steg 52 (migration 0026): "Visa banorna publikt nu". NULL = banorna hemliga publikt tills alla är i mål (ADR-0176). */
  coursesPublicAt: timestamp("courses_public_at", { withTimezone: true }),
  /** Steg 52: kartans skala ur banfilen (IOF Map/Scale, t.ex. 10000) för kontrollernas kartlägen. NULL = okänd. */
  courseMapScale: integer("course_map_scale"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  check("race_info_check", sql`${table.info} IS NULL OR char_length(${table.info}) BETWEEN 1 AND 1000`),
  check("race_first_start_time_check", sql`${table.firstStartTime} IS NULL OR ${table.firstStartTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  check("race_type_check", sql`${table.raceType} in ('TRAINING', 'SMALL', 'STANDARD', 'FORKED', 'RELAY', 'ROGAINING', 'PARTY')`),
  check("race_short_code_check", sql`${table.shortCode} ~ '^[2-9a-hjkmnp-z]{6}$'`),
  uniqueIndex("race_short_code_uidx").on(table.shortCode),
  index("race_event_idx").on(table.eventId),
  uniqueIndex("race_id_event_uidx").on(table.id, table.eventId)
]);

export const courses = pgTable("course", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  name: text("name").notNull(),
  /** Längd och stigning i meter (migration 0004): från banfilen eller banformuläret. */
  lengthMeters: integer("length_meters"),
  climbMeters: integer("climb_meters"),
  /** Steg 49 (migration 0023): gafflingssätt, utjämnad eller fulgaffling. Påverkar bara rättvisekontrollen. */
  forkingMode: text("forking_mode").$type<"BALANCED" | "UNEQUAL">().notNull().default("BALANCED"),
  /** Steg 49 (migration 0023): startens och målets lägen ur banfilen ({ latitude, longitude }). NULL = okänt. */
  startPosition: jsonb("start_position").$type<{ latitude: number; longitude: number }>(),
  finishPosition: jsonb("finish_position").$type<{ latitude: number; longitude: number }>(),
  /** Steg 52 (migration 0026): startens och målets lägen på kartan ur banfilen ({ x, y } i mm, IOF MapPosition). */
  startMapPosition: jsonb("start_map_position").$type<{ x: number; y: number }>(),
  finishMapPosition: jsonb("finish_map_position").$type<{ x: number; y: number }>(),
  externalSource: text("external_source"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("course_external_uidx").on(table.raceId, table.externalSource, table.externalId), uniqueIndex("course_id_race_uidx").on(table.id, table.raceId)]);

export const courseVersions = pgTable("course_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  version: integer("version").notNull(),
  /** Steg 49 (migration 0023): gafflingsstrukturen som varianterna genererades ur. NULL = ingen struktur. */
  forking: jsonb("forking"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("course_version_uidx").on(table.courseId, table.version), uniqueIndex("course_version_id_course_uidx").on(table.id, table.courseId)]);

export const controls = pgTable("control", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  code: integer("code").notNull(),
  kind: text("kind").notNull().default("CONTROL"),
  /** Rogaining (migration 0097): poäng när arrangören ändrat förvalet (kontrollkoden delat med tio). NULL = förvalet. */
  points: integer("points"),
  /** Steg 49 (migration 0023): kontrollens läge ur banfilen (IOF Control/Position, WGS 84). NULL = okänt. */
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  /** Steg 52 (migration 0026): kontrollens läge på kartan i mm (IOF MapPosition). NULL = okänt. */
  mapX: doublePrecision("map_x"),
  mapY: doublePrecision("map_y"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("control_race_code_uidx").on(table.raceId, table.code),
  check("control_points_check", sql`${table.points} IS NULL OR ${table.points} BETWEEN 0 AND 1000`)]);

export const courseControls = pgTable("course_control", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  controlId: uuid("control_id").notNull().references(() => controls.id),
  sequence: integer("sequence").notNull()
}, (table) => [uniqueIndex("course_control_sequence_uidx").on(table.courseVersionId, table.sequence), uniqueIndex("course_control_id_version_uidx").on(table.id, table.courseVersionId)]);

/** ADR-0169 beslut 2: variant (gaffling) av en banversion med egen kontrollföljd (migration 0093). */
export const courseVariants = pgTable("course_variant", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  code: text("code").notNull(),
  sequence: integer("sequence").notNull(),
  /** Steg 49 (migration 0023): variantens längd i meter, när den är känd. */
  lengthMeters: integer("length_meters")
}, (table) => [
  uniqueIndex("course_variant_code_uidx").on(table.courseVersionId, table.code),
  uniqueIndex("course_variant_sequence_uidx").on(table.courseVersionId, table.sequence),
  uniqueIndex("course_variant_id_version_uidx").on(table.id, table.courseVersionId)
]);

export const courseVariantControls = pgTable("course_variant_control", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseVariantId: uuid("course_variant_id").notNull().references(() => courseVariants.id),
  controlId: uuid("control_id").notNull().references(() => controls.id),
  sequence: integer("sequence").notNull()
}, (table) => [uniqueIndex("course_variant_control_sequence_uidx").on(table.courseVariantId, table.sequence)]);

export const classes = pgTable("class", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  name: text("name").notNull(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  startRule: startRuleEnum("start_rule").notNull().default("FIXED"),
  maxEntries: integer("max_entries"),
  capacityVersion: integer("capacity_version").notNull().default(1),
  /** Klassens gällande lottning (startDrawClasses). Töms när startsättet ändras. */
  startDrawId: uuid("start_draw_id"),
  /** Rogainingklass (migration 0097): tidsgräns i sekunder och straffpoäng per påbörjad minut över. Båda NULL = vanlig klass. */
  rogainingTimeLimitSeconds: integer("rogaining_time_limit_seconds"),
  rogainingPenaltyPointsPerMinute: integer("rogaining_penalty_points_per_minute"),
  /** Maxtid i minuter (migration 0004, PLAN.md steg 25). NULL = ingen gräns; aldrig för rogaining. */
  maxTimeMinutes: integer("max_time_minutes"),
  /** Stafett (steg 47, migration 0021): hur lag i omstart placeras (NULL = AFTER_NORMAL, SOFT TR 5.8.2). */
  relayRestartRanking: text("relay_restart_ranking").$type<"AFTER_NORMAL" | "BY_TIME">(),
  /** Stafett: utjämnad gaffling (EVEN, NULL = förval) eller fulgaffling (UNEVEN). */
  relayForking: text("relay_forking").$type<"EVEN" | "UNEVEN">(),
  /** Steg 48 (migration 0022): teamsprint – växlingskontrollens kod. NULL = vanlig stafett. */
  relayChangeoverCode: integer("relay_changeover_code"),
  /**
   * Steg 50: teamsprint – utläsning efter varje sträcka (`EACH_LEG`) eller efter sista sträckan (`LAST_LEG`, växlingskontroll).
   * NULL = vanlig stafett.
   */
  relayReadoutMode: text("relay_readout_mode").$type<"EACH_LEG" | "LAST_LEG">(),
  externalSource: text("external_source"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("class_external_uidx").on(table.raceId, table.externalSource, table.externalId),
  uniqueIndex("class_id_race_uidx").on(table.id, table.raceId),
  uniqueIndex("class_id_course_version_uidx").on(table.id, table.courseVersionId)
  ,check("class_max_entries_check", sql`${table.maxEntries} IS NULL OR ${table.maxEntries} BETWEEN 0 AND 10000`)
  ,check("class_capacity_version_check", sql`${table.capacityVersion} > 0`)
  ,check("class_rogaining_check", sql`(${table.rogainingTimeLimitSeconds} IS NULL) = (${table.rogainingPenaltyPointsPerMinute} IS NULL) AND
    (${table.rogainingTimeLimitSeconds} IS NULL OR ${table.rogainingTimeLimitSeconds} BETWEEN 60 AND 172800) AND
    (${table.rogainingPenaltyPointsPerMinute} IS NULL OR ${table.rogainingPenaltyPointsPerMinute} BETWEEN 0 AND 1000)`)
  ,check("class_max_time_check", sql`${table.maxTimeMinutes} IS NULL OR (${table.maxTimeMinutes} BETWEEN 1 AND 1440 AND
    ${table.rogainingTimeLimitSeconds} IS NULL)`)
]);

export const entries = pgTable("entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  // Stable opaque identifier for race-scoped public result links. It is not an
  // import key, credential, or replacement for the internal entry identity.
  publicResultId: uuid("public_result_id").notNull().defaultRandom(),
  classId: uuid("class_id").notNull().references(() => classes.id),
  givenName: text("given_name").notNull(),
  familyName: text("family_name").notNull(),
  organisationName: text("organisation_name"),
  fixedStartTime: timestamp("fixed_start_time", { withTimezone: true }),
  /** Löparens variant av klassens gafflade bana (migration 0093). NULL = ingen tilldelad variant. */
  courseVariantCode: text("course_variant_code"),
  /** Stafett (migration 0094): laget och sträckan som löparen springer. Båda NULL för individuella löpare. */
  teamId: uuid("team_id"),
  relayLeg: integer("relay_leg"),
  /** Steg 48 (migration 0022): ordning inom sträckan (IOF LegOrder); NULL = 1. */
  relayLegOrder: integer("relay_leg_order"),
  /** Steg 48: teamsprint – sträcklöparen springer med brickan som sitter på denna deltagare (löparens första sträcka). */
  relayCardEntryId: uuid("relay_card_entry_id"),
  externalSource: text("external_source"),
  externalId: text("external_id"),
  /** Eventors id för personen och klubben (migration 0004), för IOF-resultatets Person/Organisation Id. */
  eventorPersonId: text("eventor_person_id"),
  eventorOrganisationId: text("eventor_organisation_id"),
  /** Seedning i lottningen (migration 0005): 1 = bäst. NULL = inte seedad. */
  seedRank: integer("seed_rank"),
  /** "Stryk" (migration 0006): dold i alla listor, historik och råa avläsningar finns kvar. NULL = inte struken. */
  struckAt: timestamp("struck_at", { withTimezone: true }),
  /** Steg 41 (migration 0018): löparen registrerade sig själv på tävlingssidan. NULL = admin, import eller avläsningen. */
  selfRegisteredAt: timestamp("self_registered_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_external_uidx").on(table.raceId, table.externalSource, table.externalId),
  uniqueIndex("entry_race_public_result_uidx").on(table.raceId, table.publicResultId),
  uniqueIndex("entry_id_race_uidx").on(table.id, table.raceId),
  index("entry_class_idx").on(table.classId)
]);

export const cardAssignments = pgTable("card_assignment", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  cardNumber: text("card_number").notNull(),
  active: boolean("active").notNull().default(true),
  isRental: boolean("is_rental").notNull().default(false),
  rentalReturned: boolean("rental_returned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("card_assignment_active_race_card_uidx").on(table.raceId, table.cardNumber).where(sql`${table.active}`),
  uniqueIndex("card_assignment_id_race_entry_card_uidx").on(table.id, table.raceId, table.entryId, table.cardNumber),
  uniqueIndex("card_assignment_id_race_card_uidx").on(table.id, table.raceId, table.cardNumber)
]);

export const importFiles = pgTable("import_file", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  kind: importKindEnum("kind").notNull(),
  contentHash: text("content_hash").notNull(),
  originalXml: text("original_xml").notNull(),
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("import_file_hash_uidx").on(table.raceId, table.kind, table.contentHash)]);

export const rawDeviceMessages = pgTable("raw_device_message", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  deviceId: uuid("device_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  localSequence: integer("local_sequence").notNull(),
  packageVersion: integer("package_version").notNull(),
  stationReceivedAt: timestamp("station_received_at", { withTimezone: true }).notNull(),
  serverReceivedAt: timestamp("server_received_at", { withTimezone: true }).notNull().defaultNow(),
  transport: text("transport").notNull(),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull(),
  contentHash: text("content_hash").notNull(),
  parserStatus: text("parser_status").notNull().default("normalized")
}, (table) => [
  uniqueIndex("raw_device_sequence_uidx").on(table.deviceId, table.localSequence),
  index("raw_device_message_race_received_id_idx").on(table.raceId, table.serverReceivedAt, table.id)
]);
