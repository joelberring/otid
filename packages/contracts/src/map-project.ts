import { z } from "zod";
import { accountEmailSchema } from "./account";
import { uuidSchema } from "./ids";
import { mapProjectLeaderboardSchema, mapProjectReconSettingsSchema, type MapProjectReconSettings } from "./map-project-recon";

/**
 * ADR-0219: kartprojekten. Skrivningar som skapar en rad är idempotenta på `requestId`. Synkens ändringar valideras i
 * `@o-tid/map-revision` (`editProblem`); här är de bara en lista med en övre gräns.
 */
/**
 * Lagrade roller; i UI Ägare, Ändra, Föreslå och Läsa (docs/domain-rules.md, Ordlista). Rangordning READ < SUGGEST < EDIT < OWNER
 * (`mapProjectRoleAtLeast` i application). Föreslå ritar men allt blir förslag (K1).
 */
export const mapProjectRoleSchema = z.enum(["OWNER", "EDIT", "SUGGEST", "READ"]);
/** Arbetssätten (K1): Gemensamt (`SHARED`, alla med Ändra ritar direkt) och Huvudkartritare (`LEAD`, ägarna ritar direkt). */
export const mapProjectModeSchema = z.enum(["SHARED", "LEAD"]);
/** Delområdets status: underlag, grundritat, rekat, klart. */
export const mapProjectAreaStatusSchema = z.enum(["BASE", "DRAFTED", "SURVEYED", "DONE"]);
export const mapProjectNoteSchema = z.string().trim().max(500);
export const mapProjectNameSchema = z.string().trim().min(1).max(120);
/** Så många ändringar skickas i en omgång (samma som klientens `nextBatch`). */
export const MAP_PROJECT_SYNC_MAX_EDITS = 200;
/** En omgångs kropp får vara högst så här stor. */
export const MAP_PROJECT_SYNC_MAX_BYTES = 4 * 1024 * 1024;

/** Nytt projekt från en kartversion i klubbarkivet (alla som får läsa arkivet; projektet hör till klubben). */
export const mapProjectCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, clubId: uuidSchema, baseVersionId: uuidSchema, name: mapProjectNameSchema
}).strict();

export const mapProjectFileNameSchema = z.string().trim().min(1).max(200);

/**
 * Nytt projekt från en egen kartfil (alla inloggade, ingen klubb; rättelsen av ADR-0219 2026-11-07). Filen är kroppen
 * (`application/octet-stream`) och uppgifterna står i rubrikerna `x-otid-request-id`, `x-otid-name` och `x-otid-file-name`
 * (procentkodade), som klubbarkivets uppladdning.
 */
export const mapProjectUploadMetadataSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, name: mapProjectNameSchema, fileName: mapProjectFileNameSchema
}).strict();

/** Normerna för nya kartor (O-Tids symbolset) och deras skalor. */
export const MAP_PROJECT_NEW_SCALES = { "ISOM2017-2": [15000, 10000], "ISSPROM2019-2": [4000, 3000] } as const;
/** En ny kartas område får vara högst så här stort (meter per sida av omslutande rektangel). */
export const MAP_PROJECT_NEW_MAX_SIDE_M = 15000;

const finite = z.number().finite();
/**
 * Kartans område som polygon: ringar av [x, y] (första ringen ytterkant, resten hål), i WGS 84 som [longitud, latitud]
 * (GeoJSON) eller i SWEREF 99 TM som [östlig, nordlig] meter.
 */
export const mapProjectAreaInputSchema = z.object({
  crs: z.enum(["WGS84", "SWEREF99TM"]),
  rings: z.array(z.array(z.tuple([finite, finite])).min(3).max(2000)).min(1).max(20)
}).strict();

/**
 * Nytt projekt med en ny tom karta (K1, alla inloggade, ingen klubb): O-Tids symbolset för normen, skalan, kartans
 * område och den magnetiska missvisningen (grader, östlig positiv; kartan vrids mot magnetisk nord).
 */
export const mapProjectNewRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, name: mapProjectNameSchema,
  symbolSet: z.enum(["ISOM2017-2", "ISSPROM2019-2"]), scale: z.number().int(),
  declination: z.number().finite().min(-30).max(30).optional(),
  area: mapProjectAreaInputSchema
}).strict().refine(value => (MAP_PROJECT_NEW_SCALES[value.symbolSet] as readonly number[]).includes(value.scale), { path: ["scale"] });

/** Byt namn, avsluta (`CLOSED`) eller öppna igen (`OPEN`), eller byt arbetssätt (`mode`, K1). */
export const mapProjectUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), name: mapProjectNameSchema.optional(), status: z.enum(["OPEN", "CLOSED"]).optional(),
  mode: mapProjectModeSchema.optional(),
  /** Rekningens inställningar (K3); null = förvalen. */
  recon: mapProjectReconSettingsSchema.nullable().optional(),
  /** Topplistan (K3b): null = av. */
  leaderboard: mapProjectLeaderboardSchema.nullable().optional()
}).strict().refine(value => value.name !== undefined || value.status !== undefined || value.mode !== undefined || value.recon !== undefined
  || value.leaderboard !== undefined);

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

/**
 * Delområde (K1): polygonen är ringar av punkter i kartans mm med y uppåt, första ringen ytterkant. Formen (1–20 ringar,
 * 3–2000 ändliga punkter) prövas också i `areaPolygonProblem` i map-revision. Skapa och ändra: projektets ägare; den som fått
 * området får ändra bara dess status.
 */
const areaPointSchema = z.object({ x: z.number().finite().min(-5_000_000).max(5_000_000), y: z.number().finite().min(-5_000_000).max(5_000_000) })
  .strict();
/** Kroppen när ett delområde skapas eller ändras får vara högst så här stor (20 ringar × 2000 punkter). */
export const MAP_PROJECT_AREA_MAX_BYTES = 2 * 1024 * 1024;
export const mapProjectAreaPolygonSchema = z.array(z.array(areaPointSchema).min(3).max(2000)).min(1).max(20);
export const mapProjectAreaNameSchema = z.string().trim().min(1).max(80);
/** Etappens revideringsdatum (`YYYY-MM-DD`, ett riktigt datum mellan 1900 och 2200), null tar bort det. */
export const mapProjectAreaRevisedOnSchema = z.string().regex(/^(19|20|21)\d{2}-\d{2}-\d{2}$/)
  .refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)).nullable();
export const mapProjectAreaCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, name: mapProjectAreaNameSchema, polygon: mapProjectAreaPolygonSchema,
  assigneeAccountId: uuidSchema.nullable().optional(), status: mapProjectAreaStatusSchema.optional(), sort: z.number().int().min(0).max(100_000).optional()
}).strict();
export const mapProjectAreaUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), name: mapProjectAreaNameSchema.optional(), polygon: mapProjectAreaPolygonSchema.optional(),
  assigneeAccountId: uuidSchema.nullable().optional(), status: mapProjectAreaStatusSchema.optional(), sort: z.number().int().min(0).max(100_000).optional(),
  revisedOn: mapProjectAreaRevisedOnSchema.optional()
}).strict().refine(value => Object.keys(value).length > 1);

/**
 * Ett förslag med en kort anteckning (Föreslå eller mer; AI i K2). Ändringarna prövas som i synken (`editProblem`). Idempotent på
 * `requestId`.
 */
export const mapProjectProposalCreateRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, note: mapProjectNoteSchema.optional(),
  /** K4b: kandidater ur en vektorfil (förval PERSON); K6: generaliseringen; K6b: kartan rättad med passpunkter (PROCESS). */
  source: z.enum(["PERSON", "IMPORT", "GENERALIZE", "PROCESS"]).optional(),
  edits: z.array(z.unknown()).min(1).max(MAP_PROJECT_SYNC_MAX_EDITS)
}).strict();
/** Godkänn eller avvisa (ägarna), dra tillbaka (den som föreslog, medan förslaget är öppet). */
export const mapProjectProposalDecisionRequestSchema = z.object({
  formatVersion: z.literal(1), action: z.enum(["ACCEPT", "REJECT", "WITHDRAW"]), note: mapProjectNoteSchema.optional()
}).strict();

/**
 * "Skapa ny kartversion" ur ändringarna (projektets ägare). Versionen sparas alltid i projektet; `archive` lägger den dessutom
 * i klubbarkivet (bara när projektet hör till en klubb och den som skriver är administratör där).
 */
export const mapProjectOutputRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, note: z.string().trim().max(500).optional(), archive: z.boolean().optional()
}).strict();

export type MapProjectRole = z.infer<typeof mapProjectRoleSchema>;
export type MapProjectMode = z.infer<typeof mapProjectModeSchema>;
export type MapProjectAreaStatus = z.infer<typeof mapProjectAreaStatusSchema>;
export type MapProjectStatus = "OPEN" | "CLOSED";
export type MapProjectProposalStatus = "OPEN" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
/** Vem som skapade förslaget: en person (i ritningen eller uttryckligen) eller AI (Claude via MCP, K2). */
/** `IMPORT` (K4b): kandidater ur en vektorfil som en person lämnat; räknas inte i statistiken som personens. */
export type MapProjectProposalSource = "PERSON" | "AI" | "IMPORT" | "GENERALIZE" | "PROCESS";

export interface MapProjectAreaView {
  areaId: string; name: string;
  /** Ringar av punkter i kartans mm med y uppåt; första ringen ytterkant. */
  polygon: { x: number; y: number }[][];
  /** Den som fått området (null = inte utdelat). Namnet är null om kontot inte längre är medlem. */
  assignee: { accountId: string; name: string | null } | null;
  status: MapProjectAreaStatus; sort: number; createdAt: string; updatedAt: string;
  /** Etappens revideringsdatum (`YYYY-MM-DD`) eller null (0098). */
  revisedOn: string | null;
}

export interface MapProjectProposalEditView {
  editId: string; key: string; ref: unknown; base: string | null; kind: string; state: unknown; at: string;
  /** Ändringens valfria punkt (kartans mm). */
  point: { x: number; y: number } | null;
  /** Utfallet när förslaget godkänts: gjord eller krock (grunden stämde inte längre); null innan. */
  outcome: "APPLIED" | "CONFLICT" | null;
}

export interface MapProjectProposalView {
  proposalId: string; source: MapProjectProposalSource; status: MapProjectProposalStatus; note: string | null;
  /** Namnet är null när kontot har tagits bort. */
  author: { accountId: string; name: string | null };
  createdAt: string;
  decidedBy: { accountId: string; name: string | null } | null;
  decidedAt: string | null; decisionNote: string | null;
  edits: MapProjectProposalEditView[];
}

/** Förslagen: öppna först (äldsta först), sedan de senast avgjorda. */
export interface MapProjectProposalList { formatVersion: 1; proposals: MapProjectProposalView[] }
export interface MapProjectAreaList { formatVersion: 1; areas: MapProjectAreaView[] }

/** Var grundfilen kommer ifrån: en kartversion i klubbarkivet, en egen uppladdad fil eller en ny karta (K1). */
export type MapProjectBaseSource = "ARCHIVE" | "UPLOAD" | "NEW";

export interface MapProjectBase {
  source: MapProjectBaseSource;
  /** Kartversionen och kartan i klubbarkivet (null när grundfilen inte kommer därifrån). */
  versionId: string | null; mapId: string | null;
  /** Kartans namn i arkivet, annars projektets namn. */
  mapName: string; fileName: string; format: "OCD" | "OMAP"; versionDate: string | null; sha256: string;
}

export interface MapProjectOutputView {
  outputId: string;
  /** Kartversionen i klubbarkivet när resultatet också lades där. */
  versionId: string | null;
  fileName: string; changes: number; createdAt: string;
}

export interface MapProjectSummary {
  projectId: string; name: string; status: MapProjectStatus;
  /** Kontots roll i projektet (klubbens administratörer och ägare räknas som ägare). */
  role: MapProjectRole;
  /** Klubben projektet hör till (null för ett eget projekt). */
  club: { clubId: string; name: string } | null;
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
  /**
   * `canWriteVersion` = får skapa en ny version i projektet (ägarna); `canArchive` = får också lägga den i klubbarkivet
   * (projektet hör till en klubb och kontot är administratör där).
   */
  viewer: { accountId: string; canEdit: boolean; canManage: boolean; canWriteVersion: boolean; canArchive: boolean;
    /** Får rita förslag (Föreslå eller mer, projektet öppet). */
    canPropose: boolean;
    /** Får godkänna och avvisa förslag, byta arbetssätt och hantera delområden (ägarna). */
    canDecide: boolean };
  /** Arbetssättet (K1). */
  mode: MapProjectMode;
  /** Kartans område för en ny karta (kartans mm, y uppåt, första ringen ytterkant); null för en befintlig karta. */
  area: { x: number; y: number }[][] | null;
  /** Rekningens inställningar (K3); null = förvalen. */
  recon: MapProjectReconSettings | null;
  /** Topplistan (K3b): null = av, annars hur namnen visas. */
  leaderboard: "FIRST" | "FULL" | "NONE" | null;
  areas: MapProjectAreaView[];
  /** Antalet öppna förslag. */
  openProposals: number;
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
 * `results` är tomt och klienten behåller sin kö. En ändring som blev ett förslag får `PROPOSED` med `proposalId` (alla i samma
 * anrop hamnar i samma förslag). `openProposals` = id:n för kontots egna öppna förslag; klienten tar bort de andra ur sin lista
 * (`keepOpenProposals`).
 */
export interface MapProjectSyncResponse {
  formatVersion: 1; seq: number; status: MapProjectStatus; results: unknown[]; objects: unknown[]; more: boolean; openProposals: string[];
}

export type MapProjectOutputResponse =
  | { formatVersion: 1; status: "created"; outputId: string; versionId: string | null; fileName: string; changes: number; added: number;
    modified: number; deleted: number }
  /** Inga ändringar att skriva. */
  | { formatVersion: 1; status: "empty" }
  /** Skrivaren vägrade (t.ex. OCAD före K7, ett objekt som inte längre stämmer). Ändringarna kan exporteras i stället. */
  | { formatVersion: 1; status: "refused"; refusals: { code: string; message: string }[] };
