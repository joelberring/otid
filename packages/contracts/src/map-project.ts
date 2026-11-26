import { z } from "zod";
import { accountEmailSchema } from "./account";
import { uuidSchema } from "./ids";
import type { MapProjectJoinLinkView } from "./map-project-join";
import { mapProjectLeaderboardSchema, mapProjectReconSettingsSchema, type MapProjectReconSettings } from "./map-project-recon";
import { sourceDownloadPolicySchema, type PublicMapAccessMode, type SourceDownloadPolicy } from "./public-map-catalog";

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

/**
 * Ägaren 2026-11-10: ändrade färger i kartans färgtabell. `id` är färgens id i grundfilen och `cmyk` den nya färgen (0–1).
 * En färg som inte står med har filens egen färg.
 */
const share = z.number().finite().min(0).max(1);
export const mapProjectColorsSchema = z.array(z.object({ id: z.number().int().min(-1000).max(100_000),
  cmyk: z.object({ c: share, m: share, y: share, k: share }).strict() }).strict()).max(600)
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length);
export type MapProjectColorChange = z.infer<typeof mapProjectColorsSchema>[number];

/** Symbolernas färger (ägaren 2026-11-13): symbolens nummer, färgen i grundfilen och kartfärgen den ritas med. En ändring per symbol och färgplats. */
export const mapProjectSymbolColorsSchema = z.array(z.object({ symbol: z.string().min(1).max(40),
  from: z.number().int().min(-1000).max(100_000), to: z.number().int().min(-1000).max(100_000) }).strict()).max(2000)
  .refine(rows => new Set(rows.map(row => `${row.symbol}\n${row.from}`)).size === rows.length);
export type MapProjectSymbolColorChange = z.infer<typeof mapProjectSymbolColorsSchema>[number];

/**
 * K8b V6: kartprojektets ändrade och nya textsymboler (`MapTextSymbolChange` i map-file): symbolens id i filen (eller kopians nya
 * id med `copyOf`, nummer och namn), typsnitt, storlek i mm, kartans färg, fet/kursiv, justering och kontur. Hela stilen varje gång.
 */
export const mapProjectTextSymbolsSchema = z.array(z.object({
  id: z.string().regex(/^\d{1,9}$/), copyOf: z.string().regex(/^\d{1,9}$/).optional(), code: z.string().regex(/^\d{1,4}(\.\d{1,4})?$/).optional(),
  name: z.string().max(120).optional(), fontFamily: z.string().trim().min(1).max(80).refine(value => !/["<>&]/.test(value) && [...value].every(char => char.charCodeAt(0) >= 32)),
  size: z.number().min(0.1).max(100), color: z.number().int().min(0).max(100_000), bold: z.boolean(), italic: z.boolean(),
  align: z.enum(["left", "center", "right"]).optional(),
  framing: z.object({ color: z.number().int().min(0).max(100_000), width: z.number().gt(0).max(10) }).strict().nullable()
}).strict().refine(row => (row.copyOf === undefined) === (row.code === undefined))).max(500)
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length);
export type MapProjectTextSymbolChange = z.infer<typeof mapProjectTextSymbolsSchema>[number];

/**
 * Ägaren 2026-11-23: symbolerna rättade efter ISSprOM 2019-2 (`NormSymbolSetting` i map-revision): numren vars symbol byts mot
 * normens och normens nummer som läggs till. Tomma listor = filens egna.
 */
const normCodeSchema = z.string().regex(/^\d{1,4}(\.\d{1,4})?$/);
export const mapProjectNormSymbolsSchema = z.object({ replace: z.array(normCodeSchema).max(300), add: z.array(normCodeSchema).max(300) }).strict();
export type MapProjectNormSymbols = z.infer<typeof mapProjectNormSymbolsSchema>;

/**
 * Vad AI-kopplingen får göra i projektet (ägaren 2026-11-12): bara läsa, lämna förslag som en ägare godkänner (förval), eller
 * arbeta självständigt, då AI:ns ändringar godkänns direkt och hamnar i kartans historik som godkända förslag.
 */
export const mapProjectAiModeSchema = z.enum(["READ", "PROPOSE", "AUTONOMOUS"]);
export type MapProjectAiMode = z.infer<typeof mapProjectAiModeSchema>;

/** Byt namn, avsluta (`CLOSED`) eller öppna igen (`OPEN`), eller byt arbetssätt (`mode`, K1). */
export const mapProjectUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), name: mapProjectNameSchema.optional(), status: z.enum(["OPEN", "CLOSED"]).optional(),
  mode: mapProjectModeSchema.optional(),
  /** Rekningens inställningar (K3); null = förvalen. */
  recon: mapProjectReconSettingsSchema.nullable().optional(),
  /** Topplistan (K3b): null = av. */
  leaderboard: mapProjectLeaderboardSchema.nullable().optional(),
  /** Färgtabellens ändringar; tom lista = filens egna färger. */
  colors: mapProjectColorsSchema.optional(),
  /** Symbolernas färger; tom lista = symbolernas egna färger. */
  symbolColors: mapProjectSymbolColorsSchema.optional(),
  /** K8b V6: textsymbolernas stil och nya textsymboler; tom lista = filens egna. */
  textSymbols: mapProjectTextSymbolsSchema.optional(),
  /** Symbolerna rättade efter normen. */
  normSymbols: mapProjectNormSymbolsSchema.optional(),
  /** AI-kopplingens läge i projektet. */
  aiMode: mapProjectAiModeSchema.optional(),
  /** Etapp 2: nedladdningsspärr för kartprojektets råa källfil och genererade fullkartor (endast projektägare/klubbadmin). */
  sourceDownloadPolicy: sourceDownloadPolicySchema.optional()
}).strict().refine(value => value.name !== undefined || value.status !== undefined || value.mode !== undefined || value.recon !== undefined
  || value.leaderboard !== undefined || value.colors !== undefined || value.symbolColors !== undefined || value.textSymbols !== undefined
  || value.normSymbols !== undefined || value.aiMode !== undefined || value.sourceDownloadPolicy !== undefined);

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

/** Format för "Exportera bara ändringarna": Mapper (.xmap), OCAD (.ocd) eller GeoJSON. */
export const mapProjectExportFormatSchema = z.enum(["omap", "ocd", "geojson"]);
export type MapProjectExportFormat = z.infer<typeof mapProjectExportFormatSchema>;

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
  /** När projektet senast användes eller ändrades (senast öppnat, annars när det skapades eller avslutades); listan sorteras på den. */
  lastActiveAt: string;
  /** Objekt som inte är som i grundfilen (nya som tagits bort igen räknas inte). */
  changedObjects: number;
  outputs: MapProjectOutputView[];
  /** Etapp 2: projektets egen nedladdningspolicy för rå källfil och fullkartor. */
  sourceDownloadPolicy: SourceDownloadPolicy;
  /** Etapp 2: sant när grundkartan i klubbarkivet har nedladdningsspärr (`CUSTODIANS_ONLY`). */
  sourceDownloadLockedByArchive: boolean;
  /** Etapp 2: effektiv nedladdningspolicy (`CUSTODIANS_ONLY` om projektet eller klubbarkivet är spärrat). */
  effectiveSourceDownloadPolicy: SourceDownloadPolicy;
}

export interface MapProjectMemberView { accountId: string; name: string; role: MapProjectRole; lastSeenAt: string | null; edits: number }
export interface MapProjectInvitationView { invitationId: string; email: string; role: MapProjectRole; createdAt: string; sentAt: string | null }

export interface MapProjectView extends MapProjectSummary {
  formatVersion: 1;
  /**
   * `canWriteVersion` = får skapa en ny version i projektet (ägarna, när servern kan skriva grundfilens format:
   * `.omap` alltid och `.ocd` när `OTID_OCAD_WRITE=1`); `canArchive` = får också lägga den i klubbarkivet
   * (projektet hör till en klubb och kontot är administratör där); `canDownloadSource` = får ladda ner rå källfil (`/source`),
   * resultatfiler (`/outputs/:id`) och kartexport (`/export?format=omap|ocd`).
   */
  viewer: { accountId: string; canEdit: boolean; canManage: boolean; canWriteVersion: boolean; canArchive: boolean;
    /** Får rita förslag (Föreslå eller mer, projektet öppet). */
    canPropose: boolean;
    /** Får godkänna och avvisa förslag, byta arbetssätt och hantera delområden (ägarna). */
    canDecide: boolean;
    /** Etapp 2: får ladda ner rå källfil och fullkartor. */
    canDownloadSource: boolean };
  /** Etapp 2: status i den publika kartbanken (`public_map_listing`), utan extra `/catalog`-anrop. */
  publishedInCatalog?: boolean;
  publicListingId?: string | null;
  publicListingAccessMode?: PublicMapAccessMode | null;
  /** Arbetssättet (K1). */
  mode: MapProjectMode;
  /** Kartans område för en ny karta (kartans mm, y uppåt, första ringen ytterkant); null för en befintlig karta. */
  area: { x: number; y: number }[][] | null;
  /** Rekningens inställningar (K3); null = förvalen. */
  recon: MapProjectReconSettings | null;
  /** Topplistan (K3b): null = av, annars hur namnen visas. */
  leaderboard: "FIRST" | "FULL" | "NONE" | null;
  /** Ändrade färger i kartans färgtabell (tom = filens egna). */
  colors: MapProjectColorChange[];
  /** Ändrade färger för enskilda symboler (tom = symbolernas egna). */
  symbolColors: MapProjectSymbolColorChange[];
  /** K8b V6: ändrade och nya textsymboler (tom = filens egna). */
  textSymbols: MapProjectTextSymbolChange[];
  /** Symbolerna rättade efter normen (tomma listor = filens egna). */
  normSymbols: MapProjectNormSymbols;
  /** Vad AI-kopplingen får göra i projektet. */
  aiMode: MapProjectAiMode;
  areas: MapProjectAreaView[];
  /** Antalet öppna förslag. */
  openProposals: number;
  /**
   * Ägaren 2026-11-10: storleken i byte. `mapFileBytes` = kartfilen projektet startade från; `totalBytes` = allt projektet
   * lagrar (kartfilen, underlag, laserresultat, utdata, foton och ändringarna), varje fil räknad en gång.
   */
  storage: { mapFileBytes: number; totalBytes: number };
  /** Läsarnas version när projektet startade; en annan version kan ge andra platser för objekten. */
  readerVersion: number;
  seq: number;
  members: MapProjectMemberView[];
  /** Öppna inbjudningar (bara för den som får hantera medlemmarna). */
  invitations: MapProjectInvitationView[];
  /** Öppna länkar för att gå med (bara för den som får hantera medlemmarna). */
  joinLinks: MapProjectJoinLinkView[];
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
