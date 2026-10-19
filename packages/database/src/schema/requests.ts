import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  cardAssignments,
  classes,
  entries,
  importFiles,
  races
} from "./core";
import {
  cardReadouts,
  resultRevisions
} from "./results";

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
  actorAccountId: uuid("actor_account_id"),
  applyRequest: jsonb("apply_request").$type<Record<string, unknown>>(),
  applyResponse: jsonb("apply_response").$type<Record<string, unknown>>()
}, (table) => [
  uniqueIndex("source_snapshot_applied_request_uidx").on(table.appliedRequestId),
  index("source_snapshot_race_source_idx").on(table.raceId, table.source, table.fetchedAt)
]);

export const iofImportRequests = pgTable("iof_import_request", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorAccountId: uuid("actor_account_id").notNull(),
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
  actorAccountId: uuid("actor_account_id").notNull(),
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
  actorAccountId: uuid("actor_account_id").notNull(),
  previousMaxEntries: integer("previous_max_entries"), maxEntries: integer("max_entries"),
  versionBefore: integer("version_before").notNull(), versionAfter: integer("version_after").notNull(),
  entryCount: integer("entry_count").notNull(), changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, table => [
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  check("class_capacity_change_check", sql`${table.previousMaxEntries} IS DISTINCT FROM ${table.maxEntries}`),
  check("class_capacity_versions_check", sql`${table.versionBefore} > 0 AND ${table.versionAfter}::bigint = ${table.versionBefore}::bigint + 1`),
  check("class_capacity_limits_check", sql`(${table.previousMaxEntries} IS NULL OR ${table.previousMaxEntries} BETWEEN 0 AND 10000) AND (${table.maxEntries} IS NULL OR ${table.maxEntries} BETWEEN 0 AND 10000) AND ${table.entryCount} >= 0 AND (${table.maxEntries} IS NULL OR ${table.entryCount} <= ${table.maxEntries})`),
  uniqueIndex("class_capacity_version_uidx").on(table.classId, table.versionBefore)
]);

export const entryTransferRequests = pgTable("entry_transfer_request", {
  id: uuid("id").primaryKey().defaultRandom(), requestId: uuid("request_id").notNull().unique(),
  raceId: uuid("race_id").notNull().references(() => races.id), entryId: uuid("entry_id").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
  previousClassId: uuid("previous_class_id").notNull(), targetClassId: uuid("target_class_id").notNull(),
  request: jsonb("request").notNull(), entryVersionBefore: integer("entry_version_before").notNull(),
  entryVersionAfter: integer("entry_version_after").notNull(), snapshotVersionBefore: integer("snapshot_version_before").notNull(),
  snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow()
}, table => [
  foreignKey({ columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ columns: [table.previousClassId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ columns: [table.targetClassId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
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
  actorAccountId: uuid("actor_account_id").notNull(),
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
  actorAccountId: uuid("actor_account_id").notNull(),
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
  actorAccountId: uuid("actor_account_id").notNull(),
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
  check("entry_card_rental_change_value_check", sql`${table.previousIsRental} IS DISTINCT FROM ${table.isRental}`),
  check("entry_card_rental_change_versions_check", sql`${table.entryVersionBefore} > 0 AND ${table.entryVersionAfter}::bigint = ${table.entryVersionBefore}::bigint + 1 AND ${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter}::bigint = ${table.snapshotVersionBefore}::bigint + 1`),
  foreignKey({ name: "entry_card_rental_change_entry_scope_fk", columns: [table.entryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "entry_card_rental_change_class_scope_fk", columns: [table.classId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "entry_card_rental_change_assignment_scope_fk", columns: [table.assignmentId, table.raceId, table.entryId, table.cardNumber],
    foreignColumns: [cardAssignments.id, cardAssignments.raceId, cardAssignments.entryId, cardAssignments.cardNumber] }),
]);

export const entryCardRentalReturnChanges = pgTable("entry_card_rental_return_change", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  classId: uuid("class_id").notNull(),
  assignmentId: uuid("assignment_id").notNull(),
  cardNumber: text("card_number").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
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
  check("entry_card_rental_return_change_value_check", sql`${table.previousRentalReturned} IS DISTINCT FROM ${table.rentalReturned}`),
  check("entry_card_rental_return_change_versions_check", sql`${table.entryVersionBefore} > 0 AND ${table.entryVersionAfter}::bigint = ${table.entryVersionBefore}::bigint + 1 AND ${table.snapshotVersionBefore} > 0 AND ${table.snapshotVersionAfter}::bigint = ${table.snapshotVersionBefore}::bigint + 1`),
  foreignKey({ name: "entry_card_rental_return_change_entry_scope_fk", columns: [table.entryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "entry_card_rental_return_change_class_scope_fk", columns: [table.classId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
  foreignKey({ name: "entry_card_rental_return_change_assignment_scope_fk", columns: [table.assignmentId, table.raceId, table.entryId, table.cardNumber],
    foreignColumns: [cardAssignments.id, cardAssignments.raceId, cardAssignments.entryId, cardAssignments.cardNumber] }),
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
  actorAccountId: uuid("actor_account_id").notNull(),
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
]);


export const entryIdentityChangeRequests = pgTable("entry_identity_change_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull(),
  classId: uuid("class_id").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
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
  foreignKey({ name: "entry_identity_change_entry_scope_fk", columns: [table.entryId, table.raceId],
    foreignColumns: [entries.id, entries.raceId] }),
  foreignKey({ name: "entry_identity_change_class_scope_fk", columns: [table.classId, table.raceId],
    foreignColumns: [classes.id, classes.raceId] }),
]);

export const entryRegistrationRequests = pgTable("entry_registration_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorAccountId: uuid("actor_account_id").notNull(),
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
  actorAccountId: uuid("actor_account_id").notNull(),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  expectedEntryVersion: integer("expected_entry_version").notNull(),
  expectedClassId: uuid("expected_class_id").notNull().references(() => classes.id),
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
  classId: uuid("class_id").notNull(), actorAccountId: uuid("actor_account_id").notNull(),
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
