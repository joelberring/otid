import {
  boolean,
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  type RaceTypeValue,
  eventAdministrationRoleEnum,
  events,
  races
} from "./core";

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
  action: text("action").$type<"GRANT_ADMIN" | "REVOKE_ADMIN" | "GRANT_FUNCTIONARY" | "REVOKE_FUNCTIONARY">().notNull(),
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
  check("event_administration_access_request_action_check",
    sql`${table.action} IN ('GRANT_ADMIN', 'REVOKE_ADMIN', 'GRANT_FUNCTIONARY', 'REVOKE_FUNCTIONARY')`),
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
