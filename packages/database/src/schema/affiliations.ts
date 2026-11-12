import { boolean, date, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userAccounts } from "./accounts";
import { clubs } from "./clubs";
import { races } from "./core";

/**
 * ADR-0209 (migration 0076): klubbtillhörighet. Klubblistan från Eventor, kontots klubbar, klubbarkivets koppling till
 * klubben i listan, tävlingens arrangörsklubb, tävlingar i klubbarkivet och inbjudningar "Från klubben".
 */
export type OrganisationType = "FEDERATION" | "DISTRICT" | "CLUB" | "OTHER";
export type AccountClubMembershipStatus = "PENDING" | "CONFIRMED" | "DECLINED";
export type InvitationClubSourceKind = "RACE_PERSON" | "CLUB" | "TRAINING_GROUP";

export const organisations = pgTable("organisation", {
  id: uuid("id").primaryKey(),
  eventorId: text("eventor_id").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  type: text("type").$type<OrganisationType>().notNull(),
  parentEventorId: text("parent_eventor_id"),
  country: text("country"),
  searchText: text("search_text").notNull(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const organisationRefreshes = pgTable("organisation_refresh", {
  id: uuid("id").primaryKey(),
  source: text("source").$type<"EVENTOR" | "FILE">().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  organisations: integer("organisations").notNull(),
  added: integer("added").notNull(),
  changed: integer("changed").notNull(),
  removed: integer("removed").notNull()
});

export const accountClubMemberships = pgTable("account_club_membership", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  organisationId: uuid("organisation_id").references(() => organisations.id),
  freeText: text("free_text"),
  clubId: uuid("club_id").references(() => clubs.id),
  status: text("status").$type<AccountClubMembershipStatus>().notNull(),
  origin: text("origin").$type<"ACCOUNT" | "EVENTOR">().notNull().default("ACCOUNT"),
  confirmedVia: text("confirmed_via").$type<"MANUAL" | "EVENTOR">(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  /** Vem i klubbarkivet som bekräftade eller avböjde, och när (confirmedBy/At när status är CONFIRMED). */
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true })
});

export const accountClubPrompts = pgTable("account_club_prompt", {
  accountId: uuid("account_id").primaryKey().references(() => userAccounts.id),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull()
});

export type ClubAreaAccess = "MEMBERS" | "LEADERS";

/** Klubbarkivets inställningar: kopplingen till Eventor (krypterad klubbnyckel) och "Vem ser vad". Utan rad gäller förvalen. */
export const clubSettings = pgTable("club_setting", {
  clubId: uuid("club_id").primaryKey().references(() => clubs.id),
  organisationId: uuid("organisation_id").references(() => organisations.id),
  eventorKeyId: text("eventor_key_id"),
  eventorKeyIv: text("eventor_key_iv"),
  eventorKeyTag: text("eventor_key_tag"),
  eventorKeyCiphertext: text("eventor_key_ciphertext"),
  eventorKeyHint: text("eventor_key_hint"),
  linkedBy: uuid("linked_by"),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  archiveVisibility: text("archive_visibility").$type<ClubAreaAccess>().notNull().default("MEMBERS"),
  mapBankAccess: text("map_bank_access").$type<ClubAreaAccess>().notNull().default("MEMBERS"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

/** Medlemslistan i Eventor: bara person-id och HMAC av e-postadressen. */
export const clubEventorMembers = pgTable("club_eventor_member", {
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  emailHmac: text("email_hmac").notNull(),
  eventorPersonId: text("eventor_person_id").notNull(),
  keyId: text("key_id").notNull()
}, (table) => [primaryKey({ columns: [table.clubId, table.emailHmac] })]);

export const clubEventorSyncs = pgTable("club_eventor_sync", {
  clubId: uuid("club_id").primaryKey().references(() => clubs.id),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  members: integer("members").notNull().default(0),
  problem: text("problem")
});

export const raceOrganisers = pgTable("race_organiser", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
  setBy: uuid("set_by").notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).notNull()
});

export const raceClubArchives = pgTable("race_club_archive", {
  id: uuid("id").primaryKey(),
  raceId: uuid("race_id").notNull(),
  clubId: uuid("club_id").notNull().references(() => clubs.id),
  entryId: uuid("entry_id").notNull(),
  createdMapId: uuid("created_map_id"),
  createdVersionId: uuid("created_version_id"),
  raceName: text("race_name").notNull(),
  raceDate: date("race_date").notNull(),
  liftedBy: uuid("lifted_by").notNull(),
  liftedAt: timestamp("lifted_at", { withTimezone: true }).notNull()
});

/**
 * Ägaren 2026-11-12 (migration 0113): "Lägg i klubbarkivet när träningen är klar". `enabled` null = förvalet; `archivedAt`
 * spärrar en ny automatisk arkivering (också efter Ta ur); `problem` = varför den automatiska inte gick.
 */
export type RaceClubArchiveAutoProblem = "NO_ADMIN" | "FAILED";

export const raceClubArchiveAutos = pgTable("race_club_archive_auto", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  enabled: boolean("enabled"),
  setBy: uuid("set_by"),
  setAt: timestamp("set_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  problem: text("problem").$type<RaceClubArchiveAutoProblem>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const invitationClubSources = pgTable("invitation_club_source", {
  id: uuid("id").primaryKey(),
  kind: text("kind").$type<InvitationClubSourceKind>().notNull(),
  invitationId: uuid("invitation_id").notNull(),
  contextId: uuid("context_id").notNull(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});
