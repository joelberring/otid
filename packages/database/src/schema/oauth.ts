import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { races } from "./core";
import { mapProjects } from "./map-projects";
import { bytea } from "./types";

/**
 * ADR-0219 (K2, migration 0093): AI-kopplingen. O-Tid är inloggningsserver (OAuth 2.1 med PKCE och dynamisk registrering) och
 * MCP-server för Claude med personens eget konto. Koder och nycklar sparas bara som sha256.
 */
export const oauthClients = pgTable("oauth_client", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true })
}, table => [index("oauth_client_created_idx").on(table.createdAt)]);

export const oauthCodes = pgTable("oauth_code", {
  codeSha256: text("code_sha256").primaryKey(),
  clientId: text("client_id").notNull().references(() => oauthClients.id),
  accountId: uuid("account_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  resource: text("resource"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true })
}, table => [index("oauth_code_account_idx").on(table.accountId), index("oauth_code_expires_idx").on(table.expiresAt)]);

export const oauthGrants = pgTable("oauth_grant", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull(),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  scope: text("scope").notNull(),
  resource: text("resource"),
  accessSha256: text("access_sha256").notNull().unique("oauth_grant_access_key"),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
  refreshSha256: text("refresh_sha256").notNull().unique("oauth_grant_refresh_key"),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
  previousRefreshSha256: text("previous_refresh_sha256"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
}, table => [index("oauth_grant_account_idx").on(table.accountId, table.createdAt.desc()),
  index("oauth_grant_refresh_expires_idx").on(table.refreshExpiresAt),
  index("oauth_grant_previous_refresh_idx").on(table.previousRefreshSha256).where(sql`previous_refresh_sha256 IS NOT NULL`)]);

export type MapProjectJobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

/** Kartjobben (läsa, rita, lista, kontrollera) som utskriftsarbetaren gör åt AI-kopplingen. */
export const mapProjectJobs = pgTable("map_project_job", {
  id: uuid("id").primaryKey(),
  /** Kartprojektet, eller (migration 0101) tävlingen när jobbet gäller banläggningen; precis en av dem. */
  projectId: uuid("project_id").references(() => mapProjects.id),
  raceId: uuid("race_id").references(() => races.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull(),
  kind: text("kind").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<MapProjectJobStatus>().notNull().default("QUEUED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  worker: text("worker"),
  error: text("error"),
  result: jsonb("result").$type<unknown>(),
  image: bytea("image")
}, table => [index("map_project_job_queue_idx").on(table.status, table.createdAt),
  index("map_project_job_account_idx").on(table.accountId, table.createdAt.desc()), index("map_project_job_project_idx").on(table.projectId)]);
