import { z } from "zod";
import { accountEmailSchema } from "./account";
import { uuidSchema } from "./ids";

/**
 * ADR-0219: kartprojekten. Skrivningar som skapar en rad är idempotenta på `requestId`. Synkens ändringar valideras i
 * `@o-tid/map-revision` (`editProblem`); här är de bara en lista med en övre gräns.
 */
/** Lagrade roller; i UI Ägare, Ändra och Läsa (docs/domain-rules.md, Ordlista). Förslag (`SUGGEST`) kommer i K1. */
export const mapProjectRoleSchema = z.enum(["OWNER", "EDIT", "READ"]);
export const mapProjectNameSchema = z.string().trim().min(1).max(120);
/** Så många ändringar skickas i en omgång (samma som klientens `nextBatch`). */
export const MAP_PROJECT_SYNC_MAX_EDITS = 200;
/** En omgångs kropp får vara högst så här stor. */
export const MAP_PROJECT_SYNC_MAX_BYTES = 4 * 1024 * 1024;

export const mapProjectCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, clubId: uuidSchema, baseVersionId: uuidSchema, name: mapProjectNameSchema
}).strict();

/** Byt namn, avsluta (`CLOSED`) eller öppna igen (`OPEN`). */
export const mapProjectUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), name: mapProjectNameSchema.optional(), status: z.enum(["OPEN", "CLOSED"]).optional()
}).strict().refine(value => value.name !== undefined || value.status !== undefined);

export const mapProjectInviteRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, email: accountEmailSchema, role: mapProjectRoleSchema
}).strict();

export const mapProjectMemberRoleRequestSchema = z.object({ formatVersion: z.literal(1), accountId: uuidSchema, role: mapProjectRoleSchema }).strict();

export const mapProjectMemberRemoveRequestSchema = z.object({
  formatVersion: z.literal(1), accountId: uuidSchema.nullable(), invitationId: uuidSchema.nullable()
}).strict().refine(value => (value.accountId === null) !== (value.invitationId === null));

/** En omgång ändringar från en klient (telefon eller dator); `since` = högsta löpnumret klienten redan har. */
export const mapProjectSyncRequestSchema = z.object({
  formatVersion: z.literal(1),
  clientId: z.string().min(1).max(64),
  since: z.number().int().min(0),
  edits: z.array(z.unknown()).max(MAP_PROJECT_SYNC_MAX_EDITS)
}).strict();

/** "Skapa ny kartversion" ur ändringarna (bara projektets ägare som är administratör i klubben). */
export const mapProjectOutputRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, note: z.string().trim().max(500).optional()
}).strict();

export type MapProjectRole = z.infer<typeof mapProjectRoleSchema>;
export type MapProjectStatus = "OPEN" | "CLOSED";

export interface MapProjectBase {
  versionId: string; mapId: string; mapName: string; fileName: string; format: "OCD" | "OMAP"; versionDate: string | null; sha256: string;
}

export interface MapProjectOutputView { versionId: string; fileName: string; changes: number; createdAt: string }

export interface MapProjectSummary {
  projectId: string; name: string; status: MapProjectStatus;
  /** Kontots roll i projektet (klubbens administratörer och ägare räknas som ägare). */
  role: MapProjectRole;
  club: { clubId: string; name: string };
  base: MapProjectBase;
  createdAt: string; closedAt: string | null;
  /** Objekt som inte är som i grundfilen (nya som tagits bort igen räknas inte). */
  changedObjects: number;
  outputs: MapProjectOutputView[];
}

export interface MapProjectMemberView { accountId: string; name: string; role: MapProjectRole; lastSeenAt: string | null; edits: number }
export interface MapProjectInvitationView { invitationId: string; email: string; role: MapProjectRole; createdAt: string; sentAt: string | null }

export interface MapProjectView extends MapProjectSummary {
  formatVersion: 1;
  viewer: { accountId: string; canEdit: boolean; canManage: boolean; canWriteVersion: boolean };
  /** Läsarnas version när projektet startade; en annan version kan ge andra platser för objekten. */
  readerVersion: number;
  seq: number;
  members: MapProjectMemberView[];
  /** Öppna inbjudningar (bara för den som får hantera medlemmarna). */
  invitations: MapProjectInvitationView[];
  /** ADR-0206: e-post finns på servern. Sätts av webben. */
  mailEnabled?: boolean;
}

export interface MapProjectList { formatVersion: 1; projects: MapProjectSummary[] }

/**
 * Synkens svar: utfallet per ändring (`EditResult` i map-revision) och objekten (`ServerObject`) som ändrats sedan `since`.
 * `more` = det finns fler att hämta (fråga igen med `seq`). Ett avslutat projekt tar inte emot ändringar och kvitterar inga:
 * `results` är tomt och klienten behåller sin kö.
 */
export interface MapProjectSyncResponse {
  formatVersion: 1; seq: number; status: MapProjectStatus; results: unknown[]; objects: unknown[]; more: boolean;
}

export type MapProjectOutputResponse =
  | { formatVersion: 1; status: "created"; versionId: string; fileName: string; changes: number; added: number; modified: number; deleted: number }
  /** Inga ändringar att skriva. */
  | { formatVersion: 1; status: "empty" }
  /** Skrivaren vägrade (t.ex. OCAD före K7, ett objekt som inte längre stämmer). Ändringarna kan exporteras i stället. */
  | { formatVersion: 1; status: "refused"; refusals: { code: string; message: string }[] };
