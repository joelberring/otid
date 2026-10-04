import {
  boolean,
  bigint,
  check,
  date,
  doublePrecision,
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("control_race_code_uidx").on(table.raceId, table.code)]);

export const courseControls = pgTable("course_control", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  controlId: uuid("control_id").notNull().references(() => controls.id),
  sequence: integer("sequence").notNull()
}, (table) => [uniqueIndex("course_control_sequence_uidx").on(table.courseVersionId, table.sequence), uniqueIndex("course_control_id_version_uidx").on(table.id, table.courseVersionId)]);

export const classes = pgTable("class", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  name: text("name").notNull(),
  courseVersionId: uuid("course_version_id").notNull().references(() => courseVersions.id),
  startRule: startRuleEnum("start_rule").notNull().default("FIXED"),
  maxEntries: integer("max_entries"),
  capacityVersion: integer("capacity_version").notNull().default(1),
  externalSource: text("external_source"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("class_external_uidx").on(table.raceId, table.externalSource, table.externalId),
  uniqueIndex("class_id_race_uidx").on(table.id, table.raceId),
  uniqueIndex("class_id_course_version_uidx").on(table.id, table.courseVersionId)
  ,check("class_max_entries_check", sql`${table.maxEntries} IS NULL OR ${table.maxEntries} BETWEEN 0 AND 10000`)
  ,check("class_capacity_version_check", sql`${table.capacityVersion} > 0`)
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

/** Immutable race-scoped reservation for one renderable private map asset. */
export const mapUploadReservations = pgTable("map_upload_reservation", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  slot: integer("slot").notNull(),
  title: text("title").notNull(),
  mediaType: text("media_type").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("map_upload_reservation_request_uidx").on(table.requestId),
  uniqueIndex("map_upload_reservation_race_slot_uidx").on(table.raceId, table.slot),
  uniqueIndex("map_upload_reservation_scope_content_uidx").on(table.id, table.raceId, table.mediaType, table.sha256, table.byteLength),
  check("map_upload_reservation_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("map_upload_reservation_slot_check", sql`${table.slot} BETWEEN 1 AND 100`),
  check("map_upload_reservation_title_check", sql`char_length(${table.title}) BETWEEN 1 AND 120 AND ${table.title} = btrim(${table.title})`),
  check("map_upload_reservation_media_type_check", sql`${table.mediaType} IN ('image/png', 'image/jpeg')`),
  check("map_upload_reservation_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("map_upload_reservation_byte_length_check", sql`${table.byteLength} BETWEEN 1 AND 52428800`),
  foreignKey({ name: "map_upload_reservation_race_fk", columns: [table.raceId], foreignColumns: [races.id] }),
  foreignKey({
    name: "map_upload_reservation_actor_scope_fk",
    columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability]
  })
]);

/** Every charged object-store PUT attempt; failed attempts remain evidence. */
export const mapUploadAttempts = pgTable("map_upload_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id").notNull(),
  raceId: uuid("race_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  mediaType: text("media_type").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  chargedAt: timestamp("charged_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("map_upload_attempt_upload_number_uidx").on(table.uploadId, table.attemptNumber),
  uniqueIndex("map_upload_attempt_manifest_scope_uidx").on(table.id, table.uploadId, table.raceId, table.mediaType, table.sha256, table.byteLength),
  check("map_upload_attempt_number_check", sql`${table.attemptNumber} BETWEEN 1 AND 8`),
  check("map_upload_attempt_media_type_check", sql`${table.mediaType} IN ('image/png', 'image/jpeg')`),
  check("map_upload_attempt_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("map_upload_attempt_byte_length_check", sql`${table.byteLength} BETWEEN 1 AND 52428800`),
  foreignKey({
    name: "map_upload_attempt_reservation_content_fk",
    columns: [table.uploadId, table.raceId, table.mediaType, table.sha256, table.byteLength],
    foreignColumns: [mapUploadReservations.id, mapUploadReservations.raceId, mapUploadReservations.mediaType, mapUploadReservations.sha256, mapUploadReservations.byteLength]
  })
]);

/** One verified exact private object version per reservation. */
export const mapObjectManifests = pgTable("map_object_manifest", {
  uploadId: uuid("upload_id").primaryKey(),
  attemptId: uuid("attempt_id").notNull(),
  raceId: uuid("race_id").notNull(),
  storeId: uuid("store_id").notNull(),
  objectKey: text("object_key").notNull(),
  versionId: text("version_id").notNull(),
  mediaType: text("media_type").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  storedAt: timestamp("stored_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("map_object_manifest_store_key_version_uidx").on(table.storeId, table.objectKey, table.versionId),
  uniqueIndex("map_object_manifest_attempt_uidx").on(table.attemptId),
  uniqueIndex("map_object_manifest_upload_race_uidx").on(table.uploadId, table.raceId),
  uniqueIndex("map_object_manifest_context_scope_uidx").on(table.uploadId, table.raceId, table.sha256),
  check("map_object_manifest_media_type_check", sql`${table.mediaType} IN ('image/png', 'image/jpeg')`),
  check("map_object_manifest_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("map_object_manifest_byte_length_check", sql`${table.byteLength} BETWEEN 1 AND 52428800`),
  check("map_object_manifest_object_key_check", sql`${table.objectKey} = 'map/' || ${table.raceId}::text || '/' || ${table.attemptId}::text`),
  check("map_object_manifest_version_id_check", sql`char_length(${table.versionId}) BETWEEN 1 AND 1024 AND ${table.versionId} ~ '^[A-Za-z0-9._~+/-]+$' AND ${table.versionId} <> 'null'`),
  foreignKey({
    name: "map_object_manifest_attempt_scope_fk",
    columns: [table.attemptId, table.uploadId, table.raceId, table.mediaType, table.sha256, table.byteLength],
    foreignColumns: [mapUploadAttempts.id, mapUploadAttempts.uploadId, mapUploadAttempts.raceId, mapUploadAttempts.mediaType, mapUploadAttempts.sha256, mapUploadAttempts.byteLength]
  })
]);

/** Immutable publish/withdraw journal; the latest race revision is current. */
export const mapPublications = pgTable("map_publication", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  revision: integer("revision").notNull(),
  action: text("action").$type<"PUBLISH" | "WITHDRAW">().notNull(),
  manifestId: uuid("manifest_id"),
  sourceHash: text("source_hash"),
  intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("map_publication_request_uidx").on(table.requestId),
  uniqueIndex("map_publication_race_revision_uidx").on(table.raceId, table.revision),
  index("map_publication_race_revision_idx").on(table.raceId, table.revision.desc()),
  uniqueIndex("map_publication_id_scope_uidx").on(table.id, table.raceId, table.revision),
  check("map_publication_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("map_publication_revision_check", sql`${table.revision} > 0`),
  check("map_publication_action_check", sql`${table.action} IN ('PUBLISH', 'WITHDRAW')`),
  check("map_publication_intent_check", sql`jsonb_typeof(${table.intent}) = 'object'`),
  check("map_publication_payload_check", sql`(${table.action} = 'PUBLISH' AND ${table.manifestId} IS NOT NULL AND ${table.sourceHash} IS NOT NULL AND ${table.sourceHash} ~ '^[a-f0-9]{64}$') OR (${table.action} = 'WITHDRAW' AND ${table.manifestId} IS NULL AND ${table.sourceHash} IS NULL)`),
  foreignKey({ name: "map_publication_race_fk", columns: [table.raceId], foreignColumns: [races.id] }),
  foreignKey({
    name: "map_publication_actor_scope_fk",
    columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability]
  }),
  foreignKey({
    name: "map_publication_manifest_scope_fk",
    columns: [table.manifestId, table.raceId],
    foreignColumns: [mapObjectManifests.uploadId, mapObjectManifests.raceId]
  })
]);

/** Immutable private calibration of one exact raster manifest; never a public release. */
export const mapGeoreferences = pgTable("map_georeference", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  manifestId: uuid("manifest_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  revision: integer("revision").notNull(),
  sourceHash: text("source_hash").notNull(),
  intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
  imageWidth: integer("image_width").notNull(),
  imageHeight: integer("image_height").notNull(),
  crs: text("crs").notNull(),
  tiePoints: jsonb("tie_points").$type<unknown>().notNull(),
  transform: jsonb("transform").$type<Record<string, number>>().notNull(),
  maxResidualMeters: doublePrecision("max_residual_meters").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("map_georeference_request_uidx").on(table.requestId),
  uniqueIndex("map_georeference_id_race_uidx").on(table.id, table.raceId),
  uniqueIndex("map_georeference_context_scope_uidx").on(table.id, table.raceId, table.manifestId),
  uniqueIndex("map_georeference_race_revision_uidx").on(table.raceId, table.revision),
  index("map_georeference_race_revision_idx").on(table.raceId, table.revision.desc()),
  check("map_georeference_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("map_georeference_revision_check", sql`${table.revision} > 0`),
  check("map_georeference_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
  check("map_georeference_intent_check", sql`jsonb_typeof(${table.intent}) = 'object'`),
  check("map_georeference_dimensions_check", sql`${table.imageWidth} BETWEEN 1 AND 200000 AND ${table.imageHeight} BETWEEN 1 AND 200000`),
  check("map_georeference_crs_check", sql`${table.crs} = 'EPSG:4326'`),
  check("map_georeference_tie_points_check", sql`jsonb_typeof(${table.tiePoints}) = 'array' AND jsonb_array_length(${table.tiePoints}) = 3`),
  check("map_georeference_transform_check", sql`jsonb_typeof(${table.transform}) = 'object'`),
  check("map_georeference_residual_check", sql`${table.maxResidualMeters} >= 0 AND ${table.maxResidualMeters} <= 0.01`),
  foreignKey({ name: "map_georeference_race_fk", columns: [table.raceId], foreignColumns: [races.id] }),
  foreignKey({
    name: "map_georeference_actor_scope_fk",
    columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability]
  }),
  foreignKey({
    name: "map_georeference_manifest_scope_fk",
    columns: [table.manifestId, table.raceId],
    foreignColumns: [mapObjectManifests.uploadId, mapObjectManifests.raceId]
  })
]);

/** Immutable private geometry for every control occurrence of one exact course/map calibration. */
export const courseControlGeometryRevisions = pgTable("course_control_geometry_revision", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  courseVersionId: uuid("course_version_id").notNull(),
  mapManifestId: uuid("map_manifest_id").notNull(),
  georeferenceId: uuid("georeference_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  revision: integer("revision").notNull(),
  sourceHash: text("source_hash").notNull(),
  intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("course_control_geometry_request_uidx").on(table.requestId),
  uniqueIndex("course_control_geometry_id_race_uidx").on(table.id, table.raceId),
  uniqueIndex("course_control_geometry_context_scope_uidx").on(table.id, table.raceId, table.courseVersionId, table.mapManifestId, table.georeferenceId),
  uniqueIndex("course_control_geometry_revision_uidx").on(table.courseVersionId, table.mapManifestId, table.revision),
  index("course_control_geometry_latest_idx").on(table.courseVersionId, table.mapManifestId, table.revision.desc()),
  check("course_control_geometry_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("course_control_geometry_revision_check", sql`${table.revision} > 0`),
  check("course_control_geometry_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
  check("course_control_geometry_intent_check", sql`jsonb_typeof(${table.intent}) = 'object'`),
  foreignKey({ name: "course_control_geometry_race_fk", columns: [table.raceId], foreignColumns: [races.id] }),
  foreignKey({ name: "course_control_geometry_course_version_fk", columns: [table.courseVersionId], foreignColumns: [courseVersions.id] }),
  foreignKey({ name: "course_control_geometry_map_scope_fk", columns: [table.mapManifestId, table.raceId], foreignColumns: [mapObjectManifests.uploadId, mapObjectManifests.raceId] }),
  foreignKey({ name: "course_control_geometry_georeference_scope_fk", columns: [table.georeferenceId, table.raceId], foreignColumns: [mapGeoreferences.id, mapGeoreferences.raceId] }),
  foreignKey({ name: "course_control_geometry_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

export const courseControlGeometryPoints = pgTable("course_control_geometry_point", {
  revisionId: uuid("revision_id").notNull(),
  courseControlId: uuid("course_control_id").notNull(),
  courseVersionId: uuid("course_version_id").notNull(),
  sequence: integer("sequence").notNull(),
  pixelX: doublePrecision("pixel_x").notNull(),
  pixelY: doublePrecision("pixel_y").notNull()
}, (table) => [
  uniqueIndex("course_control_geometry_point_control_uidx").on(table.revisionId, table.courseControlId),
  uniqueIndex("course_control_geometry_point_sequence_uidx").on(table.revisionId, table.sequence),
  check("course_control_geometry_point_sequence_check", sql`${table.sequence} > 0`),
  check("course_control_geometry_point_finite_check", sql`${table.pixelX} = ${table.pixelX} AND ${table.pixelY} = ${table.pixelY}`),
  foreignKey({ name: "course_control_geometry_point_revision_fk", columns: [table.revisionId], foreignColumns: [courseControlGeometryRevisions.id] }),
  foreignKey({ name: "course_control_geometry_point_control_scope_fk", columns: [table.courseControlId, table.courseVersionId], foreignColumns: [courseControls.id, courseControls.courseVersionId] })
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

/** Durable identity; a legacy CREATE_EVENT credential never becomes an account. */
export const userAccounts = pgTable("user_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  loginName: text("login_name").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("user_account_login_name_uidx").on(table.loginName),
  check("user_account_login_name_check", sql`${table.loginName} ~ '^[a-z0-9][a-z0-9._-]{2,79}$'`),
  check("user_account_display_name_check", sql`length(btrim(${table.displayName})) between 1 and 120`)
]);

export const userAccountRevocations = pgTable("user_account_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [
  uniqueIndex("user_account_revocation_account_uidx").on(table.accountId),
  check("user_account_revocation_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`)
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

/** Per normalized login reservation and serialization marker for trusted invitations. */
export const accountInvitationSubjects = pgTable("account_invitation_subject", {
  loginName: text("login_name").primaryKey(),
  generation: bigint("generation", { mode: "bigint" }).notNull().default(0n),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  check("account_invitation_subject_login_name_check", sql`${table.loginName} ~ '^[a-z0-9][a-z0-9._-]{2,79}$'`),
  check("account_invitation_subject_generation_check", sql`${table.generation} >= 0`)
]);

export const accountInvitationIssues = pgTable("account_invitation_issue", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  codeHash: text("code_hash").notNull(),
  loginName: text("login_name").notNull().references(() => accountInvitationSubjects.loginName),
  displayName: text("display_name").notNull(),
  operatorLabel: text("operator_label").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("account_invitation_issue_request_uidx").on(table.requestId),
  uniqueIndex("account_invitation_issue_code_hash_uidx").on(table.codeHash),
  index("account_invitation_issue_login_issued_idx").on(table.loginName, table.issuedAt),
  check("account_invitation_issue_code_hash_check", sql`${table.codeHash} ~ '^[a-f0-9]{64}$'`),
  check("account_invitation_issue_login_name_check", sql`${table.loginName} ~ '^[a-z0-9][a-z0-9._-]{2,79}$'`),
  check("account_invitation_issue_display_name_check", sql`length(btrim(${table.displayName})) between 1 and 120`),
  check("account_invitation_issue_operator_label_check", sql`length(btrim(${table.operatorLabel})) between 1 and 120`),
  check("account_invitation_issue_lifetime_check",
    sql`${table.expiresAt} > ${table.issuedAt} AND ${table.expiresAt} <= ${table.issuedAt} + interval '48 hours'`)
]);

export const accountInvitationRevocations = pgTable("account_invitation_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  invitationId: uuid("invitation_id").notNull().references(() => accountInvitationIssues.id),
  operatorLabel: text("operator_label").notNull(),
  reason: text("reason").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("account_invitation_revocation_request_uidx").on(table.requestId),
  uniqueIndex("account_invitation_revocation_invitation_uidx").on(table.invitationId),
  check("account_invitation_revocation_operator_label_check", sql`length(btrim(${table.operatorLabel})) between 1 and 120`),
  check("account_invitation_revocation_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`)
]);

export const accountInvitationRedemptions = pgTable("account_invitation_redemption", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  invitationId: uuid("invitation_id").notNull().references(() => accountInvitationIssues.id),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  intentHash: text("intent_hash").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("account_invitation_redemption_request_uidx").on(table.requestId),
  uniqueIndex("account_invitation_redemption_invitation_uidx").on(table.invitationId),
  uniqueIndex("account_invitation_redemption_account_uidx").on(table.accountId),
  check("account_invitation_redemption_intent_hash_check", sql`${table.intentHash} ~ '^[a-f0-9]{64}$'`)
]);

/** Mutable rate-limit state; the hash avoids retaining login names for unknown attempts. */
export const accountInvitationThrottles = pgTable("account_invitation_throttle", {
  loginKeyHash: text("login_key_hash").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true })
}, (table) => [
  check("account_invitation_throttle_key_check", sql`${table.loginKeyHash} ~ '^[a-f0-9]{64}$'`),
  check("account_invitation_throttle_attempts_check", sql`${table.failedAttempts} >= 0`)
]);

/** TASK161: trusted, one-time recovery for an existing account. */
export const accountPasswordRecoveryIssues = pgTable("account_password_recovery_issue", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  loginName: text("login_name").notNull(),
  operatorLabel: text("operator_label").notNull(),
  reason: text("reason").notNull(),
  codeHash: text("code_hash").notNull(),
  expectedPasswordVersion: integer("expected_password_version").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("account_password_recovery_issue_request_uidx").on(table.requestId),
  uniqueIndex("account_password_recovery_issue_code_hash_uidx").on(table.codeHash),
  uniqueIndex("account_password_recovery_issue_id_account_uidx").on(table.id, table.accountId),
  index("account_password_recovery_issue_account_issued_idx").on(table.accountId, table.issuedAt),
  check("account_password_recovery_issue_login_name_check", sql`${table.loginName} ~ '^[a-z0-9][a-z0-9._-]{2,79}$'`),
  check("account_password_recovery_issue_operator_label_check", sql`length(btrim(${table.operatorLabel})) between 1 and 120`),
  check("account_password_recovery_issue_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`),
  check("account_password_recovery_issue_code_hash_check", sql`${table.codeHash} ~ '^[a-f0-9]{64}$'`),
  check("account_password_recovery_issue_version_check", sql`${table.expectedPasswordVersion} > 0`),
  check("account_password_recovery_issue_lifetime_check",
    sql`${table.expiresAt} > ${table.issuedAt} AND ${table.expiresAt} <= ${table.issuedAt} + interval '24 hours'`),
  foreignKey({
    name: "account_password_recovery_issue_verifier_fk",
    columns: [table.accountId, table.expectedPasswordVersion],
    foreignColumns: [userAccountPasswordVerifiers.accountId, userAccountPasswordVerifiers.version]
  })
]);

export const accountPasswordRecoveryRevocations = pgTable("account_password_recovery_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  recoveryId: uuid("recovery_id").notNull().references(() => accountPasswordRecoveryIssues.id),
  operatorLabel: text("operator_label").notNull(),
  reason: text("reason").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("account_password_recovery_revocation_request_uidx").on(table.requestId),
  uniqueIndex("account_password_recovery_revocation_recovery_uidx").on(table.recoveryId),
  check("account_password_recovery_revocation_operator_label_check", sql`length(btrim(${table.operatorLabel})) between 1 and 120`),
  check("account_password_recovery_revocation_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`)
]);

export const accountPasswordRecoveryRedemptions = pgTable("account_password_recovery_redemption", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  recoveryId: uuid("recovery_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  passwordVersion: integer("password_version").notNull(),
  intentHash: text("intent_hash").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("account_password_recovery_redemption_request_uidx").on(table.requestId),
  uniqueIndex("account_password_recovery_redemption_recovery_uidx").on(table.recoveryId),
  foreignKey({
    name: "account_password_recovery_redemption_issue_account_fk",
    columns: [table.recoveryId, table.accountId],
    foreignColumns: [accountPasswordRecoveryIssues.id, accountPasswordRecoveryIssues.accountId]
  }),
  foreignKey({
    name: "account_password_recovery_redemption_verifier_fk",
    columns: [table.accountId, table.passwordVersion],
    foreignColumns: [userAccountPasswordVerifiers.accountId, userAccountPasswordVerifiers.version]
  }),
  check("account_password_recovery_redemption_version_check", sql`${table.passwordVersion} > 0`),
  check("account_password_recovery_redemption_intent_hash_check", sql`${table.intentHash} ~ '^[a-f0-9]{64}$'`)
]);

/** Mutable, hashed per-login guessing control; includes unknown login names. */
export const accountPasswordRecoveryThrottles = pgTable("account_password_recovery_throttle", {
  loginKeyHash: text("login_key_hash").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true })
}, (table) => [
  check("account_password_recovery_throttle_key_check", sql`${table.loginKeyHash} ~ '^[a-f0-9]{64}$'`),
  check("account_password_recovery_throttle_attempts_check", sql`${table.failedAttempts} >= 0`)
]);

/** TASK160: immutable event/actor scope for OWNER-issued invitation actions. */
export const eventAccountInvitationIssues = pgTable("event_account_invitation_issue", {
  requestId: uuid("request_id").primaryKey(),
  invitationId: uuid("invitation_id").notNull().unique().references(() => accountInvitationIssues.id),
  eventId: uuid("event_id").notNull().references(() => events.id),
  actorAccountId: uuid("actor_account_id").notNull().references(() => userAccounts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("event_account_invitation_issue_scope_uidx").on(table.invitationId, table.eventId),
  index("event_account_invitation_issue_event_created_idx").on(table.eventId, table.createdAt)
]);

export const eventAccountInvitationRevocations = pgTable("event_account_invitation_revocation", {
  requestId: uuid("request_id").primaryKey(),
  revocationId: uuid("revocation_id").notNull().unique().references(() => accountInvitationRevocations.id),
  invitationId: uuid("invitation_id").notNull().unique(),
  eventId: uuid("event_id").notNull(),
  actorAccountId: uuid("actor_account_id").notNull().references(() => userAccounts.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  foreignKey({ name: "event_account_invitation_revocation_scope_fk",
    columns: [table.invitationId, table.eventId],
    foreignColumns: [eventAccountInvitationIssues.invitationId, eventAccountInvitationIssues.eventId] }),
  index("event_account_invitation_revocation_event_created_idx").on(table.eventId, table.createdAt),
  check("event_account_invitation_revocation_reason_check", sql`length(btrim(${table.reason})) between 1 and 240`)
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
  eventId: uuid("event_id").notNull().references(() => events.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
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

export const eventorConnections = pgTable("eventor_connection", {
  id: uuid("id").primaryKey(),
  ownerCredentialId: uuid("owner_credential_id").notNull().references(() => eventCreationAccessCredentials.id),
  environment: text("environment").$type<"testeventor-se" | "production-se">().notNull(),
  label: text("label").notNull(),
  keyId: text("key_id").notNull(),
  formatVersion: integer("format_version").$type<1>().notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  ciphertext: text("ciphertext").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  operatorLabel: text("operator_label").notNull(),
}, (table) => [
  uniqueIndex("eventor_connection_id_owner_uidx").on(table.id, table.ownerCredentialId),
  index("eventor_connection_owner_idx").on(table.ownerCredentialId),
  check("eventor_connection_environment_check", sql`${table.environment} IN ('testeventor-se', 'production-se')`),
  check("eventor_connection_label_check", sql`length(btrim(${table.label})) between 1 and 120 AND length(btrim(${table.operatorLabel})) between 1 and 120`),
  check("eventor_connection_key_check", sql`${table.keyId} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`),
  check("eventor_connection_envelope_check", sql`${table.formatVersion} = 1 AND ${table.iv} ~ '^[A-Za-z0-9_-]{16}$' AND ${table.tag} ~ '^[A-Za-z0-9_-]{22}$' AND ${table.ciphertext} ~ '^[A-Za-z0-9_-]{43}$'`),
]);

export const eventorConnectionRevocations = pgTable("eventor_connection_revocation", {
  connectionId: uuid("connection_id").primaryKey().references(() => eventorConnections.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  operatorLabel: text("operator_label").notNull(),
}, (table) => [
  check("eventor_connection_revocation_operator_check", sql`length(btrim(${table.operatorLabel})) between 1 and 120`),
]);

export const eventorImportRequests = pgTable("eventor_import_request", {
  requestId: uuid("request_id").primaryKey(),
  connectionId: uuid("connection_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull().references(() => eventCreationAccessCredentials.id),
  environment: text("environment").$type<"testeventor-se" | "production-se">().notNull(),
  externalEventId: text("external_event_id").notNull(),
  externalEventRaceId: text("external_event_race_id").notNull(),
  sourceHash: text("source_hash").notNull(),
  mappingVersion: integer("mapping_version").notNull(),
  eventName: text("event_name").notNull(),
  eventStartDate: date("event_start_date").notNull(),
  raceName: text("race_name").notNull(),
  raceDate: date("race_date").notNull(),
  timeZone: text("time_zone").notNull(),
  eventId: uuid("event_id").notNull().references(() => events.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("eventor_import_external_event_uidx").on(table.environment, table.externalEventId),
  uniqueIndex("eventor_import_event_uidx").on(table.eventId),
  uniqueIndex("eventor_import_race_uidx").on(table.raceId),
  uniqueIndex("eventor_import_request_provenance_uidx").on(table.requestId, table.raceId, table.actorCredentialId),
  check("eventor_import_environment_check", sql`${table.environment} IN ('testeventor-se', 'production-se')`),
  check("eventor_import_external_id_check", sql`length(${table.externalEventId}) between 1 and 256 AND length(${table.externalEventRaceId}) between 1 and 256`),
  check("eventor_import_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$' AND ${table.mappingVersion} = 1`),
  check("eventor_import_names_check", sql`length(btrim(${table.eventName})) between 2 and 160 AND length(btrim(${table.raceName})) between 2 and 160 AND length(btrim(${table.timeZone})) between 1 and 100`),
  foreignKey({ columns: [table.connectionId, table.actorCredentialId], foreignColumns: [eventorConnections.id, eventorConnections.ownerCredentialId], name: "eventor_import_connection_owner_fk" }),
  foreignKey({ columns: [table.raceId, table.eventId], foreignColumns: [races.id, races.eventId], name: "eventor_import_race_event_fk" }),
]);

/**
 * A server-side authorization bridge from an Eventor connection owner to one
 * already race-scoped IMPORT_IOF credential. It deliberately carries no API
 * key, browser secret or free-standing Eventor event/race identifier.
 */
export const eventorRaceImportGrants = pgTable("eventor_race_import_grant", {
  id: uuid("id").primaryKey(),
  eventorImportRequestId: uuid("eventor_import_request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  recipientCredentialId: uuid("recipient_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  issuerCredentialId: uuid("issuer_credential_id").notNull(),
  label: text("label").notNull(),
  operatorLabel: text("operator_label").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("eventor_race_import_grant_id_race_uidx").on(table.id, table.raceId),
  uniqueIndex("eventor_race_import_grant_id_issuer_uidx").on(table.id, table.issuerCredentialId),
  index("eventor_race_import_grant_race_time_idx").on(table.raceId, table.issuedAt),
  index("eventor_race_import_grant_recipient_race_idx").on(table.recipientCredentialId, table.raceId),
  foreignKey({
    columns: [table.eventorImportRequestId, table.raceId, table.issuerCredentialId],
    foreignColumns: [eventorImportRequests.requestId, eventorImportRequests.raceId, eventorImportRequests.actorCredentialId],
    name: "eventor_race_import_grant_provenance_fk"
  }),
  foreignKey({
    columns: [table.recipientCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability],
    name: "eventor_race_import_grant_recipient_scope_fk"
  }),
  check("eventor_race_import_grant_capability_check", sql`${table.capability} = 'IMPORT_IOF'`),
  check("eventor_race_import_grant_text_check", sql`length(btrim(${table.label})) between 1 and 120 AND length(btrim(${table.operatorLabel})) between 1 and 120`)
]);

export const eventorRaceImportGrantRevocations = pgTable("eventor_race_import_grant_revocation", {
  grantId: uuid("grant_id").primaryKey().references(() => eventorRaceImportGrants.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  issuerCredentialId: uuid("issuer_credential_id").notNull(),
  operatorLabel: text("operator_label").notNull(),
  reason: text("reason").notNull(),
}, (table) => [
  foreignKey({
    columns: [table.grantId, table.issuerCredentialId],
    foreignColumns: [eventorRaceImportGrants.id, eventorRaceImportGrants.issuerCredentialId],
    name: "eventor_race_import_grant_revocation_issuer_fk"
  }),
  check("eventor_race_import_grant_revocation_text_check", sql`length(btrim(${table.operatorLabel})) between 1 and 120 AND length(btrim(${table.reason})) between 1 and 240`)
]);

/** Immutable receipt for an exact explicit mapping and Eventor source pair. */
export const eventorEntryImportRequests = pgTable("eventor_entry_import_request", {
  requestId: uuid("request_id").primaryKey(),
  grantId: uuid("grant_id").notNull(),
  raceId: uuid("race_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  eventClassesSourceHash: text("event_classes_source_hash").notNull(),
  entriesSourceHash: text("entries_source_hash").notNull(),
  mappingHash: text("mapping_hash").notNull(),
  intentHash: text("intent_hash").notNull(),
  mapping: jsonb("mapping").notNull(),
  response: jsonb("response").notNull(),
  entriesSeen: integer("entries_seen").notNull(),
  entriesCreated: integer("entries_created").notNull(),
  entriesUnchanged: integer("entries_unchanged").notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("eventor_entry_import_request_race_time_idx").on(table.raceId, table.createdAt),
  uniqueIndex("eventor_entry_import_request_intent_uidx").on(table.raceId, table.intentHash),
  foreignKey({ columns: [table.grantId, table.raceId], foreignColumns: [eventorRaceImportGrants.id, eventorRaceImportGrants.raceId], name: "eventor_entry_import_request_grant_scope_fk" }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability], name: "eventor_entry_import_request_actor_scope_fk" }),
  check("eventor_entry_import_request_capability_check", sql`${table.capability} = 'IMPORT_IOF'`),
  check("eventor_entry_import_request_hash_check", sql`${table.eventClassesSourceHash} ~ '^[a-f0-9]{64}$' AND ${table.entriesSourceHash} ~ '^[a-f0-9]{64}$' AND ${table.mappingHash} ~ '^[a-f0-9]{64}$' AND ${table.intentHash} ~ '^[a-f0-9]{64}$'`),
  check("eventor_entry_import_request_json_check", sql`jsonb_typeof(${table.mapping}) = 'array' AND jsonb_typeof(${table.response}) = 'object'`),
  check("eventor_entry_import_request_count_check", sql`${table.entriesSeen} between 0 and 10000 AND ${table.entriesCreated} between 0 and ${table.entriesSeen} AND ${table.entriesUnchanged} between 0 and ${table.entriesSeen} AND ${table.entriesCreated} + ${table.entriesUnchanged} = ${table.entriesSeen}`),
  check("eventor_entry_import_request_snapshot_check", sql`${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter} = ${table.snapshotVersionBefore} + CASE WHEN ${table.entriesCreated} > 0 THEN 1 ELSE 0 END`)
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

/** Immutable, race-wide decision header for a reproducible FIXED-class draw. */
export const classStartDrawRequests = pgTable("class_start_draw_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  classId: uuid("class_id").notNull().references(() => classes.id),
  actorCredentialId: uuid("actor_credential_id").notNull().references(() => pairingAdminAccessCredentials.id),
  sourceHash: text("source_hash").notNull(),
  timeZone: text("time_zone").notNull(),
  algorithmVersion: text("algorithm_version").notNull(),
  seed: bigint("seed", { mode: "number" }).notNull(),
  firstStartTime: timestamp("first_start_time", { withTimezone: true }).notNull(),
  intervalSeconds: integer("interval_seconds").notNull(),
  entryCount: integer("entry_count").notNull(),
  changedEntryCount: integer("changed_entry_count").notNull(),
  snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("class_start_draw_request_request_uidx").on(table.requestId),
  uniqueIndex("class_start_draw_request_scope_uidx").on(table.id, table.raceId, table.classId, table.sourceHash),
  index("class_start_draw_request_race_time_idx").on(table.raceId, table.changedAt),
  check("class_start_draw_request_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
  check("class_start_draw_request_seed_check", sql`${table.seed} between 1 and 4294967295`),
  check("class_start_draw_request_interval_check", sql`${table.intervalSeconds} between 1 and 3600`),
  check("class_start_draw_request_count_check", sql`${table.entryCount} between 1 and 10000 AND ${table.changedEntryCount} between 1 and ${table.entryCount}`),
  check("class_start_draw_request_snapshot_check", sql`${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter} = ${table.snapshotVersionBefore} + 1`)
]);

/** Full pre/post roster retained even for entries whose time was already correct. */
export const classStartDrawItems = pgTable("class_start_draw_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  drawRequestId: uuid("draw_request_id").notNull().references(() => classStartDrawRequests.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  displayName: text("display_name").notNull(),
  previousFixedStartTime: timestamp("previous_fixed_start_time", { withTimezone: true }),
  fixedStartTime: timestamp("fixed_start_time", { withTimezone: true }).notNull(),
  entryVersionBefore: integer("entry_version_before").notNull(),
  entryVersionAfter: integer("entry_version_after").notNull()
}, (table) => [
  uniqueIndex("class_start_draw_item_request_entry_uidx").on(table.drawRequestId, table.entryId),
  check("class_start_draw_item_version_check", sql`${table.entryVersionBefore} > 0 AND ${table.entryVersionAfter} = ${table.entryVersionBefore} + CASE WHEN ${table.previousFixedStartTime} IS DISTINCT FROM ${table.fixedStartTime} THEN 1 ELSE 0 END`)
]);

/** Immutable evidence that a class transfer claimed a specific saved draw slot. */
export const entryStartSlotAssignments = pgTable("entry_start_slot_assignment", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferRequestId: uuid("transfer_request_id").notNull().unique().references(() => entryTransferRequests.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull(), targetClassId: uuid("target_class_id").notNull(),
  drawRequestId: uuid("draw_request_id").notNull(), sourceHash: text("source_hash").notNull(),
  fixedStartTime: timestamp("fixed_start_time", { withTimezone: true }).notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  foreignKey({ columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ columns: [table.targetClassId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.drawRequestId, table.raceId, table.targetClassId, table.sourceHash],
    foreignColumns: [classStartDrawRequests.id, classStartDrawRequests.raceId, classStartDrawRequests.classId, classStartDrawRequests.sourceHash] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  index("entry_start_slot_assignment_race_class_time_idx").on(table.raceId, table.targetClassId, table.fixedStartTime),
  check("entry_start_slot_assignment_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("entry_start_slot_assignment_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
  check("entry_start_slot_assignment_time_precision_check", sql`date_trunc('milliseconds', ${table.fixedStartTime}) = ${table.fixedStartTime}`)
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("entry_registration_request_request_uidx").on(table.requestId),
  uniqueIndex("entry_registration_request_entry_uidx").on(table.entryId),
  index("entry_registration_request_race_time_idx").on(table.raceId, table.createdAt),
  check("entry_registration_request_object_check", sql`jsonb_typeof(${table.request}) = 'object'`),
  check("entry_registration_request_version_check", sql`${table.snapshotVersionAfter} > 1`)
]);

/** Immutable evidence that a new entry claimed a specific saved draw slot. */
export const entryRegistrationStartSlotAssignments = pgTable("entry_registration_start_slot_assignment", {
  id: uuid("id").primaryKey().defaultRandom(),
  registrationRequestId: uuid("registration_request_id").notNull().unique().references(() => entryRegistrationRequests.id),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull(), targetClassId: uuid("target_class_id").notNull(),
  drawRequestId: uuid("draw_request_id").notNull(), sourceHash: text("source_hash").notNull(),
  fixedStartTime: timestamp("fixed_start_time", { withTimezone: true }).notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(), capability: pairingAdminCapabilityEnum("capability").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  foreignKey({ columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ columns: [table.targetClassId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.drawRequestId, table.raceId, table.targetClassId, table.sourceHash],
    foreignColumns: [classStartDrawRequests.id, classStartDrawRequests.raceId, classStartDrawRequests.classId, classStartDrawRequests.sourceHash] }),
  foreignKey({ columns: [table.actorCredentialId, table.raceId, table.capability],
    foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] }),
  index("entry_registration_start_slot_assignment_race_class_time_idx").on(table.raceId, table.targetClassId, table.fixedStartTime),
  check("entry_registration_start_slot_assignment_capability_check", sql`${table.capability}::text IN ('REGISTER_ENTRY', 'MANAGE_RACE')`),
  check("entry_registration_start_slot_assignment_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
  check("entry_registration_start_slot_assignment_time_precision_check", sql`date_trunc('milliseconds', ${table.fixedStartTime}) = ${table.fixedStartTime}`)
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

/** TASK111: browser-originated, hash-only authority for one participant's private route upload. */
export const routeUploadGrants = pgTable("route_upload_grant", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  issuerCredentialId: uuid("issuer_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  secretHash: text("secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("route_upload_grant_request_uidx").on(table.requestId),
  uniqueIndex("route_upload_grant_scope_uidx").on(table.id, table.raceId, table.entryId),
  index("route_upload_grant_entry_idx").on(table.raceId, table.entryId, table.expiresAt),
  check("route_upload_grant_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("route_upload_grant_secret_hash_check", sql`${table.secretHash} ~ '^[a-f0-9]{64}$'`),
  check("route_upload_grant_expiry_check", sql`${table.expiresAt} > ${table.issuedAt} AND ${table.expiresAt} <= ${table.issuedAt} + interval '30 days'`),
  foreignKey({ name: "route_upload_grant_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "route_upload_grant_issuer_scope_fk", columns: [table.issuerCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

/** One immutable revocation can stop all future sessions and uploads for a grant. */
export const routeUploadGrantRevocations = pgTable("route_upload_grant_revocation", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  grantId: uuid("grant_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull()
}, (table) => [
  uniqueIndex("route_upload_grant_revocation_request_uidx").on(table.requestId),
  uniqueIndex("route_upload_grant_revocation_grant_uidx").on(table.grantId),
  check("route_upload_grant_revocation_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("route_upload_grant_revocation_reason_check", sql`char_length(btrim(${table.reason})) BETWEEN 1 AND 240`),
  foreignKey({ name: "route_upload_grant_revocation_grant_scope_fk", columns: [table.grantId, table.raceId, table.entryId], foreignColumns: [routeUploadGrants.id, routeUploadGrants.raceId, routeUploadGrants.entryId] }),
  foreignKey({ name: "route_upload_grant_revocation_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

/** Short, hash-only browser session created after the bearer link is immediately removed from the URL. */
export const routeUploadSessions = pgTable("route_upload_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  grantId: uuid("grant_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  sessionSecretHash: text("session_secret_hash").notNull(),
  csrfSecretHash: text("csrf_secret_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [
  index("route_upload_session_grant_idx").on(table.grantId, table.expiresAt),
  check("route_upload_session_secret_hash_check", sql`${table.sessionSecretHash} ~ '^[a-f0-9]{64}$' AND ${table.csrfSecretHash} ~ '^[a-f0-9]{64}$'`),
  check("route_upload_session_expiry_check", sql`${table.expiresAt} > ${table.issuedAt} AND ${table.expiresAt} <= ${table.issuedAt} + interval '1 hour'`),
  foreignKey({ name: "route_upload_session_grant_scope_fk", columns: [table.grantId, table.raceId, table.entryId], foreignColumns: [routeUploadGrants.id, routeUploadGrants.raceId, routeUploadGrants.entryId] })
]);

/** A single immutable reservation is all a participant grant may ever store. */
export const routeUploadReservations = pgTable("route_upload_reservation", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  grantId: uuid("grant_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  fileName: text("file_name").notNull(),
  mediaType: text("media_type").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("route_upload_reservation_request_uidx").on(table.requestId),
  uniqueIndex("route_upload_reservation_grant_uidx").on(table.grantId),
  uniqueIndex("route_upload_reservation_scope_content_uidx").on(table.id, table.grantId, table.raceId, table.entryId, table.mediaType, table.sha256, table.byteLength),
  check("route_upload_reservation_file_name_check", sql`char_length(${table.fileName}) BETWEEN 1 AND 120 AND ${table.fileName} = btrim(${table.fileName}) AND ${table.fileName} !~ '[\\\\/[:cntrl:]]'`),
  check("route_upload_reservation_media_type_check", sql`${table.mediaType} = 'application/gpx+xml'`),
  check("route_upload_reservation_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("route_upload_reservation_byte_length_check", sql`${table.byteLength} BETWEEN 1 AND 8388608`),
  foreignKey({ name: "route_upload_reservation_grant_scope_fk", columns: [table.grantId, table.raceId, table.entryId], foreignColumns: [routeUploadGrants.id, routeUploadGrants.raceId, routeUploadGrants.entryId] })
]);

/** Every charged private object PUT remains immutable evidence, including a failed attempt. */
export const routeUploadAttempts = pgTable("route_upload_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id").notNull(),
  grantId: uuid("grant_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  mediaType: text("media_type").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  chargedAt: timestamp("charged_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("route_upload_attempt_upload_number_uidx").on(table.uploadId, table.attemptNumber),
  uniqueIndex("route_upload_attempt_manifest_scope_uidx").on(table.id, table.uploadId, table.grantId, table.raceId, table.entryId, table.mediaType, table.sha256, table.byteLength),
  check("route_upload_attempt_number_check", sql`${table.attemptNumber} BETWEEN 1 AND 8`),
  check("route_upload_attempt_media_type_check", sql`${table.mediaType} = 'application/gpx+xml'`),
  check("route_upload_attempt_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("route_upload_attempt_byte_length_check", sql`${table.byteLength} BETWEEN 1 AND 8388608`),
  foreignKey({ name: "route_upload_attempt_reservation_content_fk", columns: [table.uploadId, table.grantId, table.raceId, table.entryId, table.mediaType, table.sha256, table.byteLength], foreignColumns: [routeUploadReservations.id, routeUploadReservations.grantId, routeUploadReservations.raceId, routeUploadReservations.entryId, routeUploadReservations.mediaType, routeUploadReservations.sha256, routeUploadReservations.byteLength] })
]);

/** One exact private GPX object version, bound to the successful charged attempt. */
export const routeObjectManifests = pgTable("route_object_manifest", {
  uploadId: uuid("upload_id").primaryKey(),
  attemptId: uuid("attempt_id").notNull(),
  grantId: uuid("grant_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  storeId: uuid("store_id").notNull(),
  objectKey: text("object_key").notNull(),
  versionId: text("version_id").notNull(),
  mediaType: text("media_type").notNull(),
  sha256: text("sha256").notNull(),
  byteLength: integer("byte_length").notNull(),
  pointCount: integer("point_count").notNull(),
  segmentCount: integer("segment_count").notNull(),
  firstRecordedAt: timestamp("first_recorded_at", { withTimezone: true }),
  lastRecordedAt: timestamp("last_recorded_at", { withTimezone: true }),
  parser: text("parser").notNull(),
  storedAt: timestamp("stored_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("route_object_manifest_store_key_version_uidx").on(table.storeId, table.objectKey, table.versionId),
  uniqueIndex("route_object_manifest_attempt_uidx").on(table.attemptId),
  uniqueIndex("route_object_manifest_upload_scope_uidx").on(table.uploadId, table.raceId, table.entryId),
  uniqueIndex("route_object_manifest_context_scope_uidx").on(table.uploadId, table.raceId, table.entryId, table.sha256),
  check("route_object_manifest_media_type_check", sql`${table.mediaType} = 'application/gpx+xml'`),
  check("route_object_manifest_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  check("route_object_manifest_byte_length_check", sql`${table.byteLength} BETWEEN 1 AND 8388608`),
  check("route_object_manifest_counts_check", sql`${table.pointCount} BETWEEN 2 AND 100000 AND ${table.segmentCount} BETWEEN 1 AND 2000`),
  // These are the first and last supplied timestamps in source order, not a computed time range.
  check("route_object_manifest_time_range_check", sql`(${table.firstRecordedAt} IS NULL AND ${table.lastRecordedAt} IS NULL) OR (${table.firstRecordedAt} IS NOT NULL AND ${table.lastRecordedAt} IS NOT NULL)`),
  check("route_object_manifest_parser_check", sql`${table.parser} = 'otid-gpx-1.1'`),
  check("route_object_manifest_object_key_check", sql`${table.objectKey} = 'route/' || ${table.raceId}::text || '/' || ${table.attemptId}::text`),
  check("route_object_manifest_version_id_check", sql`char_length(${table.versionId}) BETWEEN 1 AND 1024 AND ${table.versionId} ~ '^[A-Za-z0-9._~+/-]+$' AND ${table.versionId} <> 'null'`),
  foreignKey({ name: "route_object_manifest_attempt_scope_fk", columns: [table.attemptId, table.uploadId, table.grantId, table.raceId, table.entryId, table.mediaType, table.sha256, table.byteLength], foreignColumns: [routeUploadAttempts.id, routeUploadAttempts.uploadId, routeUploadAttempts.grantId, routeUploadAttempts.raceId, routeUploadAttempts.entryId, routeUploadAttempts.mediaType, routeUploadAttempts.sha256, routeUploadAttempts.byteLength] })
]);

/** Normalized point order is immutable; this is not map alignment or result evidence. */
export const routePoints = pgTable("route_point", {
  uploadId: uuid("upload_id").notNull().references(() => routeObjectManifests.uploadId),
  sequence: integer("sequence").notNull(),
  segment: integer("segment").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  elevationMeters: doublePrecision("elevation_meters"),
  recordedAt: timestamp("recorded_at", { withTimezone: true })
}, (table) => [
  primaryKey({ name: "route_point_pk", columns: [table.uploadId, table.sequence] }),
  check("route_point_sequence_check", sql`${table.sequence} BETWEEN 0 AND 99999`),
  check("route_point_segment_check", sql`${table.segment} BETWEEN 0 AND 1999`),
  check("route_point_latitude_check", sql`${table.latitude} BETWEEN -90 AND 90`),
  check("route_point_longitude_check", sql`${table.longitude} BETWEEN -180 AND 180`)
]);

/** TASK116: participant decisions remain private evidence; they are not a public release. */
export const routePublicationConsents = pgTable("route_publication_consent", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  grantId: uuid("grant_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  manifestId: uuid("manifest_id").notNull(),
  sourceHash: text("source_hash").notNull(),
  revision: integer("revision").notNull(),
  decision: text("decision").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("route_publication_consent_request_uidx").on(table.requestId),
  uniqueIndex("route_publication_consent_manifest_revision_uidx").on(table.manifestId, table.revision),
  index("route_publication_consent_manifest_latest_idx").on(table.manifestId, desc(table.revision)),
  check("route_publication_consent_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
  check("route_publication_consent_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  check("route_publication_consent_decision_check", sql`${table.decision} IN ('GRANT', 'WITHDRAW')`),
  foreignKey({ name: "route_publication_consent_manifest_scope_fk", columns: [table.manifestId, table.raceId, table.entryId], foreignColumns: [routeObjectManifests.uploadId, routeObjectManifests.raceId, routeObjectManifests.entryId] }),
  foreignKey({ name: "route_publication_consent_grant_scope_fk", columns: [table.grantId, table.raceId, table.entryId], foreignColumns: [routeUploadGrants.id, routeUploadGrants.raceId, routeUploadGrants.entryId] })
]);

/** TASK117: an admin-selected public view; consent remains a separate participant journal. */
export const routePublications = pgTable("route_publication", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  revision: integer("revision").notNull(),
  action: text("action").$type<"RELEASE" | "WITHDRAW">().notNull(),
  routeManifestId: uuid("route_manifest_id"),
  routeSourceHash: text("route_source_hash"),
  mapManifestId: uuid("map_manifest_id"),
  mapSourceHash: text("map_source_hash"),
  georeferenceId: uuid("georeference_id"),
  intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("route_publication_request_uidx").on(table.requestId),
  uniqueIndex("route_publication_entry_revision_uidx").on(table.entryId, table.revision),
  index("route_publication_entry_latest_idx").on(table.entryId, desc(table.revision)),
  check("route_publication_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("route_publication_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  check("route_publication_action_check", sql`${table.action} IN ('RELEASE', 'WITHDRAW')`),
  check("route_publication_intent_check", sql`jsonb_typeof(${table.intent}) = 'object'`),
  check("route_publication_payload_check", sql`(${table.action} = 'RELEASE' AND ${table.routeManifestId} IS NOT NULL AND ${table.routeSourceHash} ~ '^[a-f0-9]{64}$' AND ${table.mapManifestId} IS NOT NULL AND ${table.mapSourceHash} ~ '^[a-f0-9]{64}$' AND ${table.georeferenceId} IS NOT NULL) OR (${table.action} = 'WITHDRAW' AND ${table.routeManifestId} IS NULL AND ${table.routeSourceHash} IS NULL AND ${table.mapManifestId} IS NULL AND ${table.mapSourceHash} IS NULL AND ${table.georeferenceId} IS NULL)`),
  foreignKey({ name: "route_publication_race_fk", columns: [table.raceId], foreignColumns: [races.id] }),
  foreignKey({ name: "route_publication_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "route_publication_route_scope_fk", columns: [table.routeManifestId, table.raceId, table.entryId], foreignColumns: [routeObjectManifests.uploadId, routeObjectManifests.raceId, routeObjectManifests.entryId] }),
  foreignKey({ name: "route_publication_map_scope_fk", columns: [table.mapManifestId, table.raceId], foreignColumns: [mapObjectManifests.uploadId, mapObjectManifests.raceId] }),
  foreignKey({ name: "route_publication_georeference_scope_fk", columns: [table.georeferenceId, table.raceId], foreignColumns: [mapGeoreferences.id, mapGeoreferences.raceId] }),
  foreignKey({ name: "route_publication_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
]);

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

/** TASK155: explicit immutable private map/course context for one exact GPX version. */
export const privateRouteContexts = pgTable("private_route_context", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  routeManifestId: uuid("route_manifest_id").notNull(),
  routeSourceHash: text("route_source_hash").notNull(),
  mapManifestId: uuid("map_manifest_id").notNull(),
  mapSourceHash: text("map_source_hash").notNull(),
  georeferenceId: uuid("georeference_id").notNull(),
  geometryRevisionId: uuid("geometry_revision_id").notNull(),
  sourceResultRevisionId: uuid("source_result_revision_id").notNull(),
  sourceResultRevision: integer("source_result_revision").notNull(),
  courseVersionId: uuid("course_version_id").notNull(),
  actorCredentialId: uuid("actor_credential_id").notNull(),
  capability: pairingAdminCapabilityEnum("capability").notNull(),
  revision: integer("revision").notNull(),
  intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("private_route_context_request_uidx").on(table.requestId),
  uniqueIndex("private_route_context_route_revision_uidx").on(table.routeManifestId, table.revision),
  index("private_route_context_route_latest_idx").on(table.routeManifestId, table.revision.desc()),
  check("private_route_context_capability_check", sql`${table.capability}::text = 'MANAGE_RACE'`),
  check("private_route_context_revision_check", sql`${table.revision} BETWEEN 1 AND 2147483647`),
  check("private_route_context_source_result_revision_check", sql`${table.sourceResultRevision} BETWEEN 1 AND 2147483647`),
  check("private_route_context_route_hash_check", sql`${table.routeSourceHash} ~ '^[a-f0-9]{64}$'`),
  check("private_route_context_map_hash_check", sql`${table.mapSourceHash} ~ '^[a-f0-9]{64}$'`),
  check("private_route_context_intent_check", sql`jsonb_typeof(${table.intent}) = 'object'`),
  foreignKey({ name: "private_route_context_race_fk", columns: [table.raceId], foreignColumns: [races.id] }),
  foreignKey({ name: "private_route_context_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "private_route_context_route_scope_fk", columns: [table.routeManifestId, table.raceId, table.entryId, table.routeSourceHash], foreignColumns: [routeObjectManifests.uploadId, routeObjectManifests.raceId, routeObjectManifests.entryId, routeObjectManifests.sha256] }),
  foreignKey({ name: "private_route_context_map_scope_fk", columns: [table.mapManifestId, table.raceId, table.mapSourceHash], foreignColumns: [mapObjectManifests.uploadId, mapObjectManifests.raceId, mapObjectManifests.sha256] }),
  foreignKey({ name: "private_route_context_georeference_scope_fk", columns: [table.georeferenceId, table.raceId, table.mapManifestId], foreignColumns: [mapGeoreferences.id, mapGeoreferences.raceId, mapGeoreferences.manifestId] }),
  foreignKey({ name: "private_route_context_geometry_scope_fk", columns: [table.geometryRevisionId, table.raceId, table.courseVersionId, table.mapManifestId, table.georeferenceId], foreignColumns: [courseControlGeometryRevisions.id, courseControlGeometryRevisions.raceId, courseControlGeometryRevisions.courseVersionId, courseControlGeometryRevisions.mapManifestId, courseControlGeometryRevisions.georeferenceId] }),
  foreignKey({ name: "private_route_context_result_scope_fk", columns: [table.sourceResultRevisionId, table.raceId, table.entryId, table.sourceResultRevision, table.courseVersionId], foreignColumns: [resultRevisions.id, resultRevisions.raceId, resultRevisions.entryId, resultRevisions.revision, resultRevisions.courseVersionId] }),
  foreignKey({ name: "private_route_context_course_version_fk", columns: [table.courseVersionId], foreignColumns: [courseVersions.id] }),
  foreignKey({ name: "private_route_context_actor_scope_fk", columns: [table.actorCredentialId, table.raceId, table.capability], foreignColumns: [pairingAdminAccessCredentials.id, pairingAdminAccessCredentials.raceId, pairingAdminAccessCredentials.capability] })
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
