import {
  boolean,
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Punch, ResultOutcome } from "@o-tid/domain";
import {
  auditActorKindEnum,
  cardAssignments,
  classes,
  courseControls,
  courseVersions,
  entries,
  races,
  rawDeviceMessages,
  resultFinalizationScopeEnum,
  revisionCauseEnum
} from "./core";

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
  readAt: timestamp("read_at", { withTimezone: true }).notNull(),
  /** Migration 0104: vilken klocka tiderna löstes mot och stationens avvikelse från datorn (PLAN.md steg 22); bigint från 0105. */
  clockSource: text("clock_source").$type<"station" | "device">(),
  clockOffsetMs: bigint("clock_offset_ms", { mode: "number" })
}, (table) => [
  uniqueIndex("card_readout_raw_uidx").on(table.rawMessageId),
  uniqueIndex("card_readout_resolution_scope_uidx").on(table.id, table.raceId, table.rawMessageId, table.cardNumber)
]);

export const resultRevisions = pgTable("result_revision", {
  id: uuid("id").primaryKey().defaultRandom(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  readoutId: uuid("readout_id").references(() => cardReadouts.id),
  // Avpricknings-DNS och kortbaneöverflyttning har egna journaler; nycklarna dit är uppskjutna (baslinjen).
  startCheckinDnsDecisionId: uuid("start_checkin_dns_decision_id"),
  controlNeutralizationId: uuid("control_neutralization_id"),
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
  // ADR-0169 beslut 1: hash av löparens bedömningsunderlag när revisionen skapades (databasutlösaren).
  basisHash: text("basis_hash"),
  // ADR-0173 beslut 1: arrangörens beslut bär begärans-id (idempotens) och kontot som fattade det.
  requestId: uuid("request_id"),
  actorAccountId: uuid("actor_account_id"),
  /** Disk med orsak (migration 0004): arrangörens text, bara på MANUAL_DISQUALIFICATION. */
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("result_revision_entry_revision_uidx").on(table.entryId, table.revision),
  uniqueIndex("result_revision_request_uidx").on(table.requestId).where(sql`${table.requestId} IS NOT NULL`),
  uniqueIndex("result_revision_start_checkin_dns_decision_uidx").on(table.startCheckinDnsDecisionId),
  uniqueIndex("result_revision_exact_source_tuple_uidx")
    .on(table.id, table.raceId, table.entryId, table.revision),
  uniqueIndex("result_revision_private_route_context_scope_uidx")
    .on(table.id, table.raceId, table.entryId, table.revision, table.courseVersionId),
  uniqueIndex("result_revision_start_checkin_dns_source_tuple_uidx")
    .on(table.id, table.startCheckinDnsDecisionId, table.raceId, table.entryId, table.revision),
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
  actorAccountId: uuid("actor_account_id").notNull(),
    basisHash: text("basis_hash").notNull(),
  request: jsonb("request").notNull(),
  response: jsonb("response").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("class_control_neutralization_class_course_version_uidx")
    .on(table.classId, table.courseVersionId),
  index("class_control_neutralization_race_idx").on(table.raceId)
]);

/** Immutable journal joining an original UNKNOWN_CARD observation to its later business resolution. */
export const unknownReadoutResolutions = pgTable("unknown_readout_resolution", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull(),
  readoutId: uuid("readout_id").notNull(),
  rawMessageId: uuid("raw_message_id").notNull(),
  cardNumber: text("card_number").notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
  role: text("role").$type<"ADMIN" | "FUNCTIONARY">().notNull(),
  target: text("target").notNull(),
  entryId: uuid("entry_id").notNull(),
  classId: uuid("class_id").notNull(),
  assignmentId: uuid("assignment_id").notNull(),
  createdResultRevisionId: uuid("created_result_revision_id").notNull(),
  createdResultRevision: integer("created_result_revision").notNull(),
    snapshotVersionAfter: integer("snapshot_version_after").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull()
}, (table) => [
  uniqueIndex("unknown_readout_resolution_readout_uidx").on(table.readoutId),
  uniqueIndex("unknown_readout_resolution_result_uidx").on(table.createdResultRevisionId),
  index("unknown_readout_resolution_race_time_idx").on(table.raceId, table.resolvedAt),
  check("unknown_readout_resolution_role_check",
    sql`${table.role} = 'ADMIN' OR (${table.role} = 'FUNCTIONARY' AND ${table.target} = 'NEW_ENTRY')`),
  check("unknown_readout_resolution_target_check", sql`${table.target} IN ('EXISTING_ENTRY', 'NEW_ENTRY')`),
  check("unknown_readout_resolution_snapshot_check", sql`${table.snapshotVersionAfter} > 1`),
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
  actorAccountId: uuid("actor_account_id").notNull(),
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

/**
 * Direktanmälan av okänd bricka på avläsningssidan (migration 0004, PLAN.md steg 25). En rad per begäran
 * (idempotens): ny deltagare (CREATED) eller brickan fanns redan anmäld (EXISTING). Append-only.
 */
export const readoutRegistrations = pgTable("readout_registration", {
  requestId: uuid("request_id").primaryKey(),
  raceId: uuid("race_id").notNull().references(() => races.id),
  cardNumber: text("card_number").notNull(),
  classId: uuid("class_id").notNull().references(() => classes.id),
  givenName: text("given_name").notNull(),
  familyName: text("family_name").notNull(),
  organisationName: text("organisation_name"),
  outcome: text("outcome").$type<"CREATED" | "EXISTING">().notNull(),
  entryId: uuid("entry_id").notNull().references(() => entries.id),
  actorAccountId: uuid("actor_account_id").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index("readout_registration_race_idx").on(table.raceId, table.createdAt),
  check("readout_registration_outcome_check", sql`${table.outcome} IN ('CREATED', 'EXISTING')`)
]);
