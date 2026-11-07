import { bigint, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { userAccounts } from "./accounts";
import { clubMapVersions, clubs } from "./clubs";
import { mapContents } from "./map-content";

/**
 * ADR-0219 (migration 0089, 0090): kartprojekten. Ett projekt ägs av sina medlemmar; klubben är valfri. Grundfilen är en kartversion i
 * klubbarkivet, en egen uppladdad fil eller en ny karta. Ändringarna lagras per objekt
 * (`map_project_object`) med en logg över varje ändring som kom fram (`map_project_edit`). Författare och avsändare har ingen
 * främmande nyckel; medlemskap och tagna inbjudningar har den och försvinner med kontot.
 *
 * Rollerna och lägena bestäms i koden (`mapProjectRoleSchema` i contracts; ändringarnas slag `EDIT_KINDS` i map-revision);
 * databasen kräver bara formen, som spärrtyperna i 0087.
 */
/** Lagrade roller; i UI Ägare, Ändra, Föreslå och Läsa (Föreslå sedan K1, ingen migration). */
export type MapProjectRole = "OWNER" | "EDIT" | "SUGGEST" | "READ";
/** Arbetssätten (0091): Gemensamt och Huvudkartritare; null i kolumnen = Gemensamt. */
export type MapProjectMode = "SHARED" | "LEAD";
export type MapProjectAreaStatus = "BASE" | "DRAFTED" | "SURVEYED" | "DONE";
export type MapProjectProposalStatus = "OPEN" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
export type MapProjectProposalSource = "PERSON" | "AI";
export type MapProjectStatus = "OPEN" | "CLOSED";
export type MapProjectEditStatus = "APPLIED" | "CONFLICT";

export const mapProjects = pgTable("map_project", {
  id: uuid("id").primaryKey(),
  /** Klubben projektet hör till (valfri sedan 0090): dess administratörer räknas som ägare och kan lägga resultat i arkivet. */
  clubId: uuid("club_id").references(() => clubs.id),
  name: text("name").notNull(),
  /** Kartversionen i klubbarkivet som projektet utgår från; null för en egen uppladdad fil eller en ny karta (0090). */
  baseVersionId: uuid("base_version_id").references(() => clubMapVersions.id),
  /** Grundfilens namn när den inte kommer från arkivet (0090). */
  baseFileName: text("base_file_name"),
  /** Var grundfilen kom ifrån; null = kartversion i arkivet (rader från 0089). */
  baseSource: text("base_source").$type<"ARCHIVE" | "UPLOAD" | "NEW">(),
  baseSha256: text("base_sha256").notNull().references(() => mapContents.sha256),
  baseFormat: text("base_format").$type<"OCD" | "OMAP">().notNull(),
  readerVersion: integer("reader_version").notNull(),
  status: text("status").$type<MapProjectStatus>().notNull(),
  seq: bigint("seq", { mode: "number" }).notNull().default(0),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  closedBy: uuid("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  requestId: uuid("request_id").notNull(),
  /** Arbetssättet (0091); null = Gemensamt. */
  mode: text("mode").$type<MapProjectMode>()
});

export const mapProjectMembers = pgTable("map_project_member", {
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  role: text("role").$type<MapProjectRole>().notNull(),
  addedBy: uuid("added_by").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
}, table => [primaryKey({ columns: [table.projectId, table.accountId] })]);

export const mapProjectInvitations = pgTable("map_project_invitation", {
  id: uuid("id").primaryKey(),
  requestId: uuid("request_id").notNull(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  email: text("email").notNull(),
  role: text("role").$type<MapProjectRole>().notNull(),
  actorAccountId: uuid("actor_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedAccountId: uuid("accepted_account_id").references(() => userAccounts.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
});

export const mapProjectObjects = pgTable("map_project_object", {
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  objectKey: text("object_key").notNull(),
  ref: jsonb("ref").$type<unknown>(),
  state: jsonb("state").$type<unknown>().notNull(),
  lastEditId: uuid("last_edit_id").notNull(),
  version: integer("version").notNull(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  authorAccountId: uuid("author_account_id").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull()
}, table => [primaryKey({ columns: [table.projectId, table.objectKey] })]);

export const mapProjectEdits = pgTable("map_project_edit", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  editId: uuid("edit_id").notNull(),
  objectKey: text("object_key").notNull(),
  baseEditId: uuid("base_edit_id"),
  kind: text("kind").notNull(),
  status: text("status").$type<MapProjectEditStatus>().notNull(),
  state: jsonb("state").$type<unknown>().notNull(),
  seq: bigint("seq", { mode: "number" }),
  authorAccountId: uuid("author_account_id").notNull(),
  clientId: text("client_id").notNull(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  /** Förslaget ändringen kom genom och ägaren som godkände det (0091); `authorAccountId` är den som föreslog. */
  proposalId: uuid("proposal_id").references(() => mapProjectProposals.id),
  acceptedBy: uuid("accepted_by")
});

/**
 * Delområden (0091): polygon i kartans mm med y uppåt. Den som fått området har ingen främmande nyckel; den nollställs i koden när
 * kontot tas bort eller personen tas bort ur projektet.
 */
export const mapProjectAreas = pgTable("map_project_area", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  name: text("name").notNull(),
  polygon: jsonb("polygon").$type<{ x: number; y: number }[][]>().notNull(),
  assigneeAccountId: uuid("assignee_account_id"),
  status: text("status").$type<MapProjectAreaStatus>().notNull(),
  sort: integer("sort").notNull().default(0),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  requestId: uuid("request_id").notNull()
});

/** Förslag (0091): en grupp ändringar som en ägare godkänner eller avvisar; författaren och den som avgjorde har ingen nyckel. */
export const mapProjectProposals = pgTable("map_project_proposal", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  requestId: uuid("request_id").notNull(),
  authorAccountId: uuid("author_account_id").notNull(),
  source: text("source").$type<MapProjectProposalSource>().notNull(),
  note: text("note"),
  status: text("status").$type<MapProjectProposalStatus>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note")
});

export const mapProjectProposalEdits = pgTable("map_project_proposal_edit", {
  proposalId: uuid("proposal_id").notNull().references(() => mapProjectProposals.id),
  position: integer("position").notNull(),
  editId: uuid("edit_id").notNull(),
  objectKey: text("object_key").notNull(),
  ref: jsonb("ref").$type<unknown>(),
  baseEditId: uuid("base_edit_id"),
  kind: text("kind").notNull(),
  state: jsonb("state").$type<unknown>().notNull(),
  point: jsonb("point").$type<{ x: number; y: number }>(),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
  outcome: text("outcome").$type<"APPLIED" | "CONFLICT">()
}, table => [primaryKey({ columns: [table.proposalId, table.position] })]);

export const mapProjectOutputs = pgTable("map_project_output", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  /** Kartversionen i klubbarkivet när resultatet också lades där. */
  versionId: uuid("version_id").references(() => clubMapVersions.id),
  /** Resultatets innehåll och filnamn i projektet (0090; äldre rader har bara kartversionen). */
  contentSha256: text("content_sha256").references(() => mapContents.sha256),
  fileName: text("file_name"),
  seq: bigint("seq", { mode: "number" }).notNull(),
  changes: integer("changes").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  requestId: uuid("request_id").notNull()
});
