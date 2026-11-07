import { z } from "zod";
import { accountEmailSchema } from "./account";
import { uuidSchema } from "./ids";
import type { ClubEntryThumbnailSource, ClubEntryThumbnailView, ClubMapCheckView } from "./club-archive-checks";
import type { ClubMapMergeView } from "./club-map-duplicates";
import { mapAgreementSchema, type MapAgreement } from "./training-group";

/**
 * ADR-0194: klubben och klubbarkivet. Skrivningar som skapar en rad är idempotenta på `requestId`; importens anrop är
 * idempotenta på innehållet (sha256) och källans sökväg.
 */
const optionalText = (max: number) => z.string().trim().max(max).transform(value => value === "" ? null : value).nullable();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const CLUB_ARCHIVE_MAP_MAX_BYTES = 75 * 1024 * 1024;
export const CLUB_ARCHIVE_COURSE_FILE_MAX_BYTES = 5 * 1024 * 1024;
/** Importens JSON-anrop (träningar med banfiler i base64) får vara högst så här stora. */
export const CLUB_IMPORT_BATCH_MAX_BYTES = 8 * 1024 * 1024;
/** Hur länge en importnyckel gäller. */
export const CLUB_IMPORT_TOKEN_HOURS = 12;
export const CLUB_IMPORT_TOKEN_PATTERN = /^otid-imp-[A-Za-z0-9_-]{43}$/;

/** ADR-0209: Ledare (LEADER) mellan medlem (READER, "Medlem") och administratör. */
export const clubRoleSchema = z.enum(["OWNER", "ADMIN", "LEADER", "READER"]);
export const clubNameSchema = z.string().trim().min(1).max(120);
export const clubTagSchema = z.string().trim().min(1).max(40);

export const clubCreateRequestSchema = z.object({ formatVersion: z.literal(1), requestId: uuidSchema, name: clubNameSchema }).strict();

export const clubMemberInviteRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuidSchema, email: accountEmailSchema, role: clubRoleSchema
}).strict();

export const clubMemberRemoveRequestSchema = z.object({
  formatVersion: z.literal(1), memberId: uuidSchema.nullable(), invitationId: uuidSchema.nullable()
}).strict().refine(value => (value.memberId === null) !== (value.invitationId === null));

export const clubMemberRoleRequestSchema = z.object({ formatVersion: z.literal(1), memberId: uuidSchema, role: clubRoleSchema }).strict();

export const clubArchiveEntryUpdateRequestSchema = z.object({
  formatVersion: z.literal(1),
  trainingDate: z.iso.date().nullable(),
  place: z.string().trim().max(200),
  title: z.string().trim().min(1).max(200),
  leader: optionalText(200),
  tags: z.array(clubTagSchema).max(30),
  notes: optionalText(4000)
}).strict();

/** ADR-0210: `description` och `maker` (valfria; utelämnade = oförändrade) sätts en gång på kartan. */
export const clubMapUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), name: clubNameSchema, agreement: mapAgreementSchema, description: optionalText(2000).optional(),
  maker: optionalText(200).optional()
}).strict();

/** Slå ihop kartan med en annan (alla versioner flyttas dit och kartan tas bort). */
export const clubMapMergeRequestSchema = z.object({ formatVersion: z.literal(1), targetMapId: uuidSchema }).strict();

/** Flytta en version till en annan karta, eller till en ny karta med namnet. */
export const clubMapVersionMoveRequestSchema = z.object({
  formatVersion: z.literal(1), targetMapId: uuidSchema.nullable(), newMapName: clubNameSchema.nullable()
}).strict().refine(value => (value.targetMapId === null) !== (value.newMapName === null));

/** ADR-0210: `versionYear` (null = gissa igen) och `maker` är valfria; utelämnade är oförändrade. */
export const clubMapVersionUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), versionDate: z.iso.date().nullable(), note: optionalText(500),
  versionYear: z.number().int().min(1950).max(2100).nullable().optional(), maker: optionalText(200).optional()
}).strict();

/** Banfilens karta vald för hand (eller ingen). */
export const clubCourseFileMapRequestSchema = z.object({ formatVersion: z.literal(1), mapVersionId: uuidSchema.nullable() }).strict();

// --- Importen (ADR-0194 beslut 6–7) ---------------------------------------------------------------------------------------

/**
 * `importKeys` (valfritt, ADR-0204): träningarnas nycklar, så att förhandsgranskningen i webbläsaren kan säga vilka träningar
 * som redan finns (`knownEntries`). Kommandot skickar dem inte och får samma svar som förut.
 */
export const clubImportCheckRequestSchema = z.object({ formatVersion: z.literal(1), sha256: z.array(sha256Schema).max(1000),
  importKeys: z.array(z.string().min(1).max(500)).max(5000).optional() }).strict();
export interface ClubImportCheckResponse { formatVersion: 1; clubId: string; clubName: string; known: string[]; knownEntries?: string[] }

const importPathSchema = z.string().min(1).max(500);
export const clubImportMapVersionSchema = z.object({
  sha256: sha256Schema, fileName: z.string().min(1).max(200), format: z.enum(["OCD", "OMAP"]), versionDate: z.iso.date().nullable(),
  sourcePath: importPathSchema.nullable()
}).strict();
export const clubImportMapSchema = z.object({
  importKey: z.string().min(1).max(200), name: clubNameSchema, versions: z.array(clubImportMapVersionSchema).min(1).max(200)
}).strict();
export const clubImportCourseFileSchema = z.object({
  fileName: z.string().min(1).max(200),
  kind: z.enum(["PPEN", "COURSE_DATA"]),
  sha256: sha256Schema,
  /** Filen orörd i base64. */
  contentBase64: z.string().min(4).max(Math.ceil(CLUB_ARCHIVE_COURSE_FILE_MAX_BYTES / 3) * 4),
  mapReference: z.string().min(1).max(500).nullable(),
  mapSha256: sha256Schema.nullable(),
  resolution: z.enum(["FOLDER", "NAME", "MISSING", "NONE"])
}).strict();
export const clubImportEntrySchema = z.object({
  importKey: importPathSchema,
  trainingDate: z.iso.date().nullable(),
  year: z.number().int().min(1950).max(2200).nullable(),
  place: z.string().max(200),
  title: z.string().trim().min(1).max(200),
  leader: z.string().trim().min(1).max(200).nullable(),
  tags: z.array(clubTagSchema).max(30),
  sourcePath: importPathSchema,
  mapSha256: z.array(sha256Schema).max(50),
  courseFiles: z.array(clubImportCourseFileSchema).max(100)
}).strict();
export const clubImportBatchRequestSchema = z.object({
  formatVersion: z.literal(1), maps: z.array(clubImportMapSchema).max(500), entries: z.array(clubImportEntrySchema).max(500)
}).strict();
export interface ClubImportBatchResponse {
  formatVersion: 1;
  maps: { created: number; versionsAdded: number };
  entries: { created: number; existing: number; courseFilesAdded: number };
  /** Kartor som träningarna pekade på men som servern inte har (laddas upp först). */
  missingContent: string[];
}
export interface ClubImportContentResponse { formatVersion: 1; sha256: string; byteLength: number; stored: "new" | "existing" }

export type ClubRole = z.infer<typeof clubRoleSchema>;
export type ClubImportBatchRequest = z.infer<typeof clubImportBatchRequestSchema>;
export type ClubImportCourseFile = z.infer<typeof clubImportCourseFileSchema>;

// --- Vyerna ----------------------------------------------------------------------------------------------------------------

/** `pending`: för ägare och administratörer, hur många som väntar på bekräftelse som medlemmar. */
export interface ClubSummary { clubId: string; name: string; role: ClubRole; entries: number; pending?: number }

/**
 * En rad i klubbens medlemslista. ADR-0209 beslut 5–6: bara ägare och administratörer får hela listan; läsare och ledare får
 * bara sin egen rad. Inget konto-id (`you` = raden är den inloggades).
 */
export interface ClubMember { memberId: string; email: string; displayName: string; role: ClubRole; addedAt: string; you: boolean }
/**
 * ADR-0206: `sentAt` = när inbjudan senast mejlades (null = aldrig). ADR-0209: tom adress och `displayName` = inbjuden
 * "Från klubben".
 */
export interface ClubInvitation { invitationId: string; email: string; role: ClubRole; createdAt: string; sentAt: string | null;
  displayName?: string }
export interface ClubImportTokenView { tokenId: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null;
  createdByName: string }

/** Klubbens användning: unika kartfiler och banfiler. */
export interface ClubUsage { mapBytes: number; courseFileBytes: number; maps: number; versions: number; entries: number; courseFiles: number }

export interface ClubView {
  formatVersion: 1; clubId: string; name: string; viewer: { accountId: string; role: ClubRole };
  /** ADR-0209 beslut D: klubben i Eventor (bevisad med klubbens nyckel), eller null = "Inte kopplad till Eventor". */
  eventorClub: string | null;
  members: ClubMember[]; invitations: ClubInvitation[]; usage: ClubUsage; tokens: ClubImportTokenView[];
  /** ADR-0206: e-post finns på servern ("Skicka igen"); utan den "Kopiera länken". Sätts av webben. */
  mailEnabled?: boolean;
  /** Kontots kvot för kartinnehåll (ADR-0189 beslut 3), null = ingen gräns. */
  quota: { accountLimitBytes: number | null; accountUsedBytes: number };
}

export type ClubArchiveEntryStatus = "COMPLETE" | "COURSES_ONLY" | "MAP_MISSING" | "MAP_ONLY";

export interface ClubArchiveListItem {
  entryId: string; trainingDate: string | null; year: number | null; place: string; title: string; leader: string | null; tags: string[];
  courseNames: string[]; courseFiles: number; maps: { mapId: string; name: string }[]; status: ClubArchiveEntryStatus;
  /** ADR-0196: träningens bild (null = inte ritad än) och vad den ritas av (null = ingen karta). */
  thumbnail: ClubEntryThumbnailView | null; thumbnailSource: ClubEntryThumbnailSource | null;
}

export interface ClubMapVersionView {
  versionId: string; mapId: string; fileName: string; format: "OCD" | "OMAP"; byteLength: number; versionDate: string | null; note: string | null;
  uploadedAt: string; sourcePath: string | null; contentSha256: string; trainings: number;
  /** ADR-0196: senaste kontrollen (null = inte kontrollerad än). */
  check: ClubMapCheckView | null;
  /** ADR-0210: versionens år (inskrivet eller gissat, och varifrån) och kartritare. */
  year: number; yearSource: ClubMapVersionYearSource; maker: string | null;
}

export type ClubMapVersionYearSource = "MANUAL" | "FILE_NAME" | "FOLDER" | "YEAR_FOLDER" | "DATE" | "UPLOAD";

export interface ClubMapView extends MapAgreement {
  mapId: string; name: string; versions: ClubMapVersionView[]; latestVersionId: string | null; trainings: number;
  /** ADR-0210: beskrivning och kartritare, första och sista versionens år, och sammanslagningarna in i kartan. */
  description: string | null; maker: string | null; years: { from: number; to: number } | null; merges: ClubMapMergeView[];
}

/** ADR-0209 beslut C: vad den inloggade får se och använda ("Vem ser vad"; ägare och administratörer alltid allt). */
export interface ClubAreaView { archive: boolean; mapBank: boolean }

export interface ClubArchiveList { formatVersion: 1; clubId: string; clubName: string; viewer: { role: ClubRole; access: ClubAreaView }; entries: ClubArchiveListItem[];
  maps: ClubMapView[] }

export interface ClubCourseSummary { name: string; controls: number; lengthM: number | null }

export interface ClubArchiveCourseFileView {
  courseFileId: string; kind: "PPEN" | "COURSE_DATA"; fileName: string; byteLength: number; courses: ClubCourseSummary[]; scale: number | null;
  problem: string | null; mapReference: string | null; resolution: "FOLDER" | "NAME" | "MANUAL" | "MISSING" | "NONE";
  mapVersion: { versionId: string; mapId: string; mapName: string; fileName: string; versionDate: string | null; latest: boolean } | null;
  /** CourseData: banornas kontroller på kartan (mm, start först och mål sist) för förhandsvisningen; null för .ppen. */
  courseData: { name: string; points: { label: string; kind: "START" | "CONTROL" | "FINISH"; x: number; y: number }[] }[] | null;
}

export interface ClubArchiveEntryView {
  formatVersion: 1; clubId: string; clubName: string; viewer: { role: ClubRole; access: ClubAreaView };
  /** ADR-0209 beslut 4: tävlingen som träningen lades in från (null = importerad eller skapad i arkivet). */
  sourceRace: { raceId: string; name: string; date: string; exists: boolean; publicPath: string | null } | null;
  entry: ClubArchiveListItem & { notes: string | null; sourcePath: string | null };
  courseFiles: ClubArchiveCourseFileView[];
  /** Kartorna i träningens mapp och kartorna som banfilerna pekar på, med rättigheterna och alla versioner. */
  maps: ClubMapView[];
  /** Kartversionerna som låg i mappen. */
  folderVersionIds: string[];
  /** Träningsgrupper där kontot är ledare ("Använd igen" i en grupp, kartan i gruppens bibliotek). */
  groups: { groupId: string; name: string }[];
}
