import { bigint, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userAccounts } from "./accounts";
import { clubMapVersions, clubs } from "./clubs";
import { races } from "./core";
import { mapContents } from "./map-content";
import { bytea } from "./types";

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
export type MapProjectProposalSource = "PERSON" | "AI" | "IMPORT" | "GENERALIZE" | "PROCESS";
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
  mode: text("mode").$type<MapProjectMode>(),
  /** En ny kartas område (0092): ringar av punkter i kartans mm, y uppåt; null för en befintlig karta. */
  area: jsonb("area").$type<{ x: number; y: number }[][]>(),
  /** Rekningens inställningar (0094, `ReconSettings` i map-revision); null = förvalen. */
  recon: jsonb("recon").$type<unknown>(),
  /** Topplistan (0096): null = av, annars hur namnen visas. */
  leaderboard: text("leaderboard").$type<"FIRST" | "FULL" | "NONE">(),
  /** Ändrade färger i kartans färgtabell (0112): färgens id i grundfilen och ny CMYK (0–1); null = filens egna. */
  colors: jsonb("colors").$type<{ id: number; cmyk: { c: number; m: number; y: number; k: number } }[]>(),
  colorsChangedAt: timestamp("colors_changed_at", { withTimezone: true }),
  /** Symbolernas färger (0120): symbolens nummer i filen, färgen i grundfilen (`from`) och kartfärgen den ritas med (`to`); null = symbolernas egna. */
  symbolColors: jsonb("symbol_colors").$type<{ symbol: string; from: number; to: number }[]>(),
  /** Vad AI-kopplingen får göra (0116): READ, PROPOSE (förval) eller AUTONOMOUS. */
  aiMode: text("ai_mode").$type<"READ" | "PROPOSE" | "AUTONOMOUS">().notNull().default("PROPOSE"),
  /** När projektet senast användes av någon med behörighet (0119, högst en skrivning i timmen); null = inte sedan kolumnen kom till. */
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true })
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

/**
 * Migration 0121: länk för att gå med i ett kartprojekt utan e-postadress (ägaren 2026-11-13). Bara hashen av nyckeln sparas.
 * Länken ger rollen `role` åt var och en som öppnar den inloggad, tills den går ut (`expiresAt`) eller tas bort (`revokedAt`).
 * Avsändaren har ingen främmande nyckel (som `invitation_link.issued_by`).
 */
export const mapProjectJoinLinks = pgTable("map_project_join_link", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  tokenHash: text("token_hash").notNull(),
  role: text("role").$type<MapProjectRole>().notNull(),
  issuedBy: uuid("issued_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
}, table => [
  uniqueIndex("map_project_join_link_token_hash_key").on(table.tokenHash),
  index("map_project_join_link_project_idx").on(table.projectId, table.createdAt)
]);

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
  /** Etappens revideringsdatum (0098, `YYYY-MM-DD`), null = inte reviderad. */
  revisedOn: date("revised_on", { mode: "string" }),
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

/** GPS-spår (0094): från fältläget (`FIELD`) eller en GPX-fil (`GPX`); syns bara för projektets medlemmar. Kontot har ingen nyckel. */
export const mapProjectTracks = pgTable("map_project_track", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  accountId: uuid("account_id").notNull(),
  name: text("name").notNull(),
  source: text("source").$type<"FIELD" | "GPX">().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  pointCount: integer("point_count").notNull().default(0),
  lengthM: doublePrecision("length_m").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

/** Spårets punkter i delar (0094): [lat, lon, sekunder från start, noggrannhet i meter]. */
export const mapProjectTrackParts = pgTable("map_project_track_part", {
  trackId: uuid("track_id").notNull().references(() => mapProjectTracks.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  points: jsonb("points").$type<[number, number, number, number][]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, table => [primaryKey({ columns: [table.trackId, table.seq] })]);

/** Bekräftade objekt (0094): gäller så länge objektets senaste ändring är `basisEditId` (null = grundfilens objekt). */
export const mapProjectChecks = pgTable("map_project_check", {
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  objectKey: text("object_key").notNull(),
  accountId: uuid("account_id").notNull(),
  basisEditId: uuid("basis_edit_id"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull()
}, table => [primaryKey({ columns: [table.projectId, table.objectKey] })]);

/** Notiser (0095): en punkt med text och valfritt foto, valfritt knuten till ett objekt; id:t skapas i telefonen. */
export const mapProjectNotes = pgTable("map_project_note", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  accountId: uuid("account_id").notNull(),
  atX: doublePrecision("at_x").notNull(),
  atY: doublePrecision("at_y").notNull(),
  objectKey: text("object_key"),
  text: text("text").notNull(),
  photo: bytea("photo"),
  photoMediaType: text("photo_media_type"),
  status: text("status").$type<"OPEN" | "DONE">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by")
});

/** Arbetslager och skisslager (0107, ägaren 2026-11-09): normens symboler i egna grupper, och skisser som inte hör till kartan. */
export const mapProjectWorkLayers = pgTable("map_project_work_layer", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  kind: text("kind").$type<"SYMBOLS" | "SKETCH">().notNull(),
  name: text("name").notNull(),
  codes: jsonb("codes").$type<string[]>().notNull().default([]),
  color: text("color").notNull().default("#c0262d"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, table => [index("map_project_work_layer_project_idx").on(table.projectId, table.createdAt)]);

export const mapProjectSketches = pgTable("map_project_sketch", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  layerId: uuid("layer_id").notNull().references(() => mapProjectWorkLayers.id),
  accountId: uuid("account_id").notNull(),
  kind: text("kind").$type<"LINE" | "POINT" | "TEXT">().notNull(),
  points: jsonb("points").$type<[number, number][]>().notNull(),
  text: text("text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, table => [index("map_project_sketch_layer_idx").on(table.layerId, table.createdAt), index("map_project_sketch_project_idx").on(table.projectId)]);

/** Personen vill synas i kartprojektens topplistor (0096). */
export const mapStatsOptIns = pgTable("map_stats_opt_in", {
  accountId: uuid("account_id").primaryKey().references(() => userAccounts.id),
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull()
});

/** Underlag (0097): en georefererad bild (pixel → koordinatsystemets enheter, världsfilens sex tal) i kartinnehållet. */
export const mapProjectLayers = pgTable("map_project_layer", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  name: text("name").notNull(),
  contentSha256: text("content_sha256").notNull().references(() => mapContents.sha256),
  mediaType: text("media_type").$type<"image/png" | "image/jpeg" | "image/webp">().notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  crs: integer("crs").notNull(),
  transform: jsonb("transform").$type<{ a: number; b: number; c: number; d: number; e: number; f: number }>().notNull(),
  opacity: real("opacity").notNull().default(0.5),
  sort: integer("sort").notNull().default(0),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  requestId: uuid("request_id").notNull()
});

/**
 * K4c (migration 0100): kontots egna uppgifter till en kartkälla (Lantmäteriet), bara krypterade. `BASIC` = Geotorgets
 * användarnamn och lösenord, `OAUTH2` = API-portalens nyckel och hemlighet (organisationens systemkonto).
 */
export const mapSourceCredentials = pgTable("map_source_credential", {
  accountId: uuid("account_id").notNull().references(() => userAccounts.id),
  provider: text("provider").$type<"LANTMATERIET">().notNull(),
  method: text("method").$type<"BASIC" | "OAUTH2">().notNull(),
  keyId: text("key_id").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  ciphertext: text("ciphertext").notNull(),
  hint: text("hint").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
}, table => [primaryKey({ columns: [table.accountId, table.provider] })]);

export type GeoJobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
/** K5 (migration 0103): geo-arbetarens jobb (Karttapullautin på laserdata), körs av en egen geo-server över HTTPS. */
export const mapProjectGeoJobs = pgTable("map_project_geo_job", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"PULLAUTIN" | "DWG">().notNull(),
  status: text("status").$type<GeoJobStatus>().notNull(),
  request: jsonb("request").$type<Record<string, unknown>>().notNull(),
  progress: jsonb("progress").$type<Record<string, unknown>>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  worker: text("worker"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  requestId: uuid("request_id").notNull().unique()
}, table => [index("map_project_geo_job_queue_idx").on(table.status, table.createdAt),
  index("map_project_geo_job_project_idx").on(table.projectId, table.createdAt)]);

/** Geo-jobbets resultatfiler i kartinnehållet (tas bort med jobbet). */
export const mapProjectGeoOutputs = pgTable("map_project_geo_output", {
  jobId: uuid("job_id").notNull().references(() => mapProjectGeoJobs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contentSha256: text("content_sha256").notNull().references(() => mapContents.sha256),
  mediaType: text("media_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
}, table => [primaryKey({ columns: [table.jobId, table.name] }), index("map_project_geo_output_content_idx").on(table.contentSha256)]);

/** K5b (migration 0104): geo-servrarna som O-Tid skapat hos Hetzner (även raderade, för månadens kostnad). */
export const geoServers = pgTable("geo_server", {
  id: uuid("id").primaryKey(),
  providerId: bigint("provider_id", { mode: "number" }),
  name: text("name").notNull().unique(),
  serverType: text("server_type").notNull(),
  location: text("location").notNull(),
  hourlyEur: doublePrecision("hourly_eur").notNull(),
  tokenSha256: text("token_sha256").notNull().unique(),
  status: text("status").$type<"STARTING" | "READY" | "DELETED">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastJobAt: timestamp("last_job_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deleteReason: text("delete_reason")
});

/** K5b: geo-serverns läge som användarna ser och när ägaren senast fick mejl (nyckel → värde). */
export const geoServerStates = pgTable("geo_server_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

/** K6b (migration 0105): lagermappningsprofiler (lager → symbolnummer), per konto och valfritt delade med en klubb. */
export const mapLayerProfiles = pgTable("map_layer_profile", {
  id: uuid("id").primaryKey(),
  accountId: uuid("account_id").notNull().references(() => userAccounts.id, { onDelete: "cascade" }),
  clubId: uuid("club_id").references(() => clubs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rules: jsonb("rules").$type<{ layer: string; code: string; kind: "point" | "line" | "area" }[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  requestId: uuid("request_id").notNull().unique()
});

/**
 * Ägarens plan 2026-11-13, etapp 1 (migration 0117): banläggningens karta ur ett kartprojekt. Tävlingens kartfil
 * (`race_map_source`) är en ögonblicksbild av projektet vid löpnumret `seq`; kopplingen gäller så länge `sha256` är tävlingens
 * kartfil. `colorsChangedAt` = projektets färgändring som bilden har med (färger har inget löpnummer).
 */
export const raceMapProjectLinks = pgTable("race_map_project_link", {
  raceId: uuid("race_id").primaryKey().references(() => races.id),
  projectId: uuid("project_id").notNull().references(() => mapProjects.id),
  seq: bigint("seq", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  colorsChangedAt: timestamp("colors_changed_at", { withTimezone: true }),
  linkedBy: uuid("linked_by").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull()
}, table => [index("race_map_project_link_project_idx").on(table.projectId)]);
