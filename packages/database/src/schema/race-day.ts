import {
  boolean,
  check,
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
  classes,
  courseVersions,
  courses,
  entries,
  races
} from "./core";
import {
  cardReadouts,
  resultRevisions
} from "./results";

export const startCheckinDevices = pgTable("start_checkin_device", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  actorAccountId: uuid("actor_account_id").notNull(),
  role: text("role").$type<"ADMIN" | "FUNCTIONARY">().notNull(),
  label: text("label").notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("start_checkin_device_scope_uidx").on(table.id, table.raceId, table.actorAccountId),
  index("start_checkin_device_race_idx").on(table.raceId),
  check("start_checkin_device_role_check", sql`${table.role} IN ('ADMIN', 'FUNCTIONARY')`),
  uniqueIndex("start_checkin_device_online_account_uidx").on(table.raceId, table.actorAccountId, table.role),
  check("start_checkin_device_label_check", sql`length(btrim(${table.label})) BETWEEN 1 AND 120`),
]);

export const startCheckinOperations = pgTable("start_checkin_operation", {
  requestId: uuid("request_id").primaryKey(),
  deviceId: uuid("device_id").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
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
  uniqueIndex("start_checkin_operation_recovery_source_uidx").on(table.requestId, table.deviceId, table.actorAccountId, table.raceId, table.localSequence, table.contentHash),
  uniqueIndex("start_checkin_operation_conflict_review_source_uidx")
    .on(table.requestId, table.raceId, table.entryId, table.contentHash, table.effect),
  uniqueIndex("start_checkin_operation_revision_scope_uidx").on(table.requestId, table.raceId, table.entryId, table.effect, table.resultingRevision),
  uniqueIndex("start_checkin_operation_created_revision_uidx").on(table.createdRevisionId),
  index("start_checkin_operation_entry_idx").on(table.raceId, table.entryId, table.receivedAt),
  foreignKey({ name: "start_checkin_operation_device_scope_fk", columns: [table.deviceId, table.raceId, table.actorAccountId],
    foreignColumns: [startCheckinDevices.id, startCheckinDevices.raceId, startCheckinDevices.actorAccountId] }),
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
  actorAccountId: uuid("actor_account_id").notNull(),
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
  actorAccountId: uuid("actor_account_id").notNull(),
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
  entryId: uuid("entry_id").notNull(), actorAccountId: uuid("actor_account_id").notNull(),
  decision: text("decision").$type<"KEEP_CURRENT_STATE">().notNull(),
  reason: text("reason").notNull(), sourceHash: text("source_hash").notNull(),
  intentCanonicalJson: text("intent_canonical_json").notNull(), intentHash: text("intent_hash").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("start_checkin_conflict_review_request_uidx").on(table.requestId),
  uniqueIndex("start_checkin_conflict_review_scope_uidx").on(table.id, table.raceId, table.entryId),
  index("start_checkin_conflict_review_race_time_idx").on(table.raceId, table.reviewedAt),
  check("start_checkin_conflict_review_decision_check", sql`${table.decision} = 'KEEP_CURRENT_STATE'`),
  check("start_checkin_conflict_review_reason_check", sql`length(btrim(${table.reason})) BETWEEN 1 AND 500`),
  check("start_checkin_conflict_review_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$' AND ${table.intentHash} ~ '^[a-f0-9]{64}$'`),
  check("start_checkin_conflict_review_intent_check", sql`jsonb_typeof(${table.intentCanonicalJson}::jsonb) = 'object'`),
  foreignKey({ name: "start_checkin_conflict_review_entry_scope_fk", columns: [table.entryId, table.raceId], foreignColumns: [entries.id, entries.raceId] }),
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
  actorAccountId: uuid("actor_account_id").notNull(), revision: integer("revision").notNull(), action: text("action").$type<"PUBLISH" | "WITHDRAW">().notNull(),
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

export const manualCourseClassCreateRequests = pgTable("manual_course_class_create_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  courseId: uuid("course_id").notNull(), courseVersionId: uuid("course_version_id").notNull(), classId: uuid("class_id").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull()
}, table => [
  uniqueIndex("manual_course_class_create_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.courseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.courseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  check("manual_course_class_create_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
]);

export const manualClassCreateRequests = pgTable("manual_class_create_request", {
  requestId: uuid("request_id").primaryKey(), raceId: uuid("race_id").notNull().references(() => races.id),
  courseId: uuid("course_id").notNull(), courseVersionId: uuid("course_version_id").notNull(), classId: uuid("class_id").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(), response: jsonb("response").$type<Record<string, unknown>>().notNull()
}, table => [
  uniqueIndex("manual_class_create_request_scope_uidx").on(table.requestId, table.raceId),
  foreignKey({ columns: [table.courseId, table.raceId], foreignColumns: [courses.id, courses.raceId] }),
  foreignKey({ columns: [table.courseVersionId, table.courseId], foreignColumns: [courseVersions.id, courseVersions.courseId] }),
  foreignKey({ columns: [table.classId, table.raceId], foreignColumns: [classes.id, classes.raceId] }),
  check("manual_class_create_request_json_check", sql`jsonb_typeof(${table.request}) = 'object' AND jsonb_typeof(${table.response}) = 'object'`)
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
  actorAccountId: uuid("actor_account_id").notNull(),
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
