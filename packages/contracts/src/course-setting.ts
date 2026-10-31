import { z } from "zod";
import { uuidSchema as uuid } from "./ids";
import { raceMapSourceBoundsSchema } from "./race-map-source";

/**
 * Steg 62 (ADR-0180): banläggningen. Dokumentet (`CourseSettingDocument` i `@o-tid/course-setting`) räknas och ändras i
 * arrangörens webbläsare; servern sparar det med versionskontroll, behåller tidigare versioner och för över det till
 * tävlingens banor (samma jämförelse som en banfil). Här kontrolleras bara dokumentets grundform och storlek; det som
 * O-Tid inte tolkar (`raw`) följer med orört. Bara admin, aldrig publikt (ADR-0176).
 */
/** Dokumentet som JSON. En stor tävling (Purple Pens SBN26_1) är några hundra kB. */
export const COURSE_SETTING_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
/** Den inlästa .ppen-filen orörd. */
export const COURSE_SETTING_PPEN_MAX_BYTES = 8 * 1024 * 1024;
/** Sparandet (dokumentet) och inläsningen (dokumentet och filen) med marginal för JSON. */
export const COURSE_SETTING_SAVE_MAX_BYTES = COURSE_SETTING_DOCUMENT_MAX_BYTES + 64 * 1024;
export const COURSE_SETTING_IMPORT_MAX_BYTES = COURSE_SETTING_DOCUMENT_MAX_BYTES + 2 * COURSE_SETTING_PPEN_MAX_BYTES + 64 * 1024;
/** Antal tidigare versioner som behålls. */
export const COURSE_SETTING_REVISIONS_KEPT = 50;

const version = z.number().int().positive().max(2_147_483_647);
const instant = z.iso.datetime();
const id = z.string().min(1).max(64);
const mm = z.number().finite().min(-1_000_000).max(1_000_000);
const point = z.object({ x: mm, y: mm }).loose();
const raw = z.array(z.object({ xml: z.string().max(COURSE_SETTING_DOCUMENT_MAX_BYTES) }).strict()).max(10_000);
const fileName = z.string().trim().min(1).max(200);

const controlSchema = z.object({
  id,
  kind: z.enum(["START", "NORMAL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE", "MAP_ISSUE"]),
  code: z.string().max(32).optional(),
  at: point,
  descriptions: z.array(z.object({ box: z.string().max(8) }).loose()).max(64)
}).loose();
const courseControlSchema = z.object({ id, control: id, next: id.optional() }).loose();
const courseSchema = z.object({ id, name: z.string().max(200), kind: z.enum(["NORMAL", "SCORE"]), order: z.number().finite(),
  first: id.optional() }).loose();
const legSchema = z.object({ from: id, to: id, bends: z.array(point).max(1000) }).loose();

/** Grundformen: rätt version, kontroller, banornas kontroller, banor, sträckor, specialobjekt och orörda element. */
export const courseSettingDocumentSchema = z.object({
  version: z.literal(1),
  event: z.object({ title: z.string().max(400), mapScale: z.number().finite().min(100).max(1_000_000) }).loose(),
  controls: z.record(id, controlSchema).refine(value => Object.keys(value).length <= 10_000),
  courseControls: z.record(id, courseControlSchema).refine(value => Object.keys(value).length <= 50_000),
  courses: z.array(courseSchema).max(1000),
  legs: z.record(z.string().max(140), legSchema).refine(value => Object.keys(value).length <= 50_000),
  specialObjects: z.array(z.object({ id, kind: z.string().max(80) }).loose()).max(10_000),
  raw
}).loose()
  // Kontrollens och banans id stämmer med nyckeln, och banornas kontroller pekar på kontroller som finns.
  .refine(document => Object.entries(document.controls).every(([key, control]) => control.id === key) &&
    Object.entries(document.courseControls).every(([key, courseControl]) => courseControl.id === key &&
      document.controls[courseControl.control] !== undefined && (courseControl.next === undefined || document.courseControls[courseControl.next] !== undefined)) &&
    document.courses.every(course => course.first === undefined || document.courseControls[course.first] !== undefined) &&
    new Set(document.courses.map(course => course.id)).size === document.courses.length);
export type CourseSettingDocumentDto = z.infer<typeof courseSettingDocumentSchema>;

const actor = z.object({ accountId: uuid, displayName: z.string().max(200).nullable() }).strict();

/** Läget: dokumentet (null = inget än), originalfilen, och kartfilen som editorn ritar (null = ingen kartfil). */
export const courseSettingStateSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuid,
  setting: z.object({ version, updatedAt: instant, updatedBy: actor, document: courseSettingDocumentSchema }).strict().nullable(),
  /** Den senast inlästa .ppen-filen orörd (hämtas med `course-setting/original`). */
  original: z.object({ fileName, importedAt: instant }).strict().nullable(),
  mapFile: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), fileName, scale: z.number().int().min(100).max(1_000_000),
    bounds: raceMapSourceBoundsSchema, georeferenced: z.boolean() }).strict().nullable()
}).strict();
export type CourseSettingState = z.infer<typeof courseSettingStateSchema>;

/** Spara: `expectedVersion` är versionen som ändringen bygger på (0 = det finns inget dokument än). */
export const courseSettingSaveRequestSchema = z.object({
  formatVersion: z.literal(1), expectedVersion: z.number().int().nonnegative().max(2_147_483_647), document: courseSettingDocumentSchema
}).strict();
export type CourseSettingSaveRequest = z.infer<typeof courseSettingSaveRequestSchema>;

/** Läs in .ppen: dokumentet som webbläsaren läst (readPpen) och filen orörd. Det gamla dokumentet blir en tidigare version. */
export const courseSettingImportRequestSchema = z.object({
  formatVersion: z.literal(1), expectedVersion: z.number().int().nonnegative().max(2_147_483_647), document: courseSettingDocumentSchema,
  fileName, ppen: z.string().min(1).max(COURSE_SETTING_PPEN_MAX_BYTES)
}).strict();
export type CourseSettingImportRequest = z.infer<typeof courseSettingImportRequestSchema>;

/** Återställ en tidigare version (det nuvarande dokumentet blir en tidigare version). */
export const courseSettingRestoreRequestSchema = z.object({
  formatVersion: z.literal(1), expectedVersion: version, revision: version
}).strict();
export type CourseSettingRestoreRequest = z.infer<typeof courseSettingRestoreRequestSchema>;

export const courseSettingSavedSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, version, updatedAt: instant
}).strict();
export type CourseSettingSaved = z.infer<typeof courseSettingSavedSchema>;

/** HTTP 409: någon annan har sparat (eller importerat) sedan dokumentet lästes. Den aktuella versionen följer med. */
export const courseSettingConflictSchema = z.object({
  formatVersion: z.literal(1), error: z.literal("VERSION_CONFLICT"),
  current: z.object({ version, updatedAt: instant, updatedBy: actor }).strict().nullable()
}).strict();
export type CourseSettingConflict = z.infer<typeof courseSettingConflictSchema>;

export const courseSettingRevisionKindSchema = z.enum(["SAVE", "IMPORT", "RESTORE"]);
export const courseSettingRevisionsSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid,
  revisions: z.array(z.object({ version, kind: courseSettingRevisionKindSchema, createdAt: instant, createdBy: actor,
    courses: z.number().int().nonnegative(), controls: z.number().int().nonnegative() }).strict()).max(COURSE_SETTING_REVISIONS_KEPT)
}).strict();
export type CourseSettingRevisions = z.infer<typeof courseSettingRevisionsSchema>;

export const courseSettingRevisionSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, version, kind: courseSettingRevisionKindSchema, createdAt: instant, createdBy: actor,
  document: courseSettingDocumentSchema
}).strict();
export type CourseSettingRevision = z.infer<typeof courseSettingRevisionSchema>;

/** "Överför till tävlingen": versionen som visas i editorn (är den inte den sparade svarar servern 409). */
export const courseSettingTransferRequestSchema = z.object({ formatVersion: z.literal(1), version }).strict();
export type CourseSettingTransferRequest = z.infer<typeof courseSettingTransferRequestSchema>;

/**
 * Begripliga fel vid överföringen (HTTP 422): inget dokument, ingen bana med start och mål, eller kontroller på banorna
 * utan kodsiffra (tävlingens kontroller har koder 1–999 …). `controls` = kontrollernas id i dokumentet.
 */
export const courseSettingTransferProblemSchema = z.object({
  formatVersion: z.literal(1),
  error: z.enum(["NO_DOCUMENT", "NO_COURSES", "INVALID_CODES"]),
  controls: z.array(id).max(200)
}).strict();
export type CourseSettingTransferProblem = z.infer<typeof courseSettingTransferProblemSchema>;
