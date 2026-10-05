import {
  boolean,
  bigint,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { desc, sql } from "drizzle-orm";
import type { Punch, ResultOutcome } from "@o-tid/domain";

export const startRuleEnum = pgEnum("start_rule", ["FIXED", "PUNCH"]);
export const paymentStatusEnum = pgEnum("payment_status", ["UNMARKED", "UNPAID", "PAID", "WAIVED"]);
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
  "SHORTENED_COURSE_CLASS_TRANSFER"
]);
export const stationCredentialScopeEnum = pgEnum("station_credential_scope", ["READOUT"]);
export const pairingAdminCapabilityEnum = pgEnum("pairing_admin_capability", [
  "MANAGE_RACE",
  "PAIR_STATION",
  "IMPORT_IOF",
  "CHANGE_ENTRY_CLASS",
  "CHANGE_ENTRY_START_TIME",
  "DRAW_CLASS_START_TIMES",
  "CHANGE_ENTRY_CARD",
  "CHANGE_ENTRY_IDENTITY",
  "REGISTER_ENTRY",
  "RECALCULATE_RESULT",
  "VIEW_RACE_OVERVIEW",
  "VIEW_START_LIST",
  "VIEW_SPEAKER_BOARD",
  "START_CHECKIN",
  "FINISH_FOREST_WATCH",
  "PUBLISH_START_LIST",
  "VIEW_READOUT_RESULT_HISTORY",
  "EXPORT_IOF_RESULT_LIST",
  "FINALIZE_RESULTS",
  "DECIDE_DID_NOT_START",
  "WITHDRAW_DID_NOT_START",
  "DISQUALIFY_RESULT",
  "WITHDRAW_DISQUALIFICATION",
  "APPROVE_RESULT",
  "WITHDRAW_RESULT_APPROVAL",
  "DECIDE_DID_NOT_FINISH",
  "WITHDRAW_DID_NOT_FINISH",
  "DECIDE_OUT_OF_COMPETITION",
  "WITHDRAW_OUT_OF_COMPETITION",
  "DECIDE_WITHOUT_TIMING",
  "WITHDRAW_WITHOUT_TIMING",
  "MANAGE_PM_DOCUMENT"
]);
export const pmScanJobStateEnum = pgEnum("pm_scan_job_state", ["PENDING", "LEASED", "FINISHED"]);
export const eventAdministrationRoleEnum = pgEnum("event_administration_role", ["OWNER", "ADMIN"]);
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
export type RaceTypeValue = "TRAINING" | "SMALL" | "STANDARD" | "FORKED" | "RELAY" | "ROGAINING";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  check("race_type_check", sql`${table.raceType} in ('TRAINING', 'SMALL', 'STANDARD', 'FORKED', 'RELAY', 'ROGAINING')`),
  index("race_event_idx").on(table.eventId),
  uniqueIndex("race_id_event_uidx").on(table.id, table.eventId)
]);

export const courses = pgTable("course", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  name: text("name").notNull(),
  externalSource: text("external_source"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("course_external_uidx").on(table.raceId, table.externalSource, table.externalId), uniqueIndex("course_id_race_uidx").on(table.id, table.raceId)]);

export const courseVersions = pgTable("course_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => courses.id),
  version: integer("version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("course_version_uidx").on(table.courseId, table.version), uniqueIndex("course_version_id_course_uidx").on(table.id, table.courseId)]);

export const controls = pgTable("control", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  code: integer("code").notNull(),
  kind: text("kind").notNull().default("CONTROL"),
  /** Rogaining (migration 0097): poäng när arrangören ändrat förvalet (kontrollkoden delat med tio). NULL = förvalet. */
  points: integer("points"),
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
  sequence: integer("sequence").notNull()
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
  externalSource: text("external_source"),
  externalId: text("external_id"),
  version: integer("version").notNull().default(1),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("UNMARKED"),
  paymentStatusVersion: integer("payment_status_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_external_uidx").on(table.raceId, table.externalSource, table.externalId),
  uniqueIndex("entry_race_public_result_uidx").on(table.raceId, table.publicResultId),
  uniqueIndex("entry_id_race_uidx").on(table.id, table.raceId),
  index("entry_class_idx").on(table.classId)
]);

/** TASK153: private account preference history for following public result links. */
export const userPublicResultFollowEvents = pgTable("account_public_result_follow", {
  eventSequence: bigint("event_sequence", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: uuid("request_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  raceId: uuid("race_id").notNull(),
  publicResultId: uuid("public_result_id").notNull(),
  followed: boolean("followed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("account_public_result_follow_request_uidx").on(table.requestId),
  index("account_public_result_follow_account_latest_idx")
    .on(table.accountId, table.raceId, table.publicResultId, desc(table.eventSequence)),
  index("account_public_result_follow_account_sequence_idx")
    .on(table.accountId, desc(table.eventSequence)),
  foreignKey({
    name: "account_public_result_follow_target_fk",
    columns: [table.raceId, table.publicResultId],
    foreignColumns: [entries.raceId, entries.publicResultId]
  })
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
  uniqueIndex("card_assignment_id_race_entry_card_uidx").on(table.id, table.raceId, table.entryId, table.cardNumber)
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

export const stationDevices = pgTable("station_device", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("station_device_external_uidx").on(table.deviceId)]);

export const stationCredentials = pgTable("station_credential", {
  id: uuid("id").primaryKey().defaultRandom(),
  stationDeviceId: uuid("station_device_id").notNull().references(() => stationDevices.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  scope: stationCredentialScopeEnum("scope").notNull(),
  generation: integer("generation").notNull(),
  secretHash: text("secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("station_credential_generation_uidx")
    .on(table.stationDeviceId, table.raceId, table.scope, table.generation),
  index("station_credential_race_idx").on(table.raceId, table.scope)
]);

export const stationCredentialRevocations = pgTable("station_credential_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  credentialId: uuid("credential_id").notNull().references(() => stationCredentials.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [uniqueIndex("station_credential_revocation_credential_uidx").on(table.credentialId)]);

export const pairingAdminAccessCredentials = pgTable("pairing_admin_access_credential", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  label: text("label").notNull(),
  secretHash: text("secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  index("pairing_admin_access_credential_race_idx").on(table.raceId, table.capability),
  uniqueIndex("pairing_admin_credential_scope_uidx").on(table.id, table.raceId, table.capability),
  check("pairing_admin_race_administrator_lifetime_check",
    sql`${table.capability}::text <> 'MANAGE_RACE' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`),
  check("pairing_admin_start_checkin_lifetime_check",
    sql`${table.capability}::text NOT IN ('START_CHECKIN', 'FINISH_FOREST_WATCH') OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`),
  check("pairing_admin_entry_start_time_lifetime_check",
    sql`${table.capability}::text <> 'CHANGE_ENTRY_START_TIME' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`),
  check("pairing_admin_entry_card_lifetime_check",
    sql`${table.capability}::text <> 'CHANGE_ENTRY_CARD' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`),
  check("pairing_admin_entry_identity_lifetime_check",
    sql`${table.capability}::text <> 'CHANGE_ENTRY_IDENTITY' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`),
  check("pairing_admin_entry_registration_lifetime_check",
    sql`${table.capability}::text <> 'REGISTER_ENTRY' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`),
  check(
    "pairing_admin_import_iof_lifetime_check",
    sql`${table.capability}::text <> 'IMPORT_IOF' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_entry_class_lifetime_check",
    sql`${table.capability}::text <> 'CHANGE_ENTRY_CLASS' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_result_recalculation_lifetime_check",
    sql`${table.capability}::text <> 'RECALCULATE_RESULT' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_race_overview_lifetime_check",
    sql`${table.capability}::text <> 'VIEW_RACE_OVERVIEW' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_start_list_lifetime_check",
    sql`${table.capability}::text <> 'VIEW_START_LIST' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_speaker_board_lifetime_check",
    sql`${table.capability}::text <> 'VIEW_SPEAKER_BOARD' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_pm_document_lifetime_check",
    sql`${table.capability}::text <> 'MANAGE_PM_DOCUMENT' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check("pairing_admin_start_list_publication_lifetime_check", sql`${table.capability}::text <> 'PUBLISH_START_LIST' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`),
  check(
    "pairing_admin_readout_result_history_lifetime_check",
    sql`${table.capability}::text <> 'VIEW_READOUT_RESULT_HISTORY' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_iof_result_list_export_lifetime_check",
    sql`${table.capability}::text <> 'EXPORT_IOF_RESULT_LIST' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_did_not_start_lifetime_check",
    sql`${table.capability}::text <> 'DECIDE_DID_NOT_START' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_did_not_start_withdrawal_lifetime_check",
    sql`${table.capability}::text <> 'WITHDRAW_DID_NOT_START' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_result_disqualification_lifetime_check",
    sql`${table.capability}::text <> 'DISQUALIFY_RESULT' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_result_disqualification_withdrawal_lifetime_check",
    sql`${table.capability}::text <> 'WITHDRAW_DISQUALIFICATION' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_result_approval_lifetime_check",
    sql`${table.capability}::text <> 'APPROVE_RESULT' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_result_approval_withdrawal_lifetime_check",
    sql`${table.capability}::text <> 'WITHDRAW_RESULT_APPROVAL' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_did_not_finish_lifetime_check",
    sql`${table.capability}::text <> 'DECIDE_DID_NOT_FINISH' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_did_not_finish_withdrawal_lifetime_check",
    sql`${table.capability}::text <> 'WITHDRAW_DID_NOT_FINISH' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_out_of_competition_lifetime_check",
    sql`${table.capability}::text <> 'DECIDE_OUT_OF_COMPETITION' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_out_of_competition_withdrawal_lifetime_check",
    sql`${table.capability}::text <> 'WITHDRAW_OUT_OF_COMPETITION' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_without_timing_lifetime_check",
    sql`${table.capability}::text <> 'DECIDE_WITHOUT_TIMING' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  ),
  check(
    "pairing_admin_without_timing_withdrawal_lifetime_check",
    sql`${table.capability}::text <> 'WITHDRAW_WITHOUT_TIMING' OR ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  )
]);

// Derived mutable MVCC marker only; immutable revocation journals remain authority.
export const pairingAdminRevocationGuards = pgTable("pairing_admin_revocation_guard", {
  credentialId: uuid("credential_id").primaryKey().references(() => pairingAdminAccessCredentials.id),
  generation: bigint("generation", { mode: "bigint" }).notNull().default(0n)
}, (table) => [check("pairing_admin_revocation_guard_generation_check", sql`${table.generation} >= 0`)]);

export const pairingAdminAccessCredentialRevocations = pgTable("pairing_admin_access_credential_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  credentialId: uuid("credential_id").notNull().references(() => pairingAdminAccessCredentials.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [uniqueIndex("pairing_admin_access_credential_revocation_uidx").on(table.credentialId)]);

export const pairingAdminSessions = pgTable("pairing_admin_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  accessCredentialId: uuid("access_credential_id").notNull().references(() => pairingAdminAccessCredentials.id),
  sessionSecretHash: text("session_secret_hash").notNull(),
  csrfSecretHash: text("csrf_secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [index("pairing_admin_session_credential_idx").on(table.accessCredentialId)]);

export const pairingAdminSessionRevocations = pgTable("pairing_admin_session_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => pairingAdminSessions.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [uniqueIndex("pairing_admin_session_revocation_uidx").on(table.sessionId)]);

/**
 * Immutable, race-scoped reservation for one PM upload. Slots make the 100
 * reservation ceiling concurrency-safe without a mutable quota counter.
 */
export const pmUploadReservations = pgTable("pm_upload_reservation", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  slot: integer("slot").notNull(),
  title: text("title").notNull(),
  mediaType: text("media_type").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("pm_upload_reservation_request_uidx").on(table.requestId),
  uniqueIndex("pm_upload_reservation_race_slot_uidx").on(table.raceId, table.slot),
  uniqueIndex("pm_upload_reservation_scope_content_uidx").on(table.id, table.raceId, table.sha256, table.byteLength),
  check("pm_upload_reservation_capability_check", sql`${table.capability}::text = 'MANAGE_PM_DOCUMENT'`),
  check("pm_upload_reservation_slot_check", sql`${table.slot} BETWEEN 1 AND 100`),
  check("pm_upload_reservation_title_check", sql`char_length(${table.title}) BETWEEN 1 AND 120 AND ${table.title} = btrim(${table.title})`),
  check("pm_upload_reservation_media_type_check", sql`${table.mediaType} = 'application/pdf'`),
  check("pm_upload_reservation_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("pm_upload_reservation_byte_length_check", sql`${table.byteLength} BETWEEN 1 AND 10485760`),
  foreignKey({
    name: "pm_upload_reservation_actor_scope_fk",
    columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability]
  })
]);

/** Every charged object-store PUT attempt; it is immutable even when PUT fails. */
export const pmUploadAttempts = pgTable("pm_upload_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id").notNull(),
  raceId: uuid("race_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  chargedAt: timestamp("charged_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("pm_upload_attempt_upload_number_uidx").on(table.uploadId, table.attemptNumber),
  uniqueIndex("pm_upload_attempt_manifest_scope_uidx").on(table.id, table.uploadId, table.raceId, table.sha256, table.byteLength),
  check("pm_upload_attempt_number_check", sql`${table.attemptNumber} BETWEEN 1 AND 8`),
  check("pm_upload_attempt_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("pm_upload_attempt_byte_length_check", sql`${table.byteLength} BETWEEN 1 AND 10485760`),
  foreignKey({
    name: "pm_upload_attempt_reservation_content_fk",
    columns: [table.uploadId, table.raceId, table.sha256, table.byteLength],
    foreignColumns: [pmUploadReservations.id, pmUploadReservations.raceId, pmUploadReservations.sha256, pmUploadReservations.byteLength]
  })
]);

/** One verified, exact object version at most for each reservation. */
export const pmObjectManifests = pgTable("pm_object_manifest", {
  uploadId: uuid("upload_id").primaryKey(),
  attemptId: uuid("attempt_id").notNull(),
  raceId: uuid("race_id").notNull(),
  storeId: uuid("store_id").notNull(),
  objectKey: text("object_key").notNull(),
  versionId: text("version_id").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  storedAt: timestamp("stored_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("pm_object_manifest_store_key_version_uidx").on(table.storeId, table.objectKey, table.versionId),
  check("pm_object_manifest_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("pm_object_manifest_byte_length_check", sql`${table.byteLength} BETWEEN 1 AND 10485760`),
  check("pm_object_manifest_object_key_check", sql`${table.objectKey} = 'pm/' || ${table.raceId}::text || '/' || ${table.attemptId}::text`),
  check("pm_object_manifest_version_id_check", sql`char_length(${table.versionId}) BETWEEN 1 AND 1024 AND ${table.versionId} ~ '^[A-Za-z0-9._~+/-]+$' AND ${table.versionId} <> 'null'`),
  foreignKey({
    name: "pm_object_manifest_attempt_scope_fk",
    columns: [table.attemptId, table.uploadId, table.raceId, table.sha256, table.byteLength],
    foreignColumns: [pmUploadAttempts.id, pmUploadAttempts.uploadId, pmUploadAttempts.raceId, pmUploadAttempts.sha256, pmUploadAttempts.byteLength]
  })
]);

/** Mutable orchestration only; a lease is never scan evidence. */
export const pmScanJobs = pgTable("pm_scan_job", {
  uploadId: uuid("upload_id").primaryKey().references(() => pmObjectManifests.uploadId),
  state: pmScanJobStateEnum("state").notNull().default("PENDING"),
  generation: bigint("generation", { mode: "bigint" }).notNull().default(0n),
  leaseOwner: uuid("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, (table) => [
  check("pm_scan_job_generation_check", sql`${table.generation} >= 0`),
  check(
    "pm_scan_job_lease_shape_check",
    sql`(${table.state}::text = 'LEASED' AND ${table.leaseOwner} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL AND ${table.generation} > 0 AND ${table.leaseUntil} > ${table.createdAt}) OR (${table.state}::text <> 'LEASED' AND ${table.leaseOwner} IS NULL AND ${table.leaseUntil} IS NULL)`
  )
]);
// SQL migration adds the deferred reverse pm_object_manifest(upload_id) ->
// pm_scan_job(upload_id) FK, so a manifest and its initial PENDING job commit atomically.

export const pmScanAttempts = pgTable("pm_scan_attempt", {
  uploadId: uuid("upload_id").notNull().references(() => pmScanJobs.uploadId),
  generation: bigint("generation", { mode: "bigint" }).notNull(),
  leaseOwner: uuid("lease_owner").notNull(),
  leasedAt: timestamp("leased_at", { withTimezone: true }).notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull()
}, (table) => [
  primaryKey({ name: "pm_scan_attempt_pk", columns: [table.uploadId, table.generation] }),
  uniqueIndex("pm_scan_attempt_owner_uidx").on(table.uploadId, table.generation, table.leaseOwner),
  check("pm_scan_attempt_generation_check", sql`${table.generation} > 0`),
  check("pm_scan_attempt_lease_check", sql`${table.leaseUntil} = ${table.leasedAt} + interval '5 minutes'`)
]);

export const pmScanReports = pgTable("pm_scan_report", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id").notNull().references(() => pmObjectManifests.uploadId),
  generation: bigint("generation", { mode: "bigint" }).notNull(),
  leaseOwner: uuid("lease_owner").notNull(),
  outcome: text("outcome").notNull(),
  publishable: boolean("publishable").notNull().default(false),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  contentHash: text("content_hash").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`)
}, (table) => [
  uniqueIndex("pm_scan_report_attempt_uidx").on(table.uploadId, table.generation),
  foreignKey({ name: "pm_scan_report_attempt_owner_fk",
    columns: [table.uploadId, table.generation, table.leaseOwner],
    foreignColumns: [pmScanAttempts.uploadId, pmScanAttempts.generation, pmScanAttempts.leaseOwner] }),
  check("pm_scan_report_outcome_check", sql`${table.outcome} IN ('PASSED','REJECTED','FAILED')`),
  check("pm_scan_report_native_only_check", sql`NOT ${table.publishable}`),
  check("pm_scan_report_evidence_check", sql`jsonb_typeof(${table.evidence}) = 'object'`),
  check("pm_scan_report_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`)
]);


export const eventCreationAccessCredentials = pgTable("event_creation_access_credential", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  secretHash: text("secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  check("event_creation_access_credential_label_check", sql`length(btrim(${table.label})) between 1 and 120`),
  check("event_creation_access_credential_secret_hash_check", sql`${table.secretHash} ~ '^[a-f0-9]{64}$'`),
  check("event_creation_access_credential_expiry_check", sql`${table.expiresAt} > ${table.issuedAt}`),
  check(
    "event_creation_access_credential_lifetime_check",
    sql`${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`
  )
]);

export const eventCreationAccessCredentialRevocations = pgTable("event_creation_access_credential_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  credentialId: uuid("credential_id").notNull().references(() => eventCreationAccessCredentials.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [
  uniqueIndex("event_creation_access_credential_revocation_uidx").on(table.credentialId),
  check("event_creation_access_credential_revocation_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`)
]);

export const eventCreationSessions = pgTable("event_creation_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  accessCredentialId: uuid("access_credential_id").notNull().references(() => eventCreationAccessCredentials.id),
  sessionSecretHash: text("session_secret_hash").notNull(),
  csrfSecretHash: text("csrf_secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  index("event_creation_session_credential_idx").on(table.accessCredentialId),
  check("event_creation_session_secret_hash_check", sql`${table.sessionSecretHash} ~ '^[a-f0-9]{64}$'`),
  check("event_creation_session_csrf_hash_check", sql`${table.csrfSecretHash} ~ '^[a-f0-9]{64}$'`),
  check("event_creation_session_expiry_check", sql`${table.expiresAt} > ${table.issuedAt}`),
  check("event_creation_session_lifetime_check", sql`${table.expiresAt} <= ${table.issuedAt} + interval '1 hour'`)
]);

export const eventCreationSessionRevocations = pgTable("event_creation_session_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => eventCreationSessions.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [
  uniqueIndex("event_creation_session_revocation_uidx").on(table.sessionId),
  check("event_creation_session_revocation_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`)
]);

export const eventCreationRequests = pgTable("event_creation_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull().references(() => eventCreationAccessCredentials.id),
  eventName: text("event_name").notNull(),
  raceName: text("race_name").notNull(),
  raceDate: date("race_date").notNull(),
  timeZone: text("time_zone").notNull(),
  eventId: uuid("event_id").notNull().references(() => events.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("event_creation_request_request_uidx").on(table.requestId),
  uniqueIndex("event_creation_request_event_uidx").on(table.eventId),
  uniqueIndex("event_creation_request_race_uidx").on(table.raceId),
  index("event_creation_request_actor_time_idx").on(table.actorCredentialId, table.createdAt),
  check("event_creation_request_event_name_check", sql`length(btrim(${table.eventName})) between 2 and 160`),
  check("event_creation_request_race_name_check", sql`length(btrim(${table.raceName})) between 2 and 160`),
  check("event_creation_request_time_zone_check", sql`length(btrim(${table.timeZone})) between 1 and 100`),
  foreignKey({
    columns: [table.raceId, table.eventId],
    foreignColumns: [races.id, races.eventId],
    name: "event_creation_request_race_event_fk"
  })
]);

/** Kontot (ADR-0172): e-post (normaliserad, unik), namn, superadmin, spärr och senaste inloggning. */
export const userAccounts = pgTable("user_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("user_account_email_uidx").on(table.email),
  check("user_account_email_check", sql`${table.email} = lower(btrim(${table.email})) AND length(${table.email}) BETWEEN 3 AND 254 AND ${table.email} ~ '^[^@[:space:]]+@[^@[:space:]]+$'`),
  check("user_account_display_name_check", sql`length(btrim(${table.displayName})) between 1 and 120`)
]);

/** Mutable MVCC marker only; immutable account/password/session journals remain authority. */
export const userAccountAuthGuards = pgTable("user_account_auth_guard", {
  accountId: uuid("account_id").primaryKey().references(() => userAccounts.id),
  generation: bigint("generation", { mode: "bigint" }).notNull().default(0n)
}, (table) => [check("user_account_auth_guard_generation_check", sql`${table.generation} >= 0`)]);

/** Rotation appends a new verifier version; older session versions then fail closed. */
export const userAccountPasswordVerifiers = pgTable("user_account_password_verifier", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  version: integer("version").notNull(),
  algorithm: text("algorithm").notNull(),
  saltHex: text("salt_hex").notNull(),
  verifierHex: text("verifier_hex").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("user_account_password_verifier_version_uidx").on(table.accountId, table.version),
  check("user_account_password_verifier_version_check", sql`${table.version} > 0`),
  check("user_account_password_verifier_algorithm_check", sql`${table.algorithm} = 'scrypt-v1'`),
  check("user_account_password_verifier_salt_check", sql`${table.saltHex} ~ '^[a-f0-9]{32}$'`),
  check("user_account_password_verifier_hash_check", sql`${table.verifierHex} ~ '^[a-f0-9]{64}$'`)
]);

/** Mutable, server-side online guessing control, including unknown login names. */
export const userAccountLoginThrottles = pgTable("user_account_login_throttle", {
  loginKeyHash: text("login_key_hash").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true })
}, (table) => [
  check("user_account_login_throttle_key_check", sql`${table.loginKeyHash} ~ '^[a-f0-9]{64}$'`),
  check("user_account_login_throttle_attempts_check", sql`${table.failedAttempts} >= 0`)
]);

/** Spärr mot upprepade registreringar och återställningsförfrågningar; nyckeln (IP eller e-post) lagras hashad. */
export const accountRequestThrottles = pgTable("account_request_throttle", {
  scope: text("scope").$type<"REGISTER_IP" | "RESET_IP" | "RESET_EMAIL">().notNull(),
  keyHash: text("key_hash").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull()
}, (table) => [
  primaryKey({ columns: [table.scope, table.keyHash] }),
  check("account_request_throttle_scope_check", sql`${table.scope} IN ('REGISTER_IP', 'RESET_IP', 'RESET_EMAIL')`),
  check("account_request_throttle_key_check", sql`${table.keyHash} ~ '^[a-f0-9]{64}$'`),
  check("account_request_throttle_attempts_check", sql`${table.attempts} >= 0`)
]);

/** Återställningslänk: hash av engångsnyckeln, en timme, en gång. */
export const passwordResetTokens = pgTable("password_reset_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdBySuperadmin: boolean("created_by_superadmin").notNull().default(false)
}, (table) => [
  uniqueIndex("password_reset_token_hash_uidx").on(table.tokenHash),
  index("password_reset_token_account_idx").on(table.accountId, table.createdAt),
  check("password_reset_token_hash_check", sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check("password_reset_token_lifetime_check",
    sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '1 hour'`)
]);

export type SuperadminActionKind = "GRANT_SUPERADMIN" | "REVOKE_SUPERADMIN" | "HIDE_RACE" | "UNHIDE_RACE" |
  "DELETE_EVENT" | "BLOCK_ACCOUNT" | "UNBLOCK_ACCOUNT" | "DELETE_ACCOUNT" | "CREATE_RESET_LINK";

/** Superadmins åtgärder (append-only, utan främmande nycklar så att loggen överlever borttagningar). */
export const superadminActions = pgTable("superadmin_action", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  actorAccountId: uuid("actor_account_id"),
  actorLabel: text("actor_label").notNull(),
  action: text("action").$type<SuperadminActionKind>().notNull(),
  targetType: text("target_type").$type<"ACCOUNT" | "EVENT" | "RACE">().notNull(),
  targetId: uuid("target_id").notNull(),
  targetLabel: text("target_label").notNull(),
  reason: text("reason").notNull()
}, (table) => [
  index("superadmin_action_created_idx").on(table.createdAt.desc()),
  check("superadmin_action_target_type_check", sql`${table.targetType} IN ('ACCOUNT', 'EVENT', 'RACE')`),
  check("superadmin_action_actor_label_check", sql`length(btrim(${table.actorLabel})) BETWEEN 1 AND 254`),
  check("superadmin_action_target_label_check", sql`length(btrim(${table.targetLabel})) BETWEEN 1 AND 320`),
  check("superadmin_action_reason_check", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`)
]);

export const userAccountSessions = pgTable("user_account_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  passwordVersion: integer("password_version").notNull(),
  sessionSecretHash: text("session_secret_hash").notNull(),
  csrfSecretHash: text("csrf_secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("user_account_session_id_account_uidx").on(table.id, table.accountId),
  index("user_account_session_account_idx").on(table.accountId, table.expiresAt),
  foreignKey({ name: "user_account_session_verifier_fk", columns: [table.accountId, table.passwordVersion],
    foreignColumns: [userAccountPasswordVerifiers.accountId, userAccountPasswordVerifiers.version] }),
  check("user_account_session_secret_hash_check", sql`${table.sessionSecretHash} ~ '^[a-f0-9]{64}$'`),
  check("user_account_session_csrf_hash_check", sql`${table.csrfSecretHash} ~ '^[a-f0-9]{64}$'`),
  check("user_account_session_lifetime_check",
    sql`${table.expiresAt} > ${table.issuedAt} AND ${table.expiresAt} <= ${table.issuedAt} + interval '31 days'`)
]);

export const userAccountSessionRevocations = pgTable("user_account_session_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => userAccountSessions.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [
  uniqueIndex("user_account_session_revocation_session_uidx").on(table.sessionId),
  check("user_account_session_revocation_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`)
]);

/** Administrative grant, not legal ownership or verified club membership. */
export const eventAdministrationGrants = pgTable("event_administration_grant", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  role: eventAdministrationRoleEnum("role").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("event_administration_grant_scope_uidx").on(table.id, table.accountId, table.eventId),
  uniqueIndex("event_administration_grant_owner_account_event_uidx").on(table.accountId, table.eventId)
    .where(sql`${table.role} = 'OWNER'`),
  index("event_administration_grant_account_idx").on(table.accountId, table.grantedAt)
]);

export const eventAdministrationAccessRequests = pgTable("event_administration_access_request", {
  requestId: uuid("request_id").primaryKey(),
  action: text("action").$type<"GRANT_ADMIN" | "REVOKE_ADMIN">().notNull(),
  actorAccountId: uuid("actor_account_id").notNull().references(() => userAccounts.id),
  eventId: uuid("event_id").notNull().references(() => events.id),
  targetAccountId: uuid("target_account_id").notNull().references(() => userAccounts.id),
  grantId: uuid("grant_id").notNull().references(() => eventAdministrationGrants.id),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index("event_administration_access_request_event_idx").on(table.eventId, table.createdAt),
  index("event_administration_access_request_actor_idx").on(table.actorAccountId, table.createdAt),
  foreignKey({ name: "event_administration_access_request_grant_scope_fk",
    columns: [table.grantId, table.targetAccountId, table.eventId],
    foreignColumns: [eventAdministrationGrants.id, eventAdministrationGrants.accountId, eventAdministrationGrants.eventId] }),
  check("event_administration_access_request_action_check", sql`${table.action} IN ('GRANT_ADMIN', 'REVOKE_ADMIN')`),
  check("event_administration_access_request_target_check", sql`${table.actorAccountId} <> ${table.targetAccountId}`),
  check("event_administration_access_request_reason_check",
    sql`${table.reason} IS NULL OR length(btrim(${table.reason})) BETWEEN 1 AND 240`)
]);

export const eventAdministrationGrantRevocations = pgTable("event_administration_grant_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  grantId: uuid("grant_id").notNull().references(() => eventAdministrationGrants.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [
  uniqueIndex("event_administration_grant_revocation_grant_uidx").on(table.grantId),
  check("event_administration_grant_revocation_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`)
]);

/** Mutable MVCC marker so a stale protected read cannot miss grant revocation. */
export const eventAdministrationGrantGuards = pgTable("event_administration_grant_guard", {
  grantId: uuid("grant_id").primaryKey().references(() => eventAdministrationGrants.id),
  generation: bigint("generation", { mode: "bigint" }).notNull().default(0n)
}, (table) => [check("event_administration_grant_guard_generation_check", sql`${table.generation} >= 0`)]);

export const userAccountEventCreationRequests = pgTable("user_account_event_creation_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorAccountId: uuid("actor_account_id").notNull().references(() => userAccounts.id),
  eventName: text("event_name").notNull(),
  raceName: text("race_name").notNull(),
  raceDate: date("race_date").notNull(),
  timeZone: text("time_zone").notNull(),
  raceType: text("race_type").$type<RaceTypeValue>().notNull().default("STANDARD"),
  eventId: uuid("event_id").notNull().references(() => events.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  check("user_account_event_creation_race_type_check", sql`${table.raceType} in ('TRAINING', 'SMALL', 'STANDARD', 'FORKED', 'RELAY', 'ROGAINING')`),
  uniqueIndex("user_account_event_creation_request_uidx").on(table.requestId),
  uniqueIndex("user_account_event_creation_event_uidx").on(table.eventId),
  uniqueIndex("user_account_event_creation_race_uidx").on(table.raceId),
  index("user_account_event_creation_actor_idx").on(table.actorAccountId, table.createdAt),
  check("user_account_event_creation_event_name_check", sql`length(btrim(${table.eventName})) between 2 and 160`),
  check("user_account_event_creation_race_name_check", sql`length(btrim(${table.raceName})) between 2 and 160`),
  check("user_account_event_creation_time_zone_check", sql`length(btrim(${table.timeZone})) between 1 and 100`),
  foreignKey({ name: "user_account_event_creation_race_event_fk", columns: [table.raceId, table.eventId],
    foreignColumns: [races.id, races.eventId] })
]);

/** A hidden, short-lived MANAGE_RACE delegation stays bound to its parent account session and grant. */
export const userAccountRaceDelegations = pgTable("user_account_race_delegation", {
  credentialId: uuid("credential_id").primaryKey().references(() => pairingAdminAccessCredentials.id),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  accountSessionId: uuid("account_session_id").notNull().references(() => userAccountSessions.id),
  grantId: uuid("grant_id").notNull().references(() => eventAdministrationGrants.id),
  eventId: uuid("event_id").notNull().references(() => events.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  index("user_account_race_delegation_session_idx").on(table.accountSessionId, table.expiresAt),
  foreignKey({ name: "user_account_race_delegation_session_scope_fk", columns: [table.accountSessionId, table.accountId],
    foreignColumns: [userAccountSessions.id, userAccountSessions.accountId] }),
  foreignKey({ name: "user_account_race_delegation_grant_scope_fk", columns: [table.grantId, table.accountId, table.eventId],
    foreignColumns: [eventAdministrationGrants.id, eventAdministrationGrants.accountId, eventAdministrationGrants.eventId] }),
  foreignKey({ name: "user_account_race_delegation_race_scope_fk", columns: [table.raceId, table.eventId],
    foreignColumns: [races.id, races.eventId] }),
  foreignKey({ name: "user_account_race_delegation_credential_scope_fk", columns: [table.credentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("user_account_race_delegation_capability_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("user_account_race_delegation_lifetime_check",
    sql`${table.expiresAt} > ${table.issuedAt} AND ${table.expiresAt} <= ${table.issuedAt} + interval '1 hour'`)
]);

/**
 * ADR-0170 beslut 4: tävlingens Eventor-koppling. Klubbens API-nyckel lagras bara krypterad
 * (AES-256-GCM, masternyckeln i serverns miljö). Eventors id är extern identitet.
 */
export const raceEventorLinks = pgTable("race_eventor_link", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  keyId: text("key_id"),
  iv: text("iv"),
  tag: text("tag"),
  ciphertext: text("ciphertext"),
  organisationId: text("organisation_id"),
  organisationName: text("organisation_name"),
  eventId: text("event_id"),
  eventName: text("event_name"),
  eventDate: date("event_date"),
  eventForm: text("event_form").$type<"INDIVIDUAL" | "RELAY" | "OTHER">(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

/** En läsning av Eventor eller en banfil som visas som skillnader och godkänns (migration 0096). */
export const sourceSnapshots = pgTable("source_snapshot", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  source: text("source").$type<"EVENTOR" | "COURSE_FILE">().notNull(),
  contentHash: text("content_hash").notNull(),
  projection: jsonb("projection").$type<Record<string, unknown>>().notNull(),
  originalXml: text("original_xml"),
  fileName: text("file_name"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  appliedRequestId: uuid("applied_request_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  actorCredentialId: uuid("actor_credential_id"),
  applyRequest: jsonb("apply_request").$type<Record<string, unknown>>(),
  applyResponse: jsonb("apply_response").$type<Record<string, unknown>>()
}, (table) => [
  uniqueIndex("source_snapshot_applied_request_uidx").on(table.appliedRequestId),
  index("source_snapshot_race_source_idx").on(table.raceId, table.source, table.fetchedAt)
]);

export const iofImportRequests = pgTable("iof_import_request", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  contentHash: text("content_hash").notNull(),
  importFileId: uuid("import_file_id").notNull().references(() => importFiles.id),
  outcome: text("outcome").$type<"stored" | "duplicate">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index("iof_import_request_race_time_idx").on(table.raceId, table.createdAt)
]);

export const entryClassChangeRequests = pgTable("entry_class_change_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  previousClassId: uuid("previous_class_id").notNull().references(() => classes.id),
  classId: uuid("class_id").notNull().references(() => classes.id),
  entryVersionBefore: integer("entry_version_before").notNull(),
  entryVersionAfter: integer("entry_version_after").notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_class_change_request_request_uidx").on(table.requestId),
  uniqueIndex("entry_class_change_request_entry_version_uidx").on(table.entryId, table.entryVersionBefore),
  index("entry_class_change_request_race_time_idx").on(table.raceId, table.changedAt),
  check("entry_class_change_request_expected_version_check",
    sql`${table.expectedEntryVersion} > 0 AND ${table.entryVersionBefore} = ${table.expectedEntryVersion}`),
  check("entry_class_change_request_entry_increment_check",
    sql`${table.entryVersionAfter} = ${table.entryVersionBefore} + 1`),
  check("entry_class_change_request_snapshot_increment_check",
    sql`${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter} = ${table.snapshotVersionBefore} + 1`),
  check("entry_class_change_request_class_change_check", sql`${table.previousClassId} <> ${table.classId}`)
]);

export const classCapacityChangeRequests = pgTable("class_capacity_change_request", {
  id: uuid("id").primaryKey().defaultRandom(), requestId: uuid("request_id").notNull().unique(),
  raceId: uuid("race_id").notNull().references(() => races.id), classId: uuid("class_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  previousMaxEntries: integer("previous_max_entries"), maxEntries: integer("max_entries"),
  versionBefore: integer("version_before").notNull(), versionAfter: integer("version_after").notNull(),
  entryCount: integer("entry_count").notNull(), changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, table => [
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("class_capacity_role_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("class_capacity_change_check", sql`${table.previousMaxEntries} IS DISTINCT FROM ${table.maxEntries}`),
  check("class_capacity_versions_check", sql`${table.versionBefore} > 0 AND ${table.versionAfter}::bigint = ${table.versionBefore}::bigint + 1`),
  check("class_capacity_limits_check", sql`(${table.previousMaxEntries} IS NULL OR ${table.previousMaxEntries} BETWEEN 0 AND 10000) AND (${table.maxEntries} IS NULL OR ${table.maxEntries} BETWEEN 0 AND 10000) AND ${table.entryCount} >= 0 AND (${table.maxEntries} IS NULL OR ${table.entryCount} <= ${table.maxEntries})`),
  uniqueIndex("class_capacity_version_uidx").on(table.classId, table.versionBefore)
]);

export const entryTransferRequests = pgTable("entry_transfer_request", {
  id: uuid("id").primaryKey().defaultRandom(), requestId: uuid("request_id").notNull().unique(),
  raceId: uuid("race_id").notNull().references(() => races.id), entryId: uuid("entry_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  previousClassId: uuid("previous_class_id").notNull(), targetClassId: uuid("target_class_id").notNull(),
  request: jsonb("request").notNull(), entryVersionBefore: integer("entry_version_before").notNull(),
  entryVersionAfter: integer("entry_version_after").notNull(), snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, table => [
  foreignKey({ columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ columns: [table.previousClassId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.targetClassId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("entry_transfer_role_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("entry_transfer_class_check", sql`${table.previousClassId} <> ${table.targetClassId}`),
  check("entry_transfer_request_check", sql`jsonb_typeof(${table.request}) = 'object'`),
  check("entry_transfer_entry_version_check", sql`${table.entryVersionBefore} > 0 AND ${table.entryVersionAfter}::bigint = ${table.entryVersionBefore}::bigint + 1`),
  check("entry_transfer_snapshot_version_check", sql`${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter}::bigint = ${table.snapshotVersionBefore}::bigint + 1`),
  uniqueIndex("entry_transfer_entry_version_uidx").on(table.entryId, table.entryVersionBefore),
  index("entry_transfer_race_time_idx").on(table.raceId, table.changedAt)
]);

export const entryStartTimeChangeRequests = pgTable("entry_start_time_change_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  previousFixedStartTime: timestamp("previous_fixed_start_time", { withTimezone: true }),
  fixedStartTime: timestamp("fixed_start_time", { withTimezone: true }).notNull(),
  classId: uuid("class_id").notNull().references(() => classes.id),
  entryVersionBefore: integer("entry_version_before").notNull(),
  entryVersionAfter: integer("entry_version_after").notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_start_time_change_request_request_uidx").on(table.requestId),
  uniqueIndex("entry_start_time_change_request_entry_version_uidx").on(table.entryId, table.entryVersionBefore),
  index("entry_start_time_change_request_race_time_idx").on(table.raceId, table.changedAt),
  check("entry_start_time_change_request_expected_version_check",
    sql`${table.expectedEntryVersion} > 0 AND ${table.entryVersionBefore} = ${table.expectedEntryVersion}`),
  check("entry_start_time_change_request_entry_increment_check",
    sql`${table.entryVersionAfter} = ${table.entryVersionBefore} + 1`),
  check("entry_start_time_change_request_snapshot_increment_check",
    sql`${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter} = ${table.snapshotVersionBefore} + 1`),
  check("entry_start_time_change_request_time_change_check", sql`${table.previousFixedStartTime} IS DISTINCT FROM ${table.fixedStartTime}`)
]);

export const entryCardChangeRequests = pgTable("entry_card_change_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  classId: uuid("class_id").notNull().references(() => classes.id),
  actorCredentialId: uuid("actor_credential_id").notNull().references(() => pairingAdminAccessCredentials.id),
  previousAssignmentId: uuid("previous_assignment_id").references(() => cardAssignments.id),
  previousCardNumber: text("previous_card_number"),
  activeAssignmentId: uuid("active_assignment_id").notNull().references(() => cardAssignments.id),
  cardNumber: text("card_number").notNull(),
  entryVersionBefore: integer("entry_version_before").notNull(),
  entryVersionAfter: integer("entry_version_after").notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_card_change_request_request_uidx").on(table.requestId),
  uniqueIndex("entry_card_change_request_entry_version_uidx").on(table.entryId, table.entryVersionBefore),
  index("entry_card_change_request_race_time_idx").on(table.raceId, table.changedAt),
  check("entry_card_change_request_versions_check", sql`${table.entryVersionBefore} > 0 AND ${table.entryVersionAfter} = ${table.entryVersionBefore} + 1 AND ${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter} = ${table.snapshotVersionBefore} + 1`),
  check("entry_card_change_request_previous_check", sql`(${table.previousAssignmentId} IS NULL) = (${table.previousCardNumber} IS NULL)`),
  check("entry_card_change_request_change_check", sql`${table.previousAssignmentId} IS DISTINCT FROM ${table.activeAssignmentId} AND ${table.previousCardNumber} IS DISTINCT FROM ${table.cardNumber}`)
]);

export const entryCardRentalChanges = pgTable("entry_card_rental_change", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  classId: uuid("class_id").notNull(),
  assignmentId: uuid("assignment_id").notNull(),
  cardNumber: text("card_number").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  previousIsRental: boolean("previous_is_rental").notNull(),
  isRental: boolean("is_rental").notNull(),
  entryVersionBefore: integer("entry_version_before").notNull(),
  entryVersionAfter: integer("entry_version_after").notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_card_rental_change_entry_version_uidx").on(table.entryId, table.entryVersionBefore),
  index("entry_card_rental_change_race_time_idx").on(table.raceId, table.changedAt),
  check("entry_card_rental_change_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("entry_card_rental_change_value_check", sql`${table.previousIsRental} IS DISTINCT FROM ${table.isRental}`),
  check("entry_card_rental_change_versions_check", sql`${table.entryVersionBefore} > 0 AND ${table.entryVersionAfter}::bigint = ${table.entryVersionBefore}::bigint + 1 AND ${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter}::bigint = ${table.snapshotVersionBefore}::bigint + 1`),
  foreignKey({ name: "entry_card_rental_change_entry_scope_fk", columns: [table.entryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "entry_card_rental_change_class_scope_fk", columns: [table.classId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "entry_card_rental_change_assignment_scope_fk", columns: [table.assignmentId, table.raceId, table.entryId, table.cardNumber],
    foreignColumns: [cardAssignments.id, cardAssignments.raceId, cardAssignments.entryId, cardAssignments.cardNumber] }),
  foreignKey({ name: "entry_card_rental_change_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

export const entryCardRentalReturnChanges = pgTable("entry_card_rental_return_change", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  classId: uuid("class_id").notNull(),
  assignmentId: uuid("assignment_id").notNull(),
  cardNumber: text("card_number").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  previousRentalReturned: boolean("previous_rental_returned").notNull(),
  rentalReturned: boolean("rental_returned").notNull(),
  entryVersionBefore: integer("entry_version_before").notNull(),
  entryVersionAfter: integer("entry_version_after").notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_card_rental_return_change_entry_version_uidx").on(table.entryId, table.entryVersionBefore),
  index("entry_card_rental_return_change_race_time_idx").on(table.raceId, table.changedAt),
  check("entry_card_rental_return_change_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("entry_card_rental_return_change_value_check", sql`${table.previousRentalReturned} IS DISTINCT FROM ${table.rentalReturned}`),
  check("entry_card_rental_return_change_versions_check", sql`${table.entryVersionBefore} > 0 AND ${table.entryVersionAfter}::bigint = ${table.entryVersionBefore}::bigint + 1 AND ${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter}::bigint = ${table.snapshotVersionBefore}::bigint + 1`),
  foreignKey({ name: "entry_card_rental_return_change_entry_scope_fk", columns: [table.entryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "entry_card_rental_return_change_class_scope_fk", columns: [table.classId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "entry_card_rental_return_change_assignment_scope_fk", columns: [table.assignmentId, table.raceId, table.entryId, table.cardNumber],
    foreignColumns: [cardAssignments.id, cardAssignments.raceId, cardAssignments.entryId, cardAssignments.cardNumber] }),
  foreignKey({ name: "entry_card_rental_return_change_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

export const entryCardRentalReuseRequests = pgTable("entry_card_rental_reuse_request", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull(),
  sourceEntryId: uuid("source_entry_id").notNull(),
  sourceClassId: uuid("source_class_id").notNull(),
  sourceAssignmentId: uuid("source_assignment_id").notNull(),
  cardNumber: text("card_number").notNull(),
  targetEntryId: uuid("target_entry_id").notNull(),
  targetClassId: uuid("target_class_id").notNull(),
  targetAssignmentId: uuid("target_assignment_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  sourceEntryVersionBefore: integer("source_entry_version_before").notNull(),
  sourceEntryVersionAfter: integer("source_entry_version_after").notNull(),
  targetEntryVersionBefore: integer("target_entry_version_before").notNull(),
  targetEntryVersionAfter: integer("target_entry_version_after").notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_card_rental_reuse_source_entry_version_uidx").on(table.sourceEntryId, table.sourceEntryVersionBefore),
  uniqueIndex("entry_card_rental_reuse_target_entry_version_uidx").on(table.targetEntryId, table.targetEntryVersionBefore),
  index("entry_card_rental_reuse_race_time_idx").on(table.raceId, table.changedAt),
  check("entry_card_rental_reuse_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("entry_card_rental_reuse_distinct_entries_check", sql`${table.sourceEntryId} <> ${table.targetEntryId}`),
  check("entry_card_rental_reuse_distinct_assignments_check", sql`${table.sourceAssignmentId} <> ${table.targetAssignmentId}`),
  check("entry_card_rental_reuse_versions_check", sql`${table.sourceEntryVersionBefore} > 0 AND ${table.sourceEntryVersionAfter}::bigint = ${table.sourceEntryVersionBefore}::bigint + 1 AND ${table.targetEntryVersionBefore} > 0 AND ${table.targetEntryVersionAfter}::bigint = ${table.targetEntryVersionBefore}::bigint + 1 AND ${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter}::bigint = ${table.snapshotVersionBefore}::bigint + 1`),
  foreignKey({ name: "entry_card_rental_reuse_source_entry_scope_fk", columns: [table.sourceEntryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "entry_card_rental_reuse_source_class_scope_fk", columns: [table.sourceClassId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "entry_card_rental_reuse_source_assignment_scope_fk", columns: [table.sourceAssignmentId, table.raceId, table.sourceEntryId, table.cardNumber],
    foreignColumns: [cardAssignments.id, cardAssignments.raceId, cardAssignments.entryId, cardAssignments.cardNumber] }),
  foreignKey({ name: "entry_card_rental_reuse_target_entry_scope_fk", columns: [table.targetEntryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "entry_card_rental_reuse_target_class_scope_fk", columns: [table.targetClassId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "entry_card_rental_reuse_target_assignment_scope_fk", columns: [table.targetAssignmentId, table.raceId, table.targetEntryId, table.cardNumber],
    foreignColumns: [cardAssignments.id, cardAssignments.raceId, cardAssignments.entryId, cardAssignments.cardNumber] }),
  foreignKey({ name: "entry_card_rental_reuse_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

export const entryPaymentStatusChanges = pgTable("entry_payment_status_change", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  classId: uuid("class_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  previousPaymentStatus: paymentStatusEnum("previous_payment_status").notNull(),
  paymentStatus: paymentStatusEnum("payment_status").notNull(),
  entryVersionAtChange: integer("entry_version_at_change").notNull(),
  paymentStatusVersionBefore: integer("payment_status_version_before").notNull(),
  paymentStatusVersionAfter: integer("payment_status_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_payment_status_change_entry_version_uidx").on(table.entryId, table.paymentStatusVersionBefore),
  index("entry_payment_status_change_race_time_idx").on(table.raceId, table.changedAt),
  check("entry_payment_status_change_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("entry_payment_status_change_value_check", sql`${table.previousPaymentStatus} IS DISTINCT FROM ${table.paymentStatus}`),
  check("entry_payment_status_change_versions_check", sql`${table.entryVersionAtChange} > 0 AND ${table.paymentStatusVersionBefore} > 0 AND ${table.paymentStatusVersionAfter}::bigint = ${table.paymentStatusVersionBefore}::bigint + 1`),
  foreignKey({ name: "entry_payment_status_change_entry_scope_fk", columns: [table.entryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "entry_payment_status_change_class_scope_fk", columns: [table.classId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "entry_payment_status_change_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

export const entryIdentityChangeRequests = pgTable("entry_identity_change_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull(),
  classId: uuid("class_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  previousIdentity: jsonb("previous_identity").notNull(),
  identity: jsonb("identity").notNull(),
  entryVersionBefore: integer("entry_version_before").notNull(),
  entryVersionAfter: integer("entry_version_after").notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_identity_change_request_request_uidx").on(table.requestId),
  uniqueIndex("entry_identity_change_request_entry_version_uidx").on(table.entryId, table.entryVersionBefore),
  index("entry_identity_change_request_race_time_idx").on(table.raceId, table.changedAt),
  check("entry_identity_change_versions_check", sql`${table.entryVersionBefore} > 0 AND ${table.entryVersionAfter}::bigint = ${table.entryVersionBefore}::bigint + 1 AND ${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter}::bigint = ${table.snapshotVersionBefore}::bigint + 1`),
  check("entry_identity_change_values_check", sql`jsonb_typeof(${table.previousIdentity}) = 'object' AND jsonb_typeof(${table.identity}) = 'object' AND ${table.previousIdentity} <> ${table.identity}`),
  check("entry_identity_change_capability_check", sql`${table.capability}::text IN ('CHANGE_ENTRY_IDENTITY', 'MANAGE_RACE')`),
  foreignKey({ name: "entry_identity_change_entry_scope_fk", columns: [table.entryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "entry_identity_change_class_scope_fk", columns: [table.classId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "entry_identity_change_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

export const entryRegistrationRequests = pgTable("entry_registration_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull().references(() => pairingAdminAccessCredentials.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  assignmentId: uuid("assignment_id").references(() => cardAssignments.id),
  request: jsonb("request").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  /** Starttiden som appen gav en efteranmäld i en lottad klass. */
  assignedStartTime: timestamp("assigned_start_time", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_registration_request_request_uidx").on(table.requestId),
  uniqueIndex("entry_registration_request_entry_uidx").on(table.entryId),
  index("entry_registration_request_race_time_idx").on(table.raceId, table.createdAt),
  check("entry_registration_request_object_check", sql`jsonb_typeof(${table.request}) = 'object'`),
  check("entry_registration_request_version_check", sql`${table.snapshotVersionAfter} > 1`)
]);

export const resultRecalculationRequests = pgTable("result_recalculation_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  expectedCardAssignmentId: uuid("expected_card_assignment_id").notNull()
    .references(() => cardAssignments.id),
  expectedReadoutId: uuid("expected_readout_id").notNull().references(() => cardReadouts.id),
  expectedLatestResultRevisionId: uuid("expected_latest_result_revision_id")
    .references(() => resultRevisions.id),
  expectedLatestResultRevision: integer("expected_latest_result_revision").notNull(),
  expectedEngineVersion: text("expected_engine_version").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull()
    .references(() => resultRevisions.id),
  createdResultRevision: integer("created_result_revision").notNull(),
  recalculatedAt: timestamp("recalculated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("result_recalculation_request_request_uidx").on(table.requestId),
  uniqueIndex("result_recalculation_request_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("result_recalculation_request_entry_previous_uidx")
    .on(table.entryId, table.expectedLatestResultRevision),
  index("result_recalculation_request_race_time_idx").on(table.raceId, table.recalculatedAt),
  check("result_recalculation_request_expected_entry_version_check", sql`${table.expectedEntryVersion} > 0`),
  check("result_recalculation_request_expected_snapshot_version_check", sql`${table.expectedSnapshotVersion} > 0`),
  check(
    "result_recalculation_request_expected_revision_pair_check",
    sql`(${table.expectedLatestResultRevisionId} IS NULL AND ${table.expectedLatestResultRevision} = 0) OR (${table.expectedLatestResultRevisionId} IS NOT NULL AND ${table.expectedLatestResultRevision} > 0)`
  ),
  check(
    "result_recalculation_request_created_revision_check",
    sql`${table.createdResultRevision} = ${table.expectedLatestResultRevision} + 1`
  ),
  check(
    "result_recalculation_request_engine_version_check",
    sql`length(btrim(${table.expectedEngineVersion})) BETWEEN 1 AND 64`
  )
]);

export const classResultRecalculations = pgTable("class_result_recalculation", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  classId: uuid("class_id").notNull(), actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(), expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  expectedEngineVersion: text("expected_engine_version").notNull(), manifestHash: text("manifest_hash").notNull(),
  request: jsonb("request").notNull(), response: jsonb("response").notNull(), recalculatedAt: timestamp("recalculated_at", { withTimezone: true }).notNull()
}, (table) => [index("class_result_recalculation_race_time_idx").on(table.raceId, table.recalculatedAt)]);

export const classResultRecalculationItems = pgTable("class_result_recalculation_item", {
  requestId: uuid("request_id").notNull().references(() => classResultRecalculations.requestId), raceId: uuid("race_id").notNull(),
  classId: uuid("class_id").notNull(), entryId: uuid("entry_id").notNull(), expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedAssignmentId: uuid("expected_assignment_id").notNull(), expectedReadoutId: uuid("expected_readout_id").notNull(),
  expectedResultRevisionId: uuid("expected_result_revision_id").notNull(), expectedResultRevision: integer("expected_result_revision").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(), createdResultRevision: integer("created_result_revision").notNull()
}, (table) => [primaryKey({ columns: [table.requestId, table.entryId] }), uniqueIndex("class_result_recalculation_item_created_uidx").on(table.createdResultRevisionId)]);

export const stationPairingGrants = pgTable("station_pairing_grant", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  scope: stationCredentialScopeEnum("scope").notNull(),
  secretHash: text("secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  credentialExpiresAt: timestamp("credential_expires_at", { withTimezone: true }).notNull(),
  issuerCredentialId: uuid("issuer_credential_id").references(() => pairingAdminAccessCredentials.id)
}, (table) => [index("station_pairing_grant_race_idx").on(table.raceId, table.scope)]);

export const stationPairingGrantRevocations = pgTable("station_pairing_grant_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  grantId: uuid("grant_id").notNull().references(() => stationPairingGrants.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [uniqueIndex("station_pairing_grant_revocation_grant_uidx").on(table.grantId)]);

export const stationPairingAttempts = pgTable("station_pairing_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  grantId: uuid("grant_id").notNull().references(() => stationPairingGrants.id),
  attemptId: uuid("attempt_id"),
  deviceId: uuid("device_id"),
  outcome: text("outcome").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull()
}, (table) => [index("station_pairing_attempt_grant_time_idx").on(table.grantId, table.attemptedAt)]);

export const stationPairingRedemptions = pgTable("station_pairing_redemption", {
  id: uuid("id").primaryKey().defaultRandom(),
  grantId: uuid("grant_id").notNull().references(() => stationPairingGrants.id),
  attemptId: uuid("attempt_id").notNull(),
  stationDeviceId: uuid("station_device_id").notNull().references(() => stationDevices.id),
  credentialId: uuid("credential_id").notNull().references(() => stationCredentials.id),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("station_pairing_redemption_grant_uidx").on(table.grantId),
  uniqueIndex("station_pairing_redemption_attempt_uidx").on(table.attemptId),
  uniqueIndex("station_pairing_redemption_credential_uidx").on(table.credentialId)
]);

export const deviceIngestOutcomes = pgTable("device_ingest_outcome", {
  rawMessageId: uuid("raw_message_id").primaryKey().references(() => rawDeviceMessages.id),
  serverResult: jsonb("server_result").$type<Record<string, unknown>>().notNull(),
  evaluationHash: text("evaluation_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const cardReadouts = pgTable("card_readout", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  rawMessageId: uuid("raw_message_id").notNull().references(() => rawDeviceMessages.id),
  cardNumber: text("card_number").notNull(),
  startPunchedAt: timestamp("start_punched_at", { withTimezone: true }),
  finishPunchedAt: timestamp("finish_punched_at", { withTimezone: true }),
  punches: jsonb("punches").$type<Punch[]>().notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("card_readout_raw_uidx").on(table.rawMessageId),
  uniqueIndex("card_readout_resolution_scope_uidx").on(table.id, table.raceId, table.rawMessageId, table.cardNumber)
]);

export const resultRevisions = pgTable("result_revision", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  readoutId: uuid("readout_id").references(() => cardReadouts.id),
  // The deferred reciprocal database foreign keys are strengthened in
  // migration 0015. Keeping this column relation-free here avoids a
  // TypeScript initialization cycle with the immutable decision journal.
  didNotStartDecisionId: uuid("did_not_start_decision_id"),
  // Migration 0016 supplies the deferred reciprocal foreign keys. These are
  // deliberately relation-free here to avoid initialization cycles with the
  // two immutable manual-disqualification journals below.
  disqualificationDecisionId: uuid("disqualification_decision_id"),
  disqualificationWithdrawalId: uuid("disqualification_withdrawal_id"),
  // Migration 0017 supplies the deferred reciprocal foreign keys for the
  // manual approval journals. These remain relation-free here to avoid
  // initialization cycles with tables declared below.
  approvalDecisionId: uuid("approval_decision_id"),
  approvalWithdrawalId: uuid("approval_withdrawal_id"),
  // Migration 0018 supplies the deferred reciprocal foreign keys for the
  // immutable DNF decision journal declared below.
  didNotFinishDecisionId: uuid("did_not_finish_decision_id"),
  // Migration 0019 supplies the deferred reciprocal foreign keys for the
  // immutable DNF withdrawal journal declared below.
  didNotFinishWithdrawalId: uuid("did_not_finish_withdrawal_id"),
  // Migration 0020 supplies the deferred reciprocal foreign keys for the
  // immutable out-of-competition decision journal declared below.
  notCompetingDecisionId: uuid("not_competing_decision_id"),
  // Migration 0021 supplies the deferred reciprocal foreign keys for the
  // immutable out-of-competition withdrawal journal declared below.
  notCompetingWithdrawalId: uuid("not_competing_withdrawal_id"),
  // Migration 0022 supplies the deferred reciprocal foreign keys for the
  // immutable without-timing decision journal declared below.
  withoutTimingDecisionId: uuid("without_timing_decision_id"),
  // Migration 0023 supplies the deferred reciprocal foreign keys for the
  // immutable without-timing withdrawal journal declared below.
  withoutTimingWithdrawalId: uuid("without_timing_withdrawal_id"),
  // Migration 0033 supplies deferred reciprocal foreign keys for the
  // immutable start-checkin DNS journals declared below.
  startCheckinDnsDecisionId: uuid("start_checkin_dns_decision_id"),
  // TASK092 keeps this nullable because historical and DNS revisions did not
  // (and must not) evaluate a class-control neutralization. The database
  // foreign key is introduced after the immutable decision table below.
  controlNeutralizationId: uuid("control_neutralization_id"),
  // TASK093 binds an explicit observed-finish correction to exactly one new
  // revision. The deferred reciprocal foreign keys live below with its
  // immutable journal to avoid a TypeScript initialization cycle.
  manualFinishTimeCorrectionId: uuid("manual_finish_time_correction_id"),
  // TASK094 identifies the append-only restoration of a TASK093 correction.
  manualFinishTimeCorrectionWithdrawalId: uuid("manual_finish_time_correction_withdrawal_id"),
  // TASK104 binds a corrected observed PUNCH start to one new result revision.
  manualPunchStartTimeCorrectionId: uuid("manual_punch_start_time_correction_id"),
  // TASK105 identifies the append-only restoration of a TASK104 correction.
  manualPunchStartTimeCorrectionWithdrawalId: uuid("manual_punch_start_time_correction_withdrawal_id"),
  // TASK135 binds the technical re-evaluation after an immutable shortened
  // course/class transfer. The reciprocal item foreign key is added only
  // after its immutable journal table below to avoid an initialization cycle.
  shortenedCourseClassTransferId: uuid("shortened_course_class_transfer_id"),
  revision: integer("revision").notNull(),
  cause: revisionCauseEnum("cause").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  evaluation: jsonb("evaluation").$type<ResultOutcome>().notNull(),
  engineVersion: text("engine_version").notNull(),
  snapshotVersion: integer("snapshot_version").notNull(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  published: boolean("published").notNull().default(true),
  // ADR-0169 beslut 1: hash av löparens bedömningsunderlag när revisionen skapades.
  // Sätts alltid av databasutlösaren i migration 0089; äldre revisioner har NULL.
  basisHash: text("basis_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("result_revision_entry_revision_uidx").on(table.entryId, table.revision),
  uniqueIndex("result_revision_did_not_start_decision_uidx").on(table.didNotStartDecisionId),
  uniqueIndex("result_revision_disqualification_decision_uidx").on(table.disqualificationDecisionId),
  uniqueIndex("result_revision_disqualification_withdrawal_uidx").on(table.disqualificationWithdrawalId),
  uniqueIndex("result_revision_approval_decision_uidx").on(table.approvalDecisionId),
  uniqueIndex("result_revision_approval_withdrawal_uidx").on(table.approvalWithdrawalId),
  uniqueIndex("result_revision_did_not_finish_decision_uidx").on(table.didNotFinishDecisionId),
  uniqueIndex("result_revision_did_not_finish_withdrawal_uidx").on(table.didNotFinishWithdrawalId),
  uniqueIndex("result_revision_not_competing_decision_uidx").on(table.notCompetingDecisionId),
  uniqueIndex("result_revision_not_competing_withdrawal_uidx").on(table.notCompetingWithdrawalId),
  uniqueIndex("result_revision_without_timing_decision_uidx").on(table.withoutTimingDecisionId),
  uniqueIndex("result_revision_without_timing_withdrawal_uidx").on(table.withoutTimingWithdrawalId),
  uniqueIndex("result_revision_start_checkin_dns_decision_uidx").on(table.startCheckinDnsDecisionId),
  uniqueIndex("result_revision_manual_finish_time_correction_uidx").on(table.manualFinishTimeCorrectionId),
  uniqueIndex("result_revision_manual_finish_time_correction_withdrawal_uidx").on(table.manualFinishTimeCorrectionWithdrawalId),
  uniqueIndex("result_revision_manual_punch_start_time_correction_uidx").on(table.manualPunchStartTimeCorrectionId),
  uniqueIndex("result_revision_manual_punch_start_time_correction_withdrawal_uidx").on(table.manualPunchStartTimeCorrectionWithdrawalId),
  uniqueIndex("result_revision_exact_source_tuple_uidx")
    .on(table.id, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_private_route_context_scope_uidx")
    .on(table.id, table.raceId, table.entryId, table.revision, table.courseVersionId),
  uniqueIndex("result_revision_dns_source_tuple_uidx")
    .on(table.id, table.didNotStartDecisionId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_disqualification_source_tuple_uidx")
    .on(table.id, table.disqualificationDecisionId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_disqualification_withdrawal_source_tuple_uidx")
    .on(table.id, table.disqualificationWithdrawalId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_approval_source_tuple_uidx")
    .on(table.id, table.approvalDecisionId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_approval_withdrawal_source_tuple_uidx")
    .on(table.id, table.approvalWithdrawalId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_did_not_finish_source_tuple_uidx")
    .on(table.id, table.didNotFinishDecisionId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_did_not_finish_withdrawal_source_tuple_uidx")
    .on(table.id, table.didNotFinishWithdrawalId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_not_competing_source_tuple_uidx")
    .on(table.id, table.notCompetingDecisionId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_not_competing_withdrawal_source_tuple_uidx")
    .on(table.id, table.notCompetingWithdrawalId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_without_timing_source_tuple_uidx")
    .on(table.id, table.withoutTimingDecisionId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_without_timing_withdrawal_source_tuple_uidx")
    .on(table.id, table.withoutTimingWithdrawalId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_start_checkin_dns_source_tuple_uidx")
    .on(table.id, table.startCheckinDnsDecisionId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_manual_finish_time_correction_source_tuple_uidx")
    .on(table.id, table.manualFinishTimeCorrectionId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_manual_finish_time_correction_withdrawal_source_tuple_uidx")
    .on(table.id, table.manualFinishTimeCorrectionWithdrawalId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_manual_punch_start_time_correction_source_tuple_uidx")
    .on(table.id, table.manualPunchStartTimeCorrectionId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_manual_punch_start_time_correction_withdrawal_source_tuple_uidx")
    .on(table.id, table.manualPunchStartTimeCorrectionWithdrawalId, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_shortened_course_class_transfer_source_tuple_uidx")
    .on(table.id, table.shortenedCourseClassTransferId, table.raceId, table.entryId, table.revision),
  index("result_revision_public_idx").on(table.raceId, table.published)
]);

/**
 * Bounded technical wake-up markers for public result SSE (ADR-0135).
 * They are not result history and intentionally contain no entry/revision data.
 */
export const publicResultUpdateEvents = pgTable("public_result_update_event", {
  eventSequence: bigint("event_sequence", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index("public_result_update_event_race_sequence_idx").on(table.raceId, table.eventSequence)
]);

/** Immutable, class-scoped rule for one exact control occurrence. */
export const classControlNeutralizations = pgTable("class_control_neutralization", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  classId: uuid("class_id").notNull(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  courseControlId: uuid("course_control_id").notNull().references(() => courseControls.id),
  sequence: integer("sequence").notNull(),
  controlCode: integer("control_code").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  basisHash: text("basis_hash").notNull(),
  request: jsonb("request").notNull(),
  response: jsonb("response").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("class_control_neutralization_class_course_version_uidx")
    .on(table.classId, table.courseVersionId),
  index("class_control_neutralization_race_idx").on(table.raceId)
]);

/** Immutable provenance for one explicit correction of an observed finish time. */
export const manualFinishTimeCorrections = pgTable("manual_finish_time_correction", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  classId: uuid("class_id").notNull(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  basisHash: text("basis_hash").notNull(),
  sourceResultRevisionId: uuid("source_result_revision_id").notNull(),
  sourceResultRevision: integer("source_result_revision").notNull(),
  sourceReadoutId: uuid("source_readout_id").notNull().references(() => cardReadouts.id),
  sourceFinishTime: timestamp("source_finish_time", { withTimezone: true }).notNull(),
  correctedFinishTime: timestamp("corrected_finish_time", { withTimezone: true }).notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  correctedAt: timestamp("corrected_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("manual_finish_time_correction_source_uidx").on(table.sourceResultRevisionId),
  uniqueIndex("manual_finish_time_correction_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("manual_finish_time_correction_result_pair_uidx")
    .on(table.requestId, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("manual_finish_time_correction_race_time_idx").on(table.raceId, table.correctedAt),
  check("manual_finish_time_correction_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("manual_finish_time_correction_positive_check", sql`${table.expectedEntryVersion} > 0 AND ${table.expectedSnapshotVersion} > 0 AND ${table.sourceResultRevision} > 0 AND ${table.createdResultRevision} > 0`),
  check("manual_finish_time_correction_revision_chain_check", sql`${table.createdResultRevision}::bigint = ${table.sourceResultRevision}::bigint + 1`),
  check("manual_finish_time_correction_finish_check", sql`${table.sourceFinishTime} <> ${table.correctedFinishTime}`),
  check("manual_finish_time_correction_hash_check", sql`${table.basisHash} ~ '^[a-f0-9]{64}$'`),
  check("manual_finish_time_correction_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`),
  foreignKey({ name: "manual_finish_time_correction_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "manual_finish_time_correction_class_scope_fk", columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "manual_finish_time_correction_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  foreignKey({ name: "manual_finish_time_correction_source_result_fk", columns: [table.sourceResultRevisionId, table.raceId, table.entryId, table.sourceResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] }),
  foreignKey({ name: "manual_finish_time_correction_result_pair_fk", columns: [table.createdResultRevisionId, table.requestId, table.raceId, table.entryId, table.createdResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.manualFinishTimeCorrectionId, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] })
]);

/** Immutable provenance for one explicit correction of an observed PUNCH start time. */
export const manualPunchStartTimeCorrections = pgTable("manual_punch_start_time_correction", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  classId: uuid("class_id").notNull(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  basisHash: text("basis_hash").notNull(),
  sourceResultRevisionId: uuid("source_result_revision_id").notNull(),
  sourceResultRevision: integer("source_result_revision").notNull(),
  sourceReadoutId: uuid("source_readout_id").notNull().references(() => cardReadouts.id),
  sourceStartTime: timestamp("source_start_time", { withTimezone: true }).notNull(),
  correctedStartTime: timestamp("corrected_start_time", { withTimezone: true }).notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  correctedAt: timestamp("corrected_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("manual_punch_start_time_correction_source_uidx").on(table.sourceResultRevisionId),
  uniqueIndex("manual_punch_start_time_correction_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("manual_punch_start_time_correction_result_pair_uidx")
    .on(table.requestId, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("manual_punch_start_time_correction_race_time_idx").on(table.raceId, table.correctedAt),
  check("manual_punch_start_time_correction_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("manual_punch_start_time_correction_positive_check", sql`${table.expectedEntryVersion} > 0 AND ${table.expectedSnapshotVersion} > 0 AND ${table.sourceResultRevision} > 0 AND ${table.createdResultRevision} > 0`),
  check("manual_punch_start_time_correction_revision_chain_check", sql`${table.createdResultRevision}::bigint = ${table.sourceResultRevision}::bigint + 1`),
  check("manual_punch_start_time_correction_start_check", sql`${table.sourceStartTime} <> ${table.correctedStartTime}`),
  check("manual_punch_start_time_correction_hash_check", sql`${table.basisHash} ~ '^[a-f0-9]{64}$'`),
  check("manual_punch_start_time_correction_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`),
  foreignKey({ name: "manual_punch_start_time_correction_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "manual_punch_start_time_correction_class_scope_fk", columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "manual_punch_start_time_correction_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  foreignKey({ name: "manual_punch_start_time_correction_source_result_fk", columns: [table.sourceResultRevisionId, table.raceId, table.entryId, table.sourceResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] }),
  foreignKey({ name: "manual_punch_start_time_correction_result_pair_fk", columns: [table.createdResultRevisionId, table.requestId, table.raceId, table.entryId, table.createdResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.manualPunchStartTimeCorrectionId, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] })
]);

/** Immutable provenance for restoring the direct technical source of one TASK104 correction. */
export const manualPunchStartTimeCorrectionWithdrawals = pgTable("manual_punch_start_time_correction_withdrawal", {
  requestId: uuid("request_id").primaryKey(),
  id: uuid("id").notNull().unique(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  classId: uuid("class_id").notNull(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  basisHash: text("basis_hash").notNull(),
  correctionId: uuid("correction_id").notNull(),
  sourceResultRevisionId: uuid("source_result_revision_id").notNull(),
  sourceResultRevision: integer("source_result_revision").notNull(),
  correctedResultRevisionId: uuid("corrected_result_revision_id").notNull(),
  correctedResultRevision: integer("corrected_result_revision").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("manual_punch_start_time_correction_withdrawal_correction_uidx").on(table.correctionId),
  uniqueIndex("manual_punch_start_time_correction_withdrawal_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("manual_punch_start_time_correction_withdrawal_pair_uidx").on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("manual_punch_start_time_correction_withdrawal_race_time_idx").on(table.raceId, table.withdrawnAt),
  check("manual_punch_start_time_correction_withdrawal_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("manual_punch_start_time_correction_withdrawal_positive_check", sql`${table.expectedEntryVersion} > 0 AND ${table.expectedSnapshotVersion} > 0 AND ${table.sourceResultRevision} > 0 AND ${table.correctedResultRevision} > 0 AND ${table.createdResultRevision} > 0`),
  check("manual_punch_start_time_correction_withdrawal_chain_check", sql`${table.correctedResultRevision}::bigint = ${table.sourceResultRevision}::bigint + 1 AND ${table.createdResultRevision}::bigint = ${table.correctedResultRevision}::bigint + 1`),
  check("manual_punch_start_time_correction_withdrawal_hash_check", sql`${table.basisHash} ~ '^[a-f0-9]{64}$'`),
  check("manual_punch_start_time_correction_withdrawal_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`),
  foreignKey({ name: "manual_punch_start_time_correction_withdrawal_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "manual_punch_start_time_correction_withdrawal_class_scope_fk", columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "manual_punch_start_time_correction_withdrawal_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  foreignKey({ name: "manual_punch_start_time_correction_withdrawal_source_fk", columns: [table.sourceResultRevisionId, table.raceId, table.entryId, table.sourceResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] }),
  foreignKey({ name: "manual_punch_start_time_correction_withdrawal_corrected_fk", columns: [table.correctedResultRevisionId, table.correctionId, table.raceId, table.entryId, table.correctedResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.manualPunchStartTimeCorrectionId, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] }),
  foreignKey({ name: "mpscw_created_fk", columns: [table.createdResultRevisionId, table.id, table.raceId, table.entryId, table.createdResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.manualPunchStartTimeCorrectionWithdrawalId, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] })
]);

/** Immutable journal joining an original UNKNOWN_CARD observation to its later business resolution. */
export const unknownReadoutResolutions = pgTable("unknown_readout_resolution", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull(),
  readoutId: uuid("readout_id").notNull(),
  rawMessageId: uuid("raw_message_id").notNull(),
  cardNumber: text("card_number").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  target: text("target").notNull(),
  entryId: uuid("entry_id").notNull(),
  classId: uuid("class_id").notNull(),
  assignmentId: uuid("assignment_id").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("unknown_readout_resolution_readout_uidx").on(table.readoutId),
  uniqueIndex("unknown_readout_resolution_result_uidx").on(table.createdResultRevisionId),
  index("unknown_readout_resolution_race_time_idx").on(table.raceId, table.resolvedAt),
  check("unknown_readout_resolution_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("unknown_readout_resolution_target_check", sql`${table.target} IN ('EXISTING_ENTRY', 'NEW_ENTRY')`),
  check("unknown_readout_resolution_snapshot_check", sql`${table.expectedSnapshotVersion} > 0 AND ${table.snapshotVersionAfter}::bigint = ${table.expectedSnapshotVersion}::bigint + 1`),
  check("unknown_readout_resolution_revision_check", sql`${table.createdResultRevision} > 0`),
  check("unknown_readout_resolution_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`),
  foreignKey({ name: "unknown_readout_resolution_readout_scope_fk", columns: [table.readoutId, table.raceId, table.rawMessageId, table.cardNumber],
    foreignColumns: [cardReadouts.id, cardReadouts.raceId, cardReadouts.rawMessageId, cardReadouts.cardNumber] }),
  foreignKey({ name: "unknown_readout_resolution_entry_scope_fk", columns: [table.entryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "unknown_readout_resolution_class_scope_fk", columns: [table.classId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "unknown_readout_resolution_assignment_scope_fk", columns: [table.assignmentId, table.raceId, table.entryId, table.cardNumber],
    foreignColumns: [cardAssignments.id, cardAssignments.raceId, cardAssignments.entryId, cardAssignments.cardNumber] }),
  foreignKey({ name: "unknown_readout_resolution_result_scope_fk", columns: [table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] }),
  foreignKey({ name: "unknown_readout_resolution_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

/**
 * The immutable, explicit business decision behind a manual DNS revision.
 * It is deliberately both the idempotency journal and the provenance record;
 * a missing card readout must never be manufactured as this decision.
 */
export const didNotStartDecisions = pgTable("did_not_start_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  expectedLatestResultRevision: integer("expected_latest_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  // The exact reciprocal pair is expressed by the composite foreign keys in
  // migration 0015. A simple FK would prove existence but not that both rows
  // point to one another with the same race, entry and revision number.
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("did_not_start_decision_request_uidx").on(table.requestId),
  uniqueIndex("did_not_start_decision_entry_previous_uidx")
    .on(table.entryId, table.expectedLatestResultRevision),
  uniqueIndex("did_not_start_decision_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("did_not_start_decision_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("did_not_start_decision_race_time_idx").on(table.raceId, table.decidedAt),
  check("did_not_start_decision_expected_entry_version_check", sql`${table.expectedEntryVersion} > 0`),
  check("did_not_start_decision_expected_snapshot_version_check", sql`${table.expectedSnapshotVersion} > 0`),
  check("did_not_start_decision_expected_revision_check", sql`${table.expectedLatestResultRevision} = 0`),
  check("did_not_start_decision_created_revision_check", sql`${table.createdResultRevision} = 1`),
  check("did_not_start_decision_policy_version_check", sql`length(btrim(${table.policyVersion})) BETWEEN 1 AND 64`),
  check("did_not_start_decision_status_check", sql`${table.status} = 'DNS' AND ${table.reason} = 'DID_NOT_START'`),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.didNotStartDecisionId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "did_not_start_decision_result_pair_fk"
  })
]);

/**
 * An append-only correction to the lifecycle of one manual DNS decision.
 * It is not a result revision: the application must still prove under the
 * entry lock that the target is the absolute result head before insertion.
 */
export const didNotStartWithdrawals = pgTable("did_not_start_withdrawal", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  didNotStartDecisionId: uuid("did_not_start_decision_id").notNull(),
  withdrawnResultRevisionId: uuid("withdrawn_result_revision_id").notNull(),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  expectedLatestResultRevision: integer("expected_latest_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  reason: text("reason").notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("did_not_start_withdrawal_request_uidx").on(table.requestId),
  uniqueIndex("did_not_start_withdrawal_decision_uidx").on(table.didNotStartDecisionId),
  uniqueIndex("did_not_start_withdrawal_result_uidx").on(table.withdrawnResultRevisionId),
  index("did_not_start_withdrawal_race_time_idx").on(table.raceId, table.withdrawnAt, table.id),
  check("did_not_start_withdrawal_expected_entry_version_check", sql`${table.expectedEntryVersion} > 0`),
  check("did_not_start_withdrawal_expected_snapshot_version_check", sql`${table.expectedSnapshotVersion} > 0`),
  check("did_not_start_withdrawal_expected_revision_check", sql`${table.expectedLatestResultRevision} > 0`),
  check(
    "did_not_start_withdrawal_policy_version_check",
    sql`length(btrim(${table.policyVersion})) BETWEEN 1 AND 64`
  ),
  check("did_not_start_withdrawal_reason_check", sql`${table.reason} = 'ERRONEOUS_MANUAL_DNS'`),
  foreignKey({
    columns: [
      table.didNotStartDecisionId,
      table.withdrawnResultRevisionId,
      table.raceId,
      table.entryId,
      table.expectedLatestResultRevision
    ],
    foreignColumns: [
      didNotStartDecisions.id,
      didNotStartDecisions.createdResultRevisionId,
      didNotStartDecisions.raceId,
      didNotStartDecisions.entryId,
      didNotStartDecisions.createdResultRevision
    ],
    name: "did_not_start_withdrawal_target_fk"
  })
]);

/**
 * The immutable operator decision and idempotency journal for one exact
 * manual result disqualification. The source result remains reachable only
 * through targetResultRevisionId; the manual revision itself has no direct
 * card-readout provenance.
 */
export const resultDisqualificationDecisions = pgTable("result_disqualification_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  targetResultRevisionId: uuid("target_result_revision_id").notNull(),
  targetResultRevision: integer("target_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("result_disqualification_decision_request_uidx").on(table.requestId),
  uniqueIndex("result_disqualification_decision_target_uidx").on(table.targetResultRevisionId),
  uniqueIndex("result_disqualification_decision_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("result_disqualification_decision_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("result_disqualification_decision_race_time_idx").on(table.raceId, table.decidedAt, table.id),
  check(
    "result_disqualification_decision_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "result_disqualification_decision_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "result_disqualification_decision_target_revision_check",
    sql`${table.targetResultRevision} > 0`
  ),
  check(
    "result_disqualification_decision_created_revision_check",
    sql`${table.createdResultRevision} = ${table.targetResultRevision} + 1`
  ),
  check(
    "result_disqualification_decision_policy_version_check",
    sql`length(btrim(${table.policyVersion})) BETWEEN 1 AND 64`
  ),
  check(
    "result_disqualification_decision_status_check",
    sql`${table.status} = 'DSQ' AND ${table.reason} = 'MANUAL_DISQUALIFICATION'`
  ),
  check(
    "result_disqualification_decision_distinct_result_check",
    sql`${table.targetResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [table.targetResultRevisionId, table.raceId, table.entryId, table.targetResultRevision],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "result_disqualification_decision_target_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.disqualificationDecisionId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "result_disqualification_decision_result_pair_fk"
  })
]);

/**
 * Append-only closure of one manual disqualification. It freezes both the
 * observed absolute head and the exact OK/MP source copied into the new
 * restoration revision; neither source may be inferred by a later fallback.
 */
export const resultDisqualificationWithdrawals = pgTable("result_disqualification_withdrawal", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  disqualificationDecisionId: uuid("disqualification_decision_id").notNull(),
  withdrawnResultRevisionId: uuid("withdrawn_result_revision_id").notNull(),
  withdrawnResultRevision: integer("withdrawn_result_revision").notNull(),
  expectedLatestResultRevisionId: uuid("expected_latest_result_revision_id").notNull(),
  expectedLatestResultRevision: integer("expected_latest_result_revision").notNull(),
  restoredFromResultRevisionId: uuid("restored_from_result_revision_id").notNull(),
  restoredFromResultRevision: integer("restored_from_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("result_disqualification_withdrawal_request_uidx").on(table.requestId),
  uniqueIndex("result_disqualification_withdrawal_decision_uidx").on(table.disqualificationDecisionId),
  uniqueIndex("result_disqualification_withdrawal_result_uidx").on(table.withdrawnResultRevisionId),
  uniqueIndex("result_disqualification_withdrawal_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("result_disqualification_withdrawal_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("result_disqualification_withdrawal_race_time_idx").on(table.raceId, table.withdrawnAt, table.id),
  check(
    "result_disqualification_withdrawal_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "result_disqualification_withdrawal_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "result_disqualification_withdrawal_revision_chain_check",
    sql`${table.withdrawnResultRevision} > 0
      AND ${table.expectedLatestResultRevision} >= ${table.withdrawnResultRevision}
      AND ${table.restoredFromResultRevision} > 0
      AND ${table.restoredFromResultRevision} <= ${table.expectedLatestResultRevision}
      AND ${table.createdResultRevision} = ${table.expectedLatestResultRevision} + 1`
  ),
  check(
    "result_disqualification_withdrawal_policy_version_check",
    sql`length(btrim(${table.policyVersion})) BETWEEN 1 AND 64`
  ),
  check(
    "result_disqualification_withdrawal_reason_check",
    sql`${table.reason} = 'ERRONEOUS_MANUAL_DISQUALIFICATION'`
  ),
  check(
    "result_disqualification_withdrawal_distinct_results_check",
    sql`${table.withdrawnResultRevisionId} <> ${table.restoredFromResultRevisionId}
      AND ${table.withdrawnResultRevisionId} <> ${table.createdResultRevisionId}
      AND ${table.restoredFromResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [
      table.disqualificationDecisionId,
      table.withdrawnResultRevisionId,
      table.raceId,
      table.entryId,
      table.withdrawnResultRevision
    ],
    foreignColumns: [
      resultDisqualificationDecisions.id,
      resultDisqualificationDecisions.createdResultRevisionId,
      resultDisqualificationDecisions.raceId,
      resultDisqualificationDecisions.entryId,
      resultDisqualificationDecisions.createdResultRevision
    ],
    name: "result_disqualification_withdrawal_decision_fk"
  }),
  foreignKey({
    columns: [
      table.expectedLatestResultRevisionId,
      table.raceId,
      table.entryId,
      table.expectedLatestResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "result_disqualification_withdrawal_latest_result_fk"
  }),
  foreignKey({
    columns: [
      table.restoredFromResultRevisionId,
      table.raceId,
      table.entryId,
      table.restoredFromResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "result_disqualification_withdrawal_restored_from_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.disqualificationWithdrawalId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "result_disqualification_withdrawal_result_pair_fk"
  })
]);

/**
 * The immutable, explicit business decision behind a manual approval of one
 * exact, timed MP result. The approval result itself has no direct readout
 * provenance; the source remains reachable through the target revision.
 */
export const resultApprovalDecisions = pgTable("result_approval_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  targetResultRevisionId: uuid("target_result_revision_id").notNull(),
  targetResultRevision: integer("target_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("result_approval_decision_request_uidx").on(table.requestId),
  uniqueIndex("result_approval_decision_target_uidx").on(table.targetResultRevisionId),
  uniqueIndex("result_approval_decision_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("result_approval_decision_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("result_approval_decision_race_time_idx").on(table.raceId, table.decidedAt, table.id),
  check(
    "result_approval_decision_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "result_approval_decision_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "result_approval_decision_target_revision_check",
    sql`${table.targetResultRevision} > 0`
  ),
  check(
    "result_approval_decision_created_revision_check",
    sql`${table.createdResultRevision} = ${table.targetResultRevision} + 1`
  ),
  check(
    "result_approval_decision_policy_version_check",
    sql`length(btrim(${table.policyVersion})) BETWEEN 1 AND 64`
  ),
  check(
    "result_approval_decision_status_check",
    sql`${table.status} = 'OK' AND ${table.reason} = 'MANUAL_APPROVAL'`
  ),
  check(
    "result_approval_decision_distinct_result_check",
    sql`${table.targetResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [table.targetResultRevisionId, table.raceId, table.entryId, table.targetResultRevision],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "result_approval_decision_target_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.approvalDecisionId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "result_approval_decision_result_pair_fk"
  })
]);

/**
 * Append-only closure of one manual approval. It freezes the observed
 * absolute head and the exact technical OK/MP source copied into the
 * restoration revision.
 */
export const resultApprovalWithdrawals = pgTable("result_approval_withdrawal", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  approvalDecisionId: uuid("approval_decision_id").notNull(),
  withdrawnResultRevisionId: uuid("withdrawn_result_revision_id").notNull(),
  withdrawnResultRevision: integer("withdrawn_result_revision").notNull(),
  expectedLatestResultRevisionId: uuid("expected_latest_result_revision_id").notNull(),
  expectedLatestResultRevision: integer("expected_latest_result_revision").notNull(),
  restoredFromResultRevisionId: uuid("restored_from_result_revision_id").notNull(),
  restoredFromResultRevision: integer("restored_from_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("result_approval_withdrawal_request_uidx").on(table.requestId),
  uniqueIndex("result_approval_withdrawal_decision_uidx").on(table.approvalDecisionId),
  uniqueIndex("result_approval_withdrawal_result_uidx").on(table.withdrawnResultRevisionId),
  uniqueIndex("result_approval_withdrawal_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("result_approval_withdrawal_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("result_approval_withdrawal_race_time_idx").on(table.raceId, table.withdrawnAt, table.id),
  check(
    "result_approval_withdrawal_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "result_approval_withdrawal_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "result_approval_withdrawal_revision_chain_check",
    sql`${table.withdrawnResultRevision} > 0
      AND ${table.expectedLatestResultRevision} >= ${table.withdrawnResultRevision}
      AND ${table.restoredFromResultRevision} > 0
      AND ${table.restoredFromResultRevision} <= ${table.expectedLatestResultRevision}
      AND ${table.createdResultRevision} = ${table.expectedLatestResultRevision} + 1`
  ),
  check(
    "result_approval_withdrawal_policy_version_check",
    sql`length(btrim(${table.policyVersion})) BETWEEN 1 AND 64`
  ),
  check(
    "result_approval_withdrawal_reason_check",
    sql`${table.reason} = 'ERRONEOUS_MANUAL_APPROVAL'`
  ),
  check(
    "result_approval_withdrawal_distinct_results_check",
    sql`${table.withdrawnResultRevisionId} <> ${table.restoredFromResultRevisionId}
      AND ${table.withdrawnResultRevisionId} <> ${table.createdResultRevisionId}
      AND ${table.restoredFromResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [
      table.approvalDecisionId,
      table.withdrawnResultRevisionId,
      table.raceId,
      table.entryId,
      table.withdrawnResultRevision
    ],
    foreignColumns: [
      resultApprovalDecisions.id,
      resultApprovalDecisions.createdResultRevisionId,
      resultApprovalDecisions.raceId,
      resultApprovalDecisions.entryId,
      resultApprovalDecisions.createdResultRevision
    ],
    name: "result_approval_withdrawal_decision_fk"
  }),
  foreignKey({
    columns: [
      table.expectedLatestResultRevisionId,
      table.raceId,
      table.entryId,
      table.expectedLatestResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "result_approval_withdrawal_latest_result_fk"
  }),
  foreignKey({
    columns: [
      table.restoredFromResultRevisionId,
      table.raceId,
      table.entryId,
      table.restoredFromResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "result_approval_withdrawal_restored_from_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.approvalWithdrawalId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "result_approval_withdrawal_result_pair_fk"
  })
]);

/**
 * The immutable operator decision and idempotency journal for one explicit
 * status-only DNF. The exact technical OK/MP target remains the source of
 * observed timing facts; the created DNF revision has no direct readout.
 */
export const didNotFinishDecisions = pgTable("did_not_finish_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  targetResultRevisionId: uuid("target_result_revision_id").notNull(),
  targetResultRevision: integer("target_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("did_not_finish_decision_request_uidx").on(table.requestId),
  uniqueIndex("did_not_finish_decision_target_uidx").on(table.targetResultRevisionId),
  uniqueIndex("did_not_finish_decision_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("did_not_finish_decision_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  uniqueIndex("did_not_finish_decision_withdrawal_source_tuple_uidx").on(
    table.id,
    table.targetResultRevisionId,
    table.targetResultRevision,
    table.createdResultRevisionId,
    table.raceId,
    table.entryId,
    table.createdResultRevision
  ),
  index("did_not_finish_decision_race_entry_revision_idx")
    .on(table.raceId, table.entryId, table.createdResultRevision, table.id),
  index("did_not_finish_decision_race_time_idx").on(table.raceId, table.decidedAt, table.id),
  check(
    "did_not_finish_decision_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "did_not_finish_decision_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "did_not_finish_decision_target_revision_check",
    sql`${table.targetResultRevision} > 0`
  ),
  check(
    "did_not_finish_decision_created_revision_check",
    sql`${table.createdResultRevision} = ${table.targetResultRevision} + 1`
  ),
  check(
    "did_not_finish_decision_policy_version_check",
    sql`length(btrim(${table.policyVersion})) BETWEEN 1 AND 64`
  ),
  check(
    "did_not_finish_decision_status_check",
    sql`${table.status} = 'DNF' AND ${table.reason} = 'DID_NOT_FINISH'`
  ),
  check(
    "did_not_finish_decision_distinct_result_check",
    sql`${table.targetResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [table.targetResultRevisionId, table.raceId, table.entryId, table.targetResultRevision],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "did_not_finish_decision_target_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.didNotFinishDecisionId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "did_not_finish_decision_result_pair_fk"
  })
]);

/**
 * Append-only closure of one explicit DNF decision. It freezes the observed
 * absolute result head and the exact technical OK/MP source copied into the
 * reciprocal restoration revision.
 */
export const didNotFinishWithdrawals = pgTable("did_not_finish_withdrawal", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  didNotFinishDecisionId: uuid("did_not_finish_decision_id").notNull(),
  targetResultRevisionId: uuid("target_result_revision_id").notNull(),
  targetResultRevision: integer("target_result_revision").notNull(),
  withdrawnResultRevisionId: uuid("withdrawn_result_revision_id").notNull(),
  withdrawnResultRevision: integer("withdrawn_result_revision").notNull(),
  expectedLatestResultRevisionId: uuid("expected_latest_result_revision_id").notNull(),
  expectedLatestResultRevision: integer("expected_latest_result_revision").notNull(),
  restoredFromResultRevisionId: uuid("restored_from_result_revision_id").notNull(),
  restoredFromResultRevision: integer("restored_from_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("did_not_finish_withdrawal_request_uidx").on(table.requestId),
  uniqueIndex("did_not_finish_withdrawal_decision_uidx").on(table.didNotFinishDecisionId),
  uniqueIndex("did_not_finish_withdrawal_result_uidx").on(table.withdrawnResultRevisionId),
  uniqueIndex("did_not_finish_withdrawal_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("did_not_finish_withdrawal_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("did_not_finish_withdrawal_race_time_idx").on(table.raceId, table.withdrawnAt, table.id),
  check(
    "did_not_finish_withdrawal_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "did_not_finish_withdrawal_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "did_not_finish_withdrawal_revision_chain_check",
    sql`${table.targetResultRevision} > 0
      AND ${table.withdrawnResultRevision} = ${table.targetResultRevision} + 1
      AND ${table.expectedLatestResultRevision} >= ${table.withdrawnResultRevision}
      AND (
        ${table.restoredFromResultRevision} = ${table.targetResultRevision}
        OR ${table.restoredFromResultRevision} > ${table.withdrawnResultRevision}
      )
      AND ${table.restoredFromResultRevision} <= ${table.expectedLatestResultRevision}
      AND ${table.createdResultRevision} = ${table.expectedLatestResultRevision} + 1`
  ),
  check(
    "did_not_finish_withdrawal_policy_version_check",
    sql`${table.policyVersion} = 'did-not-finish-withdrawal-v1'`
  ),
  check(
    "did_not_finish_withdrawal_reason_check",
    sql`${table.reason} = 'ERRONEOUS_MANUAL_DID_NOT_FINISH'`
  ),
  check(
    "did_not_finish_withdrawal_distinct_results_check",
    sql`${table.targetResultRevisionId} <> ${table.withdrawnResultRevisionId}
      AND ${table.withdrawnResultRevisionId} <> ${table.restoredFromResultRevisionId}
      AND ${table.withdrawnResultRevisionId} <> ${table.createdResultRevisionId}
      AND ${table.restoredFromResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [
      table.didNotFinishDecisionId,
      table.targetResultRevisionId,
      table.targetResultRevision,
      table.withdrawnResultRevisionId,
      table.raceId,
      table.entryId,
      table.withdrawnResultRevision
    ],
    foreignColumns: [
      didNotFinishDecisions.id,
      didNotFinishDecisions.targetResultRevisionId,
      didNotFinishDecisions.targetResultRevision,
      didNotFinishDecisions.createdResultRevisionId,
      didNotFinishDecisions.raceId,
      didNotFinishDecisions.entryId,
      didNotFinishDecisions.createdResultRevision
    ],
    name: "did_not_finish_withdrawal_decision_fk"
  }),
  foreignKey({
    columns: [
      table.expectedLatestResultRevisionId,
      table.raceId,
      table.entryId,
      table.expectedLatestResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "did_not_finish_withdrawal_latest_result_fk"
  }),
  foreignKey({
    columns: [
      table.restoredFromResultRevisionId,
      table.raceId,
      table.entryId,
      table.restoredFromResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "did_not_finish_withdrawal_restored_from_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.didNotFinishWithdrawalId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "did_not_finish_withdrawal_result_pair_fk"
  })
]);

/**
 * The immutable operator decision and idempotency journal for one explicit
 * out-of-competition result. The created OOC revision has no direct readout;
 * its exact technical OK/MP source remains reachable through the target.
 */
export const notCompetingDecisions = pgTable("not_competing_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  targetResultRevisionId: uuid("target_result_revision_id").notNull(),
  targetResultRevision: integer("target_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("not_competing_decision_request_uidx").on(table.requestId),
  index("not_competing_decision_race_entry_revision_idx")
    .on(table.raceId, table.entryId, table.createdResultRevision, table.id),
  uniqueIndex("not_competing_decision_target_uidx").on(table.targetResultRevisionId),
  uniqueIndex("not_competing_decision_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("not_competing_decision_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  uniqueIndex("not_competing_decision_withdrawal_source_tuple_uidx")
    .on(
      table.id,
      table.targetResultRevisionId,
      table.targetResultRevision,
      table.createdResultRevisionId,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ),
  index("not_competing_decision_race_time_idx").on(table.raceId, table.decidedAt, table.id),
  check(
    "not_competing_decision_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "not_competing_decision_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "not_competing_decision_target_revision_check",
    sql`${table.targetResultRevision} > 0`
  ),
  check(
    "not_competing_decision_created_revision_check",
    sql`${table.createdResultRevision} = ${table.targetResultRevision} + 1`
  ),
  check(
    "not_competing_decision_policy_version_check",
    sql`${table.policyVersion} = 'out-of-competition-v1'`
  ),
  check(
    "not_competing_decision_status_check",
    sql`${table.status} = 'OOC' AND ${table.reason} = 'OUT_OF_COMPETITION'`
  ),
  check(
    "not_competing_decision_distinct_result_check",
    sql`${table.targetResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [table.targetResultRevisionId, table.raceId, table.entryId, table.targetResultRevision],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "not_competing_decision_target_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.notCompetingDecisionId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "not_competing_decision_result_pair_fk"
  })
]);

/**
 * Append-only closure of one explicit out-of-competition decision. It freezes
 * the observed absolute result head and the exact technical OK/MP source
 * copied into the reciprocal restoration revision.
 */
export const notCompetingWithdrawals = pgTable("not_competing_withdrawal", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  notCompetingDecisionId: uuid("not_competing_decision_id").notNull(),
  targetResultRevisionId: uuid("target_result_revision_id").notNull(),
  targetResultRevision: integer("target_result_revision").notNull(),
  withdrawnResultRevisionId: uuid("withdrawn_result_revision_id").notNull(),
  withdrawnResultRevision: integer("withdrawn_result_revision").notNull(),
  expectedLatestResultRevisionId: uuid("expected_latest_result_revision_id").notNull(),
  expectedLatestResultRevision: integer("expected_latest_result_revision").notNull(),
  restoredFromResultRevisionId: uuid("restored_from_result_revision_id").notNull(),
  restoredFromResultRevision: integer("restored_from_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("not_competing_withdrawal_request_uidx").on(table.requestId),
  uniqueIndex("not_competing_withdrawal_decision_uidx").on(table.notCompetingDecisionId),
  uniqueIndex("not_competing_withdrawal_result_uidx").on(table.withdrawnResultRevisionId),
  uniqueIndex("not_competing_withdrawal_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("not_competing_withdrawal_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("not_competing_withdrawal_race_time_idx").on(table.raceId, table.withdrawnAt, table.id),
  check(
    "not_competing_withdrawal_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "not_competing_withdrawal_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "not_competing_withdrawal_revision_chain_check",
    sql`${table.targetResultRevision} > 0
      AND ${table.withdrawnResultRevision} = ${table.targetResultRevision} + 1
      AND ${table.expectedLatestResultRevision} >= ${table.withdrawnResultRevision}
      AND (
        ${table.restoredFromResultRevision} = ${table.targetResultRevision}
        OR ${table.restoredFromResultRevision} > ${table.withdrawnResultRevision}
      )
      AND ${table.restoredFromResultRevision} <= ${table.expectedLatestResultRevision}
      AND ${table.createdResultRevision} = ${table.expectedLatestResultRevision} + 1`
  ),
  check(
    "not_competing_withdrawal_policy_version_check",
    sql`${table.policyVersion} = 'out-of-competition-withdrawal-v1'`
  ),
  check(
    "not_competing_withdrawal_reason_check",
    sql`${table.reason} = 'ERRONEOUS_MANUAL_OUT_OF_COMPETITION'`
  ),
  check(
    "not_competing_withdrawal_distinct_results_check",
    sql`${table.targetResultRevisionId} <> ${table.withdrawnResultRevisionId}
      AND ${table.withdrawnResultRevisionId} <> ${table.restoredFromResultRevisionId}
      AND ${table.withdrawnResultRevisionId} <> ${table.createdResultRevisionId}
      AND ${table.restoredFromResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [
      table.notCompetingDecisionId,
      table.targetResultRevisionId,
      table.targetResultRevision,
      table.withdrawnResultRevisionId,
      table.raceId,
      table.entryId,
      table.withdrawnResultRevision
    ],
    foreignColumns: [
      notCompetingDecisions.id,
      notCompetingDecisions.targetResultRevisionId,
      notCompetingDecisions.targetResultRevision,
      notCompetingDecisions.createdResultRevisionId,
      notCompetingDecisions.raceId,
      notCompetingDecisions.entryId,
      notCompetingDecisions.createdResultRevision
    ],
    name: "not_competing_withdrawal_decision_fk"
  }),
  foreignKey({
    columns: [
      table.expectedLatestResultRevisionId,
      table.raceId,
      table.entryId,
      table.expectedLatestResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "not_competing_withdrawal_latest_result_fk"
  }),
  foreignKey({
    columns: [
      table.restoredFromResultRevisionId,
      table.raceId,
      table.entryId,
      table.restoredFromResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "not_competing_withdrawal_restored_from_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.notCompetingWithdrawalId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "not_competing_withdrawal_result_pair_fk"
  })
]);

/**
 * The immutable operator decision and idempotency journal for one explicit
 * without-timing result. Target eligibility remains application/domain
 * semantics; the database proves only the exact target and reciprocal NT row.
 */
export const withoutTimingDecisions = pgTable("without_timing_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  targetResultRevisionId: uuid("target_result_revision_id").notNull(),
  targetResultRevision: integer("target_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("without_timing_decision_request_uidx").on(table.requestId),
  index("without_timing_decision_race_entry_revision_idx")
    .on(table.raceId, table.entryId, table.createdResultRevision, table.id),
  uniqueIndex("without_timing_decision_target_uidx").on(table.targetResultRevisionId),
  uniqueIndex("without_timing_decision_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("without_timing_decision_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  uniqueIndex("without_timing_decision_withdrawal_source_tuple_uidx")
    .on(
      table.id,
      table.targetResultRevisionId,
      table.targetResultRevision,
      table.createdResultRevisionId,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ),
  index("without_timing_decision_race_time_idx").on(table.raceId, table.decidedAt, table.id),
  check(
    "without_timing_decision_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "without_timing_decision_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "without_timing_decision_target_revision_check",
    sql`${table.targetResultRevision} > 0`
  ),
  check(
    "without_timing_decision_created_revision_check",
    sql`${table.createdResultRevision} = ${table.targetResultRevision} + 1`
  ),
  check(
    "without_timing_decision_policy_version_check",
    sql`${table.policyVersion} = 'without-timing-v1'`
  ),
  check(
    "without_timing_decision_status_check",
    sql`${table.status} = 'NT' AND ${table.reason} = 'WITHOUT_TIMING'`
  ),
  check(
    "without_timing_decision_distinct_result_check",
    sql`${table.targetResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [table.targetResultRevisionId, table.raceId, table.entryId, table.targetResultRevision],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "without_timing_decision_target_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.withoutTimingDecisionId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "without_timing_decision_result_pair_fk"
  })
]);

/**
 * Immutable closure of one without-timing lifecycle. The database proves the
 * exact decision, observed physical head, restoration source and reciprocal
 * restoration revision; source eligibility remains application/domain policy.
 */
export const withoutTimingWithdrawals = pgTable("without_timing_withdrawal", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
  expectedCourseVersionId: uuid("expected_course_version_id").notNull()
    .references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  withoutTimingDecisionId: uuid("without_timing_decision_id").notNull(),
  targetResultRevisionId: uuid("target_result_revision_id").notNull(),
  targetResultRevision: integer("target_result_revision").notNull(),
  withdrawnResultRevisionId: uuid("withdrawn_result_revision_id").notNull(),
  withdrawnResultRevision: integer("withdrawn_result_revision").notNull(),
  expectedLatestResultRevisionId: uuid("expected_latest_result_revision_id").notNull(),
  expectedLatestResultRevision: integer("expected_latest_result_revision").notNull(),
  restoredFromResultRevisionId: uuid("restored_from_result_revision_id").notNull(),
  restoredFromResultRevision: integer("restored_from_result_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  reason: text("reason").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("without_timing_withdrawal_request_uidx").on(table.requestId),
  uniqueIndex("without_timing_withdrawal_decision_uidx").on(table.withoutTimingDecisionId),
  uniqueIndex("without_timing_withdrawal_result_uidx").on(table.withdrawnResultRevisionId),
  uniqueIndex("without_timing_withdrawal_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("without_timing_withdrawal_created_source_tuple_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("without_timing_withdrawal_race_time_idx").on(table.raceId, table.withdrawnAt, table.id),
  check(
    "without_timing_withdrawal_expected_entry_version_check",
    sql`${table.expectedEntryVersion} > 0`
  ),
  check(
    "without_timing_withdrawal_expected_snapshot_check",
    sql`${table.expectedSnapshotVersion} > 0`
  ),
  check(
    "without_timing_withdrawal_revision_chain_check",
    sql`${table.targetResultRevision} > 0
      AND ${table.withdrawnResultRevision} = ${table.targetResultRevision} + 1
      AND ${table.expectedLatestResultRevision} >= ${table.withdrawnResultRevision}
      AND (
        ${table.restoredFromResultRevision} = ${table.targetResultRevision}
        OR ${table.restoredFromResultRevision} > ${table.withdrawnResultRevision}
      )
      AND ${table.restoredFromResultRevision} <= ${table.expectedLatestResultRevision}
      AND ${table.createdResultRevision} = ${table.expectedLatestResultRevision} + 1`
  ),
  check(
    "without_timing_withdrawal_policy_version_check",
    sql`${table.policyVersion} = 'without-timing-withdrawal-v1'`
  ),
  check(
    "without_timing_withdrawal_reason_check",
    sql`${table.reason} = 'ERRONEOUS_MANUAL_WITHOUT_TIMING'`
  ),
  check(
    "without_timing_withdrawal_distinct_results_check",
    sql`${table.targetResultRevisionId} <> ${table.withdrawnResultRevisionId}
      AND ${table.withdrawnResultRevisionId} <> ${table.restoredFromResultRevisionId}
      AND ${table.withdrawnResultRevisionId} <> ${table.createdResultRevisionId}
      AND ${table.restoredFromResultRevisionId} <> ${table.createdResultRevisionId}`
  ),
  foreignKey({
    columns: [
      table.withoutTimingDecisionId,
      table.targetResultRevisionId,
      table.targetResultRevision,
      table.withdrawnResultRevisionId,
      table.raceId,
      table.entryId,
      table.withdrawnResultRevision
    ],
    foreignColumns: [
      withoutTimingDecisions.id,
      withoutTimingDecisions.targetResultRevisionId,
      withoutTimingDecisions.targetResultRevision,
      withoutTimingDecisions.createdResultRevisionId,
      withoutTimingDecisions.raceId,
      withoutTimingDecisions.entryId,
      withoutTimingDecisions.createdResultRevision
    ],
    name: "without_timing_withdrawal_decision_fk"
  }),
  foreignKey({
    columns: [
      table.expectedLatestResultRevisionId,
      table.raceId,
      table.entryId,
      table.expectedLatestResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "without_timing_withdrawal_latest_result_fk"
  }),
  foreignKey({
    columns: [
      table.restoredFromResultRevisionId,
      table.raceId,
      table.entryId,
      table.restoredFromResultRevision
    ],
    foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision],
    name: "without_timing_withdrawal_restored_from_fk"
  }),
  foreignKey({
    columns: [
      table.createdResultRevisionId,
      table.id,
      table.raceId,
      table.entryId,
      table.createdResultRevision
    ],
    foreignColumns: [
      resultRevisions.id,
      resultRevisions.withoutTimingWithdrawalId,
      resultRevisions.raceId,
      resultRevisions.entryId,
      resultRevisions.revision
    ],
    name: "without_timing_withdrawal_result_pair_fk"
  })
]);

/**
 * An immutable business decision, not a live result projection. The frozen
 * JSON deliberately includes all display and course facts needed to prove a
 * later final export even if those live rows subsequently change.
 */
export const resultFinalizations = pgTable("result_finalization", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  scope: resultFinalizationScopeEnum("scope").notNull(),
  classId: uuid("class_id"),
  scopeRevision: integer("scope_revision").notNull(),
  sourceSnapshotVersion: integer("source_snapshot_version").notNull(),
  sourceHash: text("source_hash").notNull(),
  frozenProjection: jsonb("frozen_projection").$type<Record<string, unknown>>().notNull(),
  completeXml: text("complete_xml"),
  completeXmlHash: text("complete_xml_hash"),
  actorCredentialId: uuid("actor_credential_id").notNull()
    .references(() => pairingAdminAccessCredentials.id),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("result_finalization_request_uidx").on(table.requestId),
  uniqueIndex("result_finalization_race_scope_revision_uidx")
    .on(table.raceId, table.scopeRevision)
    .where(sql`${table.scope} = 'RACE'`),
  uniqueIndex("result_finalization_class_scope_revision_uidx")
    .on(table.classId, table.scopeRevision)
    .where(sql`${table.scope} = 'CLASS'`),
  index("result_finalization_race_finalized_idx").on(table.raceId, table.finalizedAt, table.id),
  check("result_finalization_scope_revision_check", sql`${table.scopeRevision} > 0`),
  check("result_finalization_source_snapshot_version_check", sql`${table.sourceSnapshotVersion} > 0`),
  check("result_finalization_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
  check("result_finalization_frozen_projection_object_check", sql`jsonb_typeof(${table.frozenProjection}) = 'object'`),
  check(
    "result_finalization_scope_payload_check",
    sql`(
      ${table.scope} = 'CLASS'
      AND ${table.classId} IS NOT NULL
      AND ${table.completeXml} IS NULL
      AND ${table.completeXmlHash} IS NULL
    ) OR (
      ${table.scope} = 'RACE'
      AND ${table.classId} IS NULL
      AND ${table.completeXml} IS NOT NULL
      AND length(${table.completeXml}) > 0
      AND ${table.completeXmlHash} IS NOT NULL
      AND ${table.completeXmlHash} ~ '^[a-f0-9]{64}$'
    )`
  ),
  foreignKey({
    columns: [table.classId, table.raceId],
    foreignColumns: [classes.id, classes.raceId],
    name: "result_finalization_class_race_fk"
  })
]);

export const auditEvents = pgTable("audit_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  actorKind: auditActorKindEnum("actor_kind"),
  actorId: uuid("actor_id"),
  requestId: uuid("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

/** Immutable provenance for restoring the direct technical source of one TASK093 correction. */
export const manualFinishTimeCorrectionWithdrawals = pgTable("manual_finish_time_correction_withdrawal", {
  requestId: uuid("request_id").primaryKey(),
  id: uuid("id").notNull().unique(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  classId: uuid("class_id").notNull(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  expectedSnapshotVersion: integer("expected_snapshot_version").notNull(),
  basisHash: text("basis_hash").notNull(),
  correctionId: uuid("correction_id").notNull(),
  sourceResultRevisionId: uuid("source_result_revision_id").notNull(),
  sourceResultRevision: integer("source_result_revision").notNull(),
  correctedResultRevisionId: uuid("corrected_result_revision_id").notNull(),
  correctedResultRevision: integer("corrected_result_revision").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("manual_finish_time_correction_withdrawal_correction_uidx").on(table.correctionId),
  uniqueIndex("manual_finish_time_correction_withdrawal_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("manual_finish_time_correction_withdrawal_pair_uidx")
    .on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("manual_finish_time_correction_withdrawal_race_time_idx").on(table.raceId, table.withdrawnAt),
  check("manual_finish_time_correction_withdrawal_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("manual_finish_time_correction_withdrawal_positive_check", sql`${table.expectedEntryVersion} > 0 AND ${table.expectedSnapshotVersion} > 0 AND ${table.sourceResultRevision} > 0 AND ${table.correctedResultRevision} > 0 AND ${table.createdResultRevision} > 0`),
  check("manual_finish_time_correction_withdrawal_chain_check", sql`${table.correctedResultRevision}::bigint = ${table.sourceResultRevision}::bigint + 1 AND ${table.createdResultRevision}::bigint = ${table.correctedResultRevision}::bigint + 1`),
  check("manual_finish_time_correction_withdrawal_hash_check", sql`${table.basisHash} ~ '^[a-f0-9]{64}$'`),
  check("manual_finish_time_correction_withdrawal_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`),
  foreignKey({ name: "manual_finish_time_correction_withdrawal_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "manual_finish_time_correction_withdrawal_class_scope_fk", columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "manual_finish_time_correction_withdrawal_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  foreignKey({ name: "manual_finish_time_correction_withdrawal_source_fk", columns: [table.sourceResultRevisionId, table.raceId, table.entryId, table.sourceResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] }),
  foreignKey({ name: "manual_finish_time_correction_withdrawal_corrected_fk", columns: [table.correctedResultRevisionId, table.correctionId, table.raceId, table.entryId, table.correctedResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.manualFinishTimeCorrectionId, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] }),
  foreignKey({ name: "manual_finish_time_correction_withdrawal_created_fk", columns: [table.createdResultRevisionId, table.id, table.raceId, table.entryId, table.createdResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.manualFinishTimeCorrectionWithdrawalId, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] })
]);

export const startCheckinDevices = pgTable("start_checkin_device", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  label: text("label").notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("start_checkin_device_scope_uidx").on(table.id, table.raceId, table.actorCredentialId),
  uniqueIndex("start_checkin_device_capability_scope_uidx").on(table.id, table.raceId, table.actorCredentialId, table.capability),
  index("start_checkin_device_race_idx").on(table.raceId),
  check("start_checkin_device_capability_check", sql`${table.capability}::text IN ('START_CHECKIN', 'FINISH_FOREST_WATCH', 'MANAGE_RACE')`),
  uniqueIndex("start_checkin_device_manage_race_credential_uidx").on(table.actorCredentialId).where(sql`${table.capability} = 'MANAGE_RACE'`),
  check("start_checkin_device_label_check", sql`length(btrim(${table.label})) BETWEEN 1 AND 120`),
  foreignKey({ name: "start_checkin_device_actor_scope_fk",
    columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

export const startCheckinOperations = pgTable("start_checkin_operation", {
  requestId: uuid("request_id").primaryKey(),
  deviceId: uuid("device_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  localSequence: integer("local_sequence").notNull(),
  packageVersion: integer("package_version").notNull(),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedRevision: integer("expected_revision").notNull(),
  contentHash: text("content_hash").notNull(),
  intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  effect: text("effect").$type<"APPLIED" | "UNCHANGED" | "CONFLICT">().notNull(),
  resultingRevision: integer("resulting_revision").notNull(),
  createdRevisionId: uuid("created_revision_id"),
  conflictReason: text("conflict_reason").$type<"STALE_ENTRY" | "STALE_PACKAGE" | "STALE_REVISION" | "RETURN_ALREADY_REGISTERED" | "RESULT_CONFLICT" | "DEPENDENCY_CONFLICT">(),
  receipt: jsonb("receipt").$type<Record<string, unknown>>().notNull()
}, (table) => [
  uniqueIndex("start_checkin_operation_sequence_uidx").on(table.deviceId, table.localSequence),
  uniqueIndex("start_checkin_operation_recovery_source_uidx").on(table.requestId, table.deviceId, table.actorCredentialId, table.raceId, table.localSequence, table.contentHash),
  uniqueIndex("start_checkin_operation_conflict_review_source_uidx")
    .on(table.requestId, table.raceId, table.entryId, table.contentHash, table.effect),
  uniqueIndex("start_checkin_operation_revision_scope_uidx").on(table.requestId, table.raceId, table.entryId, table.effect, table.resultingRevision),
  uniqueIndex("start_checkin_operation_created_revision_uidx").on(table.createdRevisionId),
  index("start_checkin_operation_entry_idx").on(table.raceId, table.entryId, table.receivedAt),
  foreignKey({ name: "start_checkin_operation_device_scope_fk", columns: [table.deviceId, table.raceId, table.actorCredentialId],
    foreignColumns: [startCheckinDevices.id, startCheckinDevices.raceId, startCheckinDevices.actorCredentialId] }),
  foreignKey({ name: "start_checkin_operation_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  check("start_checkin_operation_counters_check", sql`${table.localSequence} > 0 AND ${table.packageVersion} > 0 AND ${table.expectedEntryVersion} > 0 AND ${table.expectedRevision} >= 0 AND ${table.resultingRevision} >= 0`),
  check("start_checkin_operation_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  check("start_checkin_operation_json_check", sql`jsonb_typeof(${table.intent}) = 'object' AND jsonb_typeof(${table.receipt}) = 'object'`),
  check("start_checkin_operation_effect_check", sql`
    (${table.effect} = 'APPLIED' AND ${table.createdRevisionId} IS NOT NULL AND ${table.resultingRevision}::bigint = ${table.expectedRevision}::bigint + 1 AND ${table.conflictReason} IS NULL)
    OR (${table.effect} = 'UNCHANGED' AND ${table.createdRevisionId} IS NULL AND ${table.resultingRevision} = ${table.expectedRevision} AND ${table.conflictReason} IS NULL)
    OR (${table.effect} = 'CONFLICT' AND ${table.createdRevisionId} IS NULL AND ${table.conflictReason} IS NOT NULL AND ${table.conflictReason} IN ('STALE_ENTRY', 'STALE_PACKAGE', 'STALE_REVISION', 'RETURN_ALREADY_REGISTERED', 'RESULT_CONFLICT', 'DEPENDENCY_CONFLICT'))`)
  // Reciprocal operation -> revision FK is deferred in migration 0032.
]);

export const startCheckinRevisions = pgTable("start_checkin_revision", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  revision: integer("revision").notNull(),
  operationEffect: text("operation_effect").$type<"APPLIED">().notNull().default("APPLIED"),
  startState: text("start_state").$type<"UNMARKED" | "STARTED" | "REPORTED_NOT_STARTED">().notNull(),
  manualReturnRegistered: boolean("manual_return_registered").notNull()
}, (table) => [
  uniqueIndex("start_checkin_revision_entry_uidx").on(table.raceId, table.entryId, table.revision),
  uniqueIndex("start_checkin_revision_request_uidx").on(table.requestId),
  uniqueIndex("start_checkin_revision_reciprocal_uidx").on(table.id, table.requestId, table.raceId, table.entryId, table.revision),
  check("start_checkin_revision_positive_check", sql`${table.revision} > 0`),
  check("start_checkin_revision_effect_check", sql`${table.operationEffect} = 'APPLIED'`),
  check("start_checkin_revision_state_check", sql`${table.startState} IN ('UNMARKED', 'STARTED', 'REPORTED_NOT_STARTED')`),
  foreignKey({ name: "start_checkin_revision_operation_fk",
    columns: [table.requestId, table.raceId, table.entryId, table.operationEffect, table.revision],
    foreignColumns: [startCheckinOperations.requestId, startCheckinOperations.raceId, startCheckinOperations.entryId, startCheckinOperations.effect, startCheckinOperations.resultingRevision] })
  // Migration 0032 makes the operation FK DEFERRABLE INITIALLY DEFERRED.
]);

/** Immutable provenance for the status-only DNS result caused by one explicit check-in report. */
export const startCheckinDnsDecisions = pgTable("start_checkin_dns_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  actorCredentialId: uuid("actor_credential_id").notNull().references(() => pairingAdminAccessCredentials.id),
  operationRequestId: uuid("operation_request_id").notNull(),
  startCheckinRevisionId: uuid("start_checkin_revision_id").notNull(),
  operationalRevision: integer("operational_revision").notNull(),
  classId: uuid("class_id").notNull().references(() => classes.id),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  snapshotVersion: integer("snapshot_version").notNull(),
  expectedLatestResultRevision: integer("expected_latest_result_revision").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
  policyVersion: text("policy_version").$type<"start-checkin-dns-v1">().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("start_checkin_dns_decision_operation_uidx").on(table.operationRequestId),
  uniqueIndex("start_checkin_dns_decision_created_result_uidx").on(table.createdResultRevisionId),
  uniqueIndex("start_checkin_dns_decision_result_pair_uidx").on(table.id, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  index("start_checkin_dns_decision_race_time_idx").on(table.raceId, table.decidedAt),
  check("start_checkin_dns_decision_positive_check", sql`${table.operationalRevision} > 0 AND ${table.snapshotVersion} > 0 AND ${table.expectedLatestResultRevision} >= 0 AND ${table.createdResultRevision} > 0`),
  check("start_checkin_dns_decision_created_revision_check", sql`${table.createdResultRevision}::bigint = ${table.expectedLatestResultRevision}::bigint + 1`),
  check("start_checkin_dns_decision_policy_version_check", sql`${table.policyVersion} = 'start-checkin-dns-v1'`),
  foreignKey({ name: "start_checkin_dns_decision_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "start_checkin_dns_decision_class_scope_fk", columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "start_checkin_dns_decision_operation_revision_fk", columns: [table.startCheckinRevisionId, table.operationRequestId, table.raceId, table.entryId, table.operationalRevision], foreignColumns: [startCheckinRevisions.id, startCheckinRevisions.requestId, startCheckinRevisions.raceId, startCheckinRevisions.entryId, startCheckinRevisions.revision] }),
  foreignKey({ name: "start_checkin_dns_decision_result_pair_fk", columns: [table.createdResultRevisionId, table.id, table.raceId, table.entryId, table.createdResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.startCheckinDnsDecisionId, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] })
  // Migration 0033 makes the reciprocal result foreign key DEFERRABLE INITIALLY DEFERRED.
]);

/** Immutable closure of one start-checkin DNS decision. */
export const startCheckinDnsWithdrawals = pgTable("start_checkin_dns_withdrawal", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  actorCredentialId: uuid("actor_credential_id").notNull().references(() => pairingAdminAccessCredentials.id),
  operationRequestId: uuid("operation_request_id").notNull(),
  startCheckinRevisionId: uuid("start_checkin_revision_id").notNull(),
  operationalRevision: integer("operational_revision").notNull(),
  startCheckinDnsDecisionId: uuid("start_checkin_dns_decision_id").notNull(),
  withdrawnResultRevisionId: uuid("withdrawn_result_revision_id").notNull(),
  withdrawnResultRevision: integer("withdrawn_result_revision").notNull(),
  policyVersion: text("policy_version").$type<"start-checkin-dns-withdrawal-v1">().notNull(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("start_checkin_dns_withdrawal_operation_uidx").on(table.operationRequestId),
  uniqueIndex("start_checkin_dns_withdrawal_decision_uidx").on(table.startCheckinDnsDecisionId),
  uniqueIndex("start_checkin_dns_withdrawal_result_uidx").on(table.withdrawnResultRevisionId),
  index("start_checkin_dns_withdrawal_race_time_idx").on(table.raceId, table.withdrawnAt),
  check("start_checkin_dns_withdrawal_positive_check", sql`${table.operationalRevision} > 0 AND ${table.withdrawnResultRevision} > 0`),
  check("start_checkin_dns_withdrawal_policy_version_check", sql`${table.policyVersion} = 'start-checkin-dns-withdrawal-v1'`),
  foreignKey({ name: "start_checkin_dns_withdrawal_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "start_checkin_dns_withdrawal_operation_revision_fk", columns: [table.startCheckinRevisionId, table.operationRequestId, table.raceId, table.entryId, table.operationalRevision], foreignColumns: [startCheckinRevisions.id, startCheckinRevisions.requestId, startCheckinRevisions.raceId, startCheckinRevisions.entryId, startCheckinRevisions.revision] }),
  foreignKey({ name: "start_checkin_dns_withdrawal_target_fk", columns: [table.startCheckinDnsDecisionId, table.withdrawnResultRevisionId, table.raceId, table.entryId, table.withdrawnResultRevision], foreignColumns: [startCheckinDnsDecisions.id, startCheckinDnsDecisions.createdResultRevisionId, startCheckinDnsDecisions.raceId, startCheckinDnsDecisions.entryId, startCheckinDnsDecisions.createdResultRevision] })
]);

/** Immutable, explicit review of one or more received conflict reports. */
export const startCheckinConflictReviews = pgTable("start_checkin_conflict_review", {
  id: uuid("id").primaryKey(), requestId: uuid("request_id").notNull(), raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(), actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(), decision: text("decision").$type<"KEEP_CURRENT_STATE">().notNull(),
  reason: text("reason").notNull(), sourceHash: text("source_hash").notNull(),
  intentCanonicalJson: text("intent_canonical_json").notNull(), intentHash: text("intent_hash").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("start_checkin_conflict_review_request_uidx").on(table.requestId),
  uniqueIndex("start_checkin_conflict_review_scope_uidx").on(table.id, table.raceId, table.entryId),
  index("start_checkin_conflict_review_race_time_idx").on(table.raceId, table.reviewedAt),
  check("start_checkin_conflict_review_capability_check", sql`${table.capability} IN ('FINISH_FOREST_WATCH', 'MANAGE_RACE')`),
  check("start_checkin_conflict_review_decision_check", sql`${table.decision} = 'KEEP_CURRENT_STATE'`),
  check("start_checkin_conflict_review_reason_check", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
  check("start_checkin_conflict_review_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$' AND ${table.intentHash} ~ '^[a-f0-9]{64}$'`),
  check("start_checkin_conflict_review_intent_check", sql`jsonb_typeof(${table.intentCanonicalJson}::jsonb) = 'object'`),
  foreignKey({ name: "start_checkin_conflict_review_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "start_checkin_conflict_review_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

/** One immutable conflict-operation membership record per original request. */
export const startCheckinConflictReviewItems = pgTable("start_checkin_conflict_review_item", {
  reviewId: uuid("review_id").notNull(), conflictRequestId: uuid("conflict_request_id").primaryKey(),
  raceId: uuid("race_id").notNull(), entryId: uuid("entry_id").notNull(), contentHash: text("content_hash").notNull(),
  operationEffect: text("operation_effect").$type<"CONFLICT">().notNull().default("CONFLICT")
}, (table) => [
  index("start_checkin_conflict_review_item_review_idx").on(table.reviewId),
  check("start_checkin_conflict_review_item_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  check("start_checkin_conflict_review_item_effect_check", sql`${table.operationEffect} = 'CONFLICT'`),
  foreignKey({ name: "start_checkin_conflict_review_item_review_scope_fk", columns: [table.reviewId, table.raceId, table.entryId], foreignColumns: [startCheckinConflictReviews.id, startCheckinConflictReviews.raceId, startCheckinConflictReviews.entryId] }),
  foreignKey({ name: "start_checkin_conflict_review_item_operation_source_fk", columns: [table.conflictRequestId, table.raceId, table.entryId, table.contentHash, table.operationEffect], foreignColumns: [startCheckinOperations.requestId, startCheckinOperations.raceId, startCheckinOperations.entryId, startCheckinOperations.contentHash, startCheckinOperations.effect] })
]);

export const startListPublications = pgTable("start_list_publication", {
  iofStartListXml: text("iof_start_list_xml"),
  id: uuid("id").primaryKey().defaultRandom(), requestId: uuid("request_id").notNull(), raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull().references(() => pairingAdminAccessCredentials.id), revision: integer("revision").notNull(), action: text("action").$type<"PUBLISH" | "WITHDRAW">().notNull(),
  intent: jsonb("intent").$type<Record<string, unknown>>().notNull(), sourceSnapshotVersion: integer("source_snapshot_version").notNull(), sourceHash: text("source_hash"), content: jsonb("content").$type<Record<string, unknown>>(), decidedAt: timestamp("decided_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("start_list_publication_request_uidx").on(table.requestId),
  uniqueIndex("start_list_publication_race_revision_uidx").on(table.raceId, table.revision),
  index("start_list_publication_race_revision_idx").on(table.raceId, table.revision.desc()),
  check("start_list_publication_revision_check", sql`${table.revision} > 0 AND ${table.sourceSnapshotVersion} > 0`),
  check("start_list_publication_action_check", sql`${table.action} IN ('PUBLISH', 'WITHDRAW')`),
  check("start_list_publication_xml_check", sql`${table.iofStartListXml} IS NULL OR (${table.action} = 'PUBLISH' AND octet_length(${table.iofStartListXml}) BETWEEN 1 AND 67108864)`),
  check("start_list_publication_intent_check", sql`jsonb_typeof(${table.intent}) = 'object'`),
  check("start_list_publication_payload_check", sql`(${table.action} = 'PUBLISH' AND ${table.sourceHash} IS NOT NULL AND ${table.sourceHash} ~ '^[a-f0-9]{64}$' AND ${table.content} IS NOT NULL AND jsonb_typeof(${table.content}) = 'object') OR (${table.action} = 'WITHDRAW' AND ${table.sourceHash} IS NULL AND ${table.content} IS NULL)`)
]);

/**
 * Immutable, one-hour authority to replay only an exact exported check-in
 * manifest. Manifest semantics (count and contiguous sequence) remain at the
 * application boundary; this table only freezes the reviewed evidence.
 */
export const checkinRecoveryGrants = pgTable("checkin_recovery_grant", {
  id: uuid("id").primaryKey(),
  deviceId: uuid("device_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  raceId: uuid("race_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  manifestCanonicalJson: text("manifest_canonical_json").notNull(),
  manifestHash: text("manifest_hash").notNull(),
  secretHash: text("secret_hash").notNull(),
  firstSequence: integer("first_sequence").notNull(),
  lastSequence: integer("last_sequence").notNull(),
  operatorLabel: text("operator_label").notNull(),
  reason: text("reason").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("checkin_recovery_grant_scope_uidx").on(table.id, table.deviceId, table.actorCredentialId, table.raceId),
  index("checkin_recovery_grant_race_expiry_idx").on(table.raceId, table.expiresAt),
  check("checkin_recovery_grant_capability_check", sql`${table.capability}::text IN ('START_CHECKIN', 'FINISH_FOREST_WATCH')`),
  check("checkin_recovery_grant_manifest_check", sql`jsonb_typeof(${table.manifestCanonicalJson}::jsonb) = 'object'`),
  check("checkin_recovery_grant_hash_check", sql`${table.manifestHash} ~ '^[a-f0-9]{64}$' AND ${table.secretHash} ~ '^[a-f0-9]{64}$'`),
  check("checkin_recovery_grant_sequence_check", sql`${table.firstSequence} > 0 AND ${table.lastSequence} >= ${table.firstSequence}`),
  check("checkin_recovery_grant_operator_label_check", sql`length(btrim(${table.operatorLabel})) BETWEEN 1 AND 120`),
  check("checkin_recovery_grant_reason_check", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
  check("checkin_recovery_grant_lifetime_check", sql`${table.expiresAt} > ${table.issuedAt} AND ${table.expiresAt} <= ${table.issuedAt} + interval '1 hour'`),
  foreignKey({ name: "checkin_recovery_grant_device_scope_fk", columns: [table.deviceId, table.raceId, table.actorCredentialId, table.capability], foreignColumns: [startCheckinDevices.id, startCheckinDevices.raceId, startCheckinDevices.actorCredentialId, startCheckinDevices.capability] }),
  foreignKey({ name: "checkin_recovery_grant_credential_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

/** Exact, immutable operation membership in a recovery grant. */
export const checkinRecoveryGrantItems = pgTable("checkin_recovery_grant_item", {
  grantId: uuid("grant_id").notNull(),
  requestId: uuid("request_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  raceId: uuid("race_id").notNull(),
  localSequence: integer("local_sequence").notNull(),
  contentHash: text("content_hash").notNull()
}, (table) => [
  uniqueIndex("checkin_recovery_grant_item_pk").on(table.grantId, table.requestId),
  uniqueIndex("checkin_recovery_grant_item_sequence_uidx").on(table.grantId, table.localSequence),
  uniqueIndex("checkin_recovery_grant_item_delivery_scope_uidx").on(table.grantId, table.requestId, table.deviceId, table.actorCredentialId, table.raceId, table.localSequence, table.contentHash),
  check("checkin_recovery_grant_item_sequence_check", sql`${table.localSequence} > 0`),
  check("checkin_recovery_grant_item_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ name: "checkin_recovery_grant_item_grant_scope_fk", columns: [table.grantId, table.deviceId, table.actorCredentialId, table.raceId], foreignColumns: [checkinRecoveryGrants.id, checkinRecoveryGrants.deviceId, checkinRecoveryGrants.actorCredentialId, checkinRecoveryGrants.raceId] })
]);

/** Immutable, separate revocation record for one recovery grant. */
export const checkinRecoveryGrantRevocations = pgTable("checkin_recovery_grant_revocation", {
  grantId: uuid("grant_id").primaryKey(),
  operatorLabel: text("operator_label").notNull(),
  reason: text("reason").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull()
}, (table) => [
  check("checkin_recovery_grant_revocation_operator_label_check", sql`length(btrim(${table.operatorLabel})) BETWEEN 1 AND 120`),
  check("checkin_recovery_grant_revocation_reason_check", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
  foreignKey({ name: "checkin_recovery_grant_revocation_grant_fk", columns: [table.grantId], foreignColumns: [checkinRecoveryGrants.id] })
]);

/** Immutable proof that recovery returned the exact original operation. */
export const checkinRecoveryDeliveries = pgTable("checkin_recovery_delivery", {
  grantId: uuid("grant_id").notNull(),
  requestId: uuid("request_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  raceId: uuid("race_id").notNull(),
  localSequence: integer("local_sequence").notNull(),
  contentHash: text("content_hash").notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("checkin_recovery_delivery_pk").on(table.grantId, table.requestId),
  check("checkin_recovery_delivery_sequence_check", sql`${table.localSequence} > 0`),
  check("checkin_recovery_delivery_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ name: "checkin_recovery_delivery_item_scope_hash_fk", columns: [table.grantId, table.requestId, table.deviceId, table.actorCredentialId, table.raceId, table.localSequence, table.contentHash], foreignColumns: [checkinRecoveryGrantItems.grantId, checkinRecoveryGrantItems.requestId, checkinRecoveryGrantItems.deviceId, checkinRecoveryGrantItems.actorCredentialId, checkinRecoveryGrantItems.raceId, checkinRecoveryGrantItems.localSequence, checkinRecoveryGrantItems.contentHash] }),
  foreignKey({ name: "checkin_recovery_delivery_operation_scope_hash_fk", columns: [table.requestId, table.deviceId, table.actorCredentialId, table.raceId, table.localSequence, table.contentHash], foreignColumns: [startCheckinOperations.requestId, startCheckinOperations.deviceId, startCheckinOperations.actorCredentialId, startCheckinOperations.raceId, startCheckinOperations.localSequence, startCheckinOperations.contentHash] })
]);

export const classStartRuleChanges = pgTable("class_start_rule_change", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull(), classId: uuid("class_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").notNull(), response: jsonb("response").notNull()
}, table => [
  uniqueIndex("class_start_rule_change_scope_uidx").on(table.requestId, table.raceId, table.classId),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("class_start_rule_change_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("class_start_rule_change_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);
export const classStartRuleChangeItems = pgTable("class_start_rule_change_item", {
  requestId: uuid("request_id").notNull(), raceId: uuid("race_id").notNull(), classId: uuid("class_id").notNull(), entryId: uuid("entry_id").notNull(),
  versionBefore: integer("version_before").notNull(), versionAfter: integer("version_after").notNull(),
  previousFixedStartTime: timestamp("previous_fixed_start_time", { withTimezone: true }),
  fixedStartTime: timestamp("fixed_start_time", { withTimezone: true })
}, table => [
  primaryKey({ columns: [table.requestId, table.entryId] }),
  foreignKey({ columns: [table.requestId, table.raceId, table.classId], foreignColumns: [classStartRuleChanges.requestId, classStartRuleChanges.raceId, classStartRuleChanges.classId] }),
  foreignKey({ columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  check("class_start_rule_change_item_versions_check", sql`${table.versionBefore} > 0 AND ${table.versionAfter}::bigint IN (${table.versionBefore}::bigint,${table.versionBefore}::bigint+1)`)
]);

export const manualCourseClassCreateRequests = pgTable("manual_course_class_create_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  courseId: uuid("course_id").notNull(), courseVersionId: uuid("course_version_id").notNull(), classId: uuid("class_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull()
}, table => [
  uniqueIndex("manual_course_class_create_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.courseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.courseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("manual_course_class_create_request_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("manual_course_class_create_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

export const manualClassCreateRequests = pgTable("manual_class_create_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  courseId: uuid("course_id").notNull(), courseVersionId: uuid("course_version_id").notNull(), classId: uuid("class_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull()
}, table => [
  uniqueIndex("manual_class_create_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.courseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.courseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("manual_class_create_request_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("manual_class_create_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

export const manualClassNameChangeRequests = pgTable("manual_class_name_change_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  classId: uuid("class_id").notNull(), courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull()
}, table => [
  uniqueIndex("manual_class_name_change_request_scope_uidx").on(table.requestId, table.raceId, table.classId),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("manual_class_name_change_request_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("manual_class_name_change_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

export const manualCourseVersionClassRelinkRequests = pgTable("manual_course_version_class_relink_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  courseId: uuid("course_id").notNull(), classId: uuid("class_id").notNull(),
  previousCourseVersionId: uuid("previous_course_version_id").notNull(), courseVersionId: uuid("course_version_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull()
}, table => [
  uniqueIndex("manual_course_version_class_relink_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.courseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.previousCourseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.courseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("manual_course_version_class_relink_request_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("manual_course_version_class_relink_request_versions_check", sql`${table.previousCourseVersionId} <> ${table.courseVersionId}`),
  check("manual_course_version_class_relink_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

export const manualCourseResultBearingRelinkRequests = pgTable("manual_course_result_bearing_relink_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  courseId: uuid("course_id").notNull(), classId: uuid("class_id").notNull(),
  previousCourseVersionId: uuid("previous_course_version_id").notNull(), courseVersionId: uuid("course_version_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  sourceSnapshotVersion: integer("source_snapshot_version").notNull(), sourceHash: text("source_hash").notNull(),
  frozenBasis: jsonb("frozen_basis").$type<Record<string, unknown>>().notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("manual_course_result_bearing_relink_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.courseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.previousCourseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.courseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("manual_course_result_bearing_relink_request_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("manual_course_result_bearing_relink_request_versions_check", sql`${table.previousCourseVersionId} <> ${table.courseVersionId}`),
  check("manual_course_result_bearing_relink_request_source_snapshot_check", sql`${table.sourceSnapshotVersion} > 0`),
  check("manual_course_result_bearing_relink_request_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
  check("manual_course_result_bearing_relink_request_json_check", sql`jsonb_typeof(${table.frozenBasis}) = 'object' AND jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

/**
 * Immutable TASK135 decision header. The source basis binds a selected set of
 * entries to a strictly shorter, separately ranked local class; it never
 * rewrites the original class, course version, or result history.
 */
export const shortenedCourseClassTransfers = pgTable("shortened_course_class_transfer", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  sourceClassId: uuid("source_class_id").notNull(), sourceCourseId: uuid("source_course_id").notNull(),
  sourceCourseVersionId: uuid("source_course_version_id").notNull(), shortCourseId: uuid("short_course_id").notNull(),
  shortCourseVersionId: uuid("short_course_version_id").notNull(), shortClassId: uuid("short_class_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  sourceSnapshotVersion: integer("source_snapshot_version").notNull(), sourceHash: text("source_hash").notNull(),
  frozenBasis: jsonb("frozen_basis").$type<Record<string, unknown>>().notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(), transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("shortened_course_class_transfer_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.sourceClassId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.sourceCourseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.sourceCourseVersionId, table.sourceCourseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.shortCourseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.shortCourseVersionId, table.shortCourseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.shortClassId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("shortened_course_class_transfer_capability_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("shortened_course_class_transfer_snapshot_check", sql`${table.sourceSnapshotVersion} > 0`),
  check("shortened_course_class_transfer_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
  check("shortened_course_class_transfer_json_check", sql`jsonb_typeof(${table.frozenBasis}) = 'object' AND jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

/** Exact moved-entry manifest. A row has either no source result or one MP readout source and one appended technical revision. */
export const shortenedCourseClassTransferItems = pgTable("shortened_course_class_transfer_item", {
  requestId: uuid("request_id").notNull(), raceId: uuid("race_id").notNull(), entryId: uuid("entry_id").notNull(),
  entryVersionBefore: integer("entry_version_before").notNull(), entryVersionAfter: integer("entry_version_after").notNull(),
  sourceResultRevisionId: uuid("source_result_revision_id"), sourceResultRevision: integer("source_result_revision"),
  sourceReadoutId: uuid("source_readout_id"), createdResultRevisionId: uuid("created_result_revision_id"),
  createdResultRevision: integer("created_result_revision")
}, table => [
  primaryKey({ columns: [table.requestId, table.entryId] }),
  uniqueIndex("shortened_course_class_transfer_item_created_result_uidx")
    .on(table.requestId, table.createdResultRevisionId, table.raceId, table.entryId, table.createdResultRevision),
  foreignKey({ columns: [table.requestId, table.raceId], foreignColumns: [shortenedCourseClassTransfers.requestId, shortenedCourseClassTransfers.raceId] }),
  foreignKey({ columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ columns: [table.sourceResultRevisionId, table.raceId, table.entryId, table.sourceResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] }),
  foreignKey({ columns: [table.sourceReadoutId], foreignColumns: [cardReadouts.id] }),
  foreignKey({ columns: [table.createdResultRevisionId, table.requestId, table.raceId, table.entryId, table.createdResultRevision], foreignColumns: [resultRevisions.id, resultRevisions.shortenedCourseClassTransferId, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision] }),
  check("shortened_course_class_transfer_item_version_check", sql`${table.entryVersionBefore} > 0 AND ${table.entryVersionAfter}::bigint = ${table.entryVersionBefore}::bigint + 1`),
  check("shortened_course_class_transfer_item_result_chain_check", sql`(
    ${table.sourceResultRevisionId} IS NULL AND ${table.sourceResultRevision} IS NULL AND ${table.sourceReadoutId} IS NULL AND
    ${table.createdResultRevisionId} IS NULL AND ${table.createdResultRevision} IS NULL
  ) OR (
    ${table.sourceResultRevisionId} IS NOT NULL AND ${table.sourceResultRevision} IS NOT NULL AND ${table.sourceReadoutId} IS NOT NULL AND
    ${table.createdResultRevisionId} IS NOT NULL AND ${table.createdResultRevision} IS NOT NULL AND
    ${table.createdResultRevision}::bigint = ${table.sourceResultRevision}::bigint + 1
  )`)
]);

/** Immutable TASK152 one-time participant claim and its terminal journals. */
export const participantEntryClaimIssues = pgTable("participant_entry_claim_issue", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  issuerCredentialId: uuid("issuer_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  secretHash: text("secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attestation: text("attestation").$type<"IDENTITY_CHECKED">().notNull()
}, table => [
  uniqueIndex("participant_entry_claim_issue_request_uidx").on(table.requestId),
  uniqueIndex("participant_entry_claim_issue_secret_hash_uidx").on(table.secretHash),
  uniqueIndex("participant_entry_claim_issue_scope_uidx").on(table.id, table.raceId, table.entryId),
  uniqueIndex("participant_entry_claim_issue_race_scope_uidx").on(table.id, table.raceId),
  foreignKey({ name: "participant_entry_claim_issue_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "participant_entry_claim_issue_issuer_scope_fk", columns: [table.issuerCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("participant_entry_claim_issue_capability_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("participant_entry_claim_issue_secret_hash_check", sql`${table.secretHash} ~ '^[a-f0-9]{64}$'`),
  check("participant_entry_claim_issue_expiry_check", sql`${table.expiresAt} > ${table.issuedAt} AND ${table.expiresAt} <= ${table.issuedAt} + interval '7 days'`),
  check("participant_entry_claim_issue_attestation_check", sql`${table.attestation} = 'IDENTITY_CHECKED'`)
]);

export const participantEntryClaimRedemptions = pgTable("participant_entry_claim_redemption", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  claimId: uuid("claim_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("participant_entry_claim_redemption_request_uidx").on(table.requestId),
  uniqueIndex("participant_entry_claim_redemption_claim_uidx").on(table.claimId),
  foreignKey({ name: "participant_entry_claim_redemption_claim_fk", columns: [table.claimId], foreignColumns: [participantEntryClaimIssues.id] })
]);

export const participantEntryClaimRevocations = pgTable("participant_entry_claim_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  claimId: uuid("claim_id").notNull(),
  raceId: uuid("race_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, table => [
  uniqueIndex("participant_entry_claim_revocation_request_uidx").on(table.requestId),
  uniqueIndex("participant_entry_claim_revocation_claim_uidx").on(table.claimId),
  foreignKey({ name: "participant_entry_claim_revocation_claim_scope_fk", columns: [table.claimId, table.raceId], foreignColumns: [participantEntryClaimIssues.id, participantEntryClaimIssues.raceId] }),
  foreignKey({ name: "participant_entry_claim_revocation_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("participant_entry_claim_revocation_capability_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("participant_entry_claim_revocation_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`)
]);

/** ADR-0169: Redigera bana. Oföränderlig journal för en ändrad kontrollföljd och dess omräkning. */
export const courseEditRequests = pgTable("course_edit_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  courseId: uuid("course_id").notNull(),
  previousCourseVersionId: uuid("previous_course_version_id").notNull(), courseVersionId: uuid("course_version_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("course_edit_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.courseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.previousCourseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.courseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("course_edit_request_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("course_edit_request_versions_check", sql`${table.previousCourseVersionId} <> ${table.courseVersionId}`),
  check("course_edit_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

/** ADR-0169 beslut 4: idempotent journal för "Redigera klass" (namn, bana, startsätt). */
export const classEditRequests = pgTable("class_edit_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  classId: uuid("class_id").notNull(),
  previousCourseVersionId: uuid("previous_course_version_id").notNull().references(() => courseVersions.id),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("class_edit_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("class_edit_request_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("class_edit_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

/** ADR-0170 beslut 5: idempotent journal för rogaining (kontrollernas poäng, klassernas tidsgräns och straff). */
export const rogainingChangeRequests = pgTable("rogaining_change_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("rogaining_change_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("rogaining_change_request_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
  check("rogaining_change_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

/** PLAN.md steg 9: en sparad lottning av en eller flera klasser. Slumpfröet sparas för revision. */
export const startDrawRequests = pgTable("start_draw_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().unique(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  seed: bigint("seed", { mode: "number" }).notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(), snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  drawnAt: timestamp("drawn_at", { withTimezone: true }).notNull()
}, table => [
  uniqueIndex("start_draw_request_scope_uidx").on(table.id, table.raceId),
  index("start_draw_request_race_time_idx").on(table.raceId, table.drawnAt),
  foreignKey({ name: "start_draw_request_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  check("start_draw_request_role_check", sql`${table.capability} = 'MANAGE_RACE'`),
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
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull()
});

/** ADR-0169 beslut 3 (migration 0094): sträckorna i en stafettklass med startsätt per sträcka. */
export const relayLegs = pgTable("relay_leg", {
  classId: uuid("class_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  leg: integer("leg").notNull(),
  startMethod: text("start_method").$type<"MASS_START" | "CHANGEOVER" | "RESTART">().notNull(),
  /** Masstart: starttiden. Omstart: tiden då lag som inte växlat startar. NULL för växling. */
  startTime: timestamp("start_time", { withTimezone: true }),
  /** Variant för sträckan (gafflad bana); NULL = lagen fördelas över banans varianter. */
  courseVariantCode: text("course_variant_code")
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
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
  kind: text("kind").$type<"CLASS" | "TEAM" | "LEG_RUNNER" | "START_TIMES">().notNull(),
  classId: uuid("class_id").notNull(),
  teamId: uuid("team_id"),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

/** ADR-0170: Inställningar (namn, datum, tävlingstyp) med idempotent request-id. */
export const raceSettingsRequests = pgTable("race_settings_request", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
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
