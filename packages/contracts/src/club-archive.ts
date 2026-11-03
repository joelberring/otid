import { z } from "zod";
import { accountEmailSchema } from "./account";
import { uuidSchema } from "./ids";
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

export const clubRoleSchema = z.enum(["OWNER", "ADMIN", "READER"]);
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

export const clubMapUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), name: clubNameSchema, agreement: mapAgreementSchema
}).strict();

/** Slå ihop kartan med en annan (alla versioner flyttas dit och kartan tas bort). */
export const clubMapMergeRequestSchema = z.object({ formatVersion: z.literal(1), targetMapId: uuidSchema }).strict();

/** Flytta en version till en annan karta, eller till en ny karta med namnet. */
export const clubMapVersionMoveRequestSchema = z.object({
  formatVersion: z.literal(1), targetMapId: uuidSchema.nullable(), newMapName: clubNameSchema.nullable()
}).strict().refine(value => (value.targetMapId === null) !== (value.newMapName === null));

export const clubMapVersionUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), versionDate: z.iso.date().nullable(), note: optionalText(500)
}).strict();

/** Banfilens karta vald för hand (eller ingen). */
export const clubCourseFileMapRequestSchema = z.object({ formatVersion: z.literal(1), mapVersionId: uuidSchema.nullable() }).strict();

// --- Importen (ADR-0194 beslut 6–7) ---------------------------------------------------------------------------------------

export const clubImportCheckRequestSchema = z.object({ formatVersion: z.literal(1), sha256: z.array(sha256Schema).max(1000) }).strict();
export interface ClubImportCheckResponse { formatVersion: 1; clubId: string; clubName: string; known: string[] }

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
export type ClubImportMap = z.infer<typeof clubImportMapSchema>;
export type ClubImportEntry = z.infer<typeof clubImportEntrySchema>;
export type ClubImportCourseFile = z.infer<typeof clubImportCourseFileSchema>;
export type ClubArchiveEntryUpdateRequest = z.infer<typeof clubArchiveEntryUpdateRequestSchema>;

// --- Vyerna ----------------------------------------------------------------------------------------------------------------

export interface ClubSummary { clubId: string; name: string; role: ClubRole; entries: number }

export interface ClubMember { memberId: string; accountId: string; email: string; displayName: string; role: ClubRole; addedAt: string }
export interface ClubInvitation { invitationId: string; email: string; role: ClubRole; createdAt: string }
export interface ClubImportTokenView { tokenId: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null;
  createdByName: string }

/** Klubbens användning: unika kartfiler och banfiler. */
export interface ClubUsage { mapBytes: number; courseFileBytes: number; maps: number; versions: number; entries: number; courseFiles: number }

export interface ClubView {
  formatVersion: 1; clubId: string; name: string; viewer: { accountId: string; role: ClubRole };
  members: ClubMember[]; invitations: ClubInvitation[]; usage: ClubUsage; tokens: ClubImportTokenView[];
  /** Kontots kvot för kartinnehåll (ADR-0189 beslut 3), null = ingen gräns. */
  quota: { accountLimitBytes: number | null; accountUsedBytes: number };
}

export type ClubArchiveEntryStatus = "COMPLETE" | "COURSES_ONLY" | "MAP_MISSING" | "MAP_ONLY";

export interface ClubArchiveListItem {
  entryId: string; trainingDate: string | null; year: number | null; place: string; title: string; leader: string | null; tags: string[];
  courseNames: string[]; courseFiles: number; maps: { mapId: string; name: string }[]; status: ClubArchiveEntryStatus;
}

export interface ClubMapVersionView {
  versionId: string; mapId: string; fileName: string; format: "OCD" | "OMAP"; byteLength: number; versionDate: string | null; note: string | null;
  uploadedAt: string; sourcePath: string | null; contentSha256: string; trainings: number;
}

export interface ClubMapView extends MapAgreement {
  mapId: string; name: string; versions: ClubMapVersionView[]; latestVersionId: string | null; trainings: number;
}

export interface ClubArchiveList { formatVersion: 1; clubId: string; clubName: string; viewer: { role: ClubRole }; entries: ClubArchiveListItem[];
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
  formatVersion: 1; clubId: string; clubName: string; viewer: { role: ClubRole };
  entry: ClubArchiveListItem & { notes: string | null; sourcePath: string | null };
  courseFiles: ClubArchiveCourseFileView[];
  /** Kartorna i träningens mapp och kartorna som banfilerna pekar på, med rättigheterna och alla versioner. */
  maps: ClubMapView[];
  /** Kartversionerna som låg i mappen. */
  folderVersionIds: string[];
  /** Träningsgrupper där kontot är ledare ("Använd igen" i en grupp, kartan i gruppens bibliotek). */
  groups: { groupId: string; name: string }[];
}
