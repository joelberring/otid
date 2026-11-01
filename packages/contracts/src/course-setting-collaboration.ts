import { z } from "zod";
import { courseSettingLevelSchema, courseSettingModeSchema, courseSettingParts as part, COURSE_SETTING_DOCUMENT_MAX_BYTES } from "./course-setting";
import { uuidSchema as uuid } from "./ids";

/**
 * Steg 66 (ADR-0181 beslut 1–5): samarbete i banläggningen. Åtgärder i stället för hela dokument (`edits`), förslag,
 * notiser och arbetssättet. Formen kontrolleras här; om en åtgärd går avgör paketets `applyEdit` i servern.
 */
const version = z.number().int().positive().max(2_147_483_647);
const instant = z.iso.datetime();
const id = part.id;
const point = z.object({ x: part.mm, y: part.mm }).strict();
const actor = z.object({ accountId: uuid, displayName: z.string().max(200).nullable() }).strict();
const text = z.string().trim().min(1).max(2000);

/** Högst så många åtgärder i en sparning eller ett förslag. */
export const COURSE_SETTING_EDITS_MAX = 5000;
/** Sparningen av åtgärder (de kan innehålla hela objekt för ångra). */
export const COURSE_SETTING_EDITS_MAX_BYTES = COURSE_SETTING_DOCUMENT_MAX_BYTES + 64 * 1024;
/** Fotot på en notis, förminskat i webbläsaren. */
export const COURSE_SETTING_NOTE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const COURSE_SETTING_NOTE_MAX_BYTES = Math.ceil(COURSE_SETTING_NOTE_PHOTO_MAX_BYTES * 4 / 3) + 16 * 1024;
export const COURSE_SETTING_NOTE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const nullableRecord = <T extends z.ZodType>(key: z.ZodString, value: T) => z.record(key, value.nullable())
  .refine(record => Object.keys(record).length <= 50_000);

/** En åtgärd (`CourseSettingEdit` i `@o-tid/course-setting`). */
export const courseSettingEditSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ADD_CONTROL"), kind: z.enum(["START", "NORMAL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE", "MAP_ISSUE"]),
    at: point, code: z.string().max(32).optional() }).strict(),
  z.object({ type: z.literal("MOVE_CONTROL"), control: id, at: point }).strict(),
  z.object({ type: z.literal("DELETE_CONTROL"), control: id }).strict(),
  z.object({ type: z.literal("SET_CONTROL_CODE"), control: id, code: z.string().max(32) }).strict(),
  z.object({ type: z.literal("ADD_COURSE"), name: z.string().max(200), kind: z.enum(["NORMAL", "SCORE"]).optional() }).strict(),
  z.object({ type: z.literal("UPDATE_COURSE"), course: id, changes: z.object({ name: z.string().max(200).optional(),
    secondaryTitle: z.string().max(400).optional(), printScale: z.number().finite().optional(), climbMeters: z.number().finite().optional(),
    lengthOverrideMeters: z.number().finite().optional(),
    labelKind: z.enum(["SEQUENCE", "CODE", "SEQUENCE_AND_CODE", "SCORE", "CODE_AND_SCORE", "SEQUENCE_AND_SCORE"]).optional(),
    order: z.number().int().optional() }).strict() }).strict(),
  z.object({ type: z.literal("DELETE_COURSE"), course: id }).strict(),
  z.object({ type: z.literal("INSERT_COURSE_CONTROL"), course: id, control: id, after: id.nullable().optional() }).strict(),
  z.object({ type: z.literal("REMOVE_COURSE_CONTROL"), course: id, courseControl: id }).strict(),
  z.object({ type: z.literal("ADD_SPLIT"), course: id, at: id, kind: z.enum(["FORK", "LOOP"]), branches: z.number().int().min(1).max(20) }).strict(),
  z.object({ type: z.literal("REMOVE_SPLIT"), course: id, at: id }).strict(),
  z.object({ type: z.literal("MOVE_NUMBER"), course: id, courseControl: id, at: point.nullable() }).strict(),
  z.object({ type: z.literal("SET_LEG_BENDS"), from: id, to: id, bends: z.array(point).max(1000) }).strict(),
  z.object({ type: z.literal("SET_LEG_GAPS"), from: id, to: id, gaps: z.array(z.object({ start: z.number().finite(), length: z.number().finite() })
    .strict()).max(1000) }).strict(),
  z.object({ type: z.literal("SET_CIRCLE_GAPS"), control: id, gaps: z.array(z.object({ scale: z.number().int().nullable(),
    startDegrees: z.number().finite(), endDegrees: z.number().finite() }).strict()).max(100) }).strict(),
  z.object({ type: z.literal("SET_EVENT"), changes: z.object({ title: z.string().max(400).optional(), mapScale: z.number().finite().optional(),
    overprintStandard: z.enum(["ISOM2017", "ISSPROM2019"]).optional(), descriptionStandard: z.enum(["2004", "2018"]).optional(),
    numbering: z.object({ start: z.number().int(), disallowInvertible: z.boolean() }).strict().optional(),
    descriptionLanguage: z.string().max(16).optional() }).strict() }).strict(),
  z.object({ type: z.literal("SET_DESCRIPTION"), control: id, boxes: z.array(z.object({ box: z.string().max(8), ref: z.string().max(32).optional(),
    text: z.string().max(64).optional() }).strict()).max(16) }).strict(),
  z.object({ type: z.literal("SET_DESCRIPTION_TEXT_LINE"), control: id, location: z.enum(["before", "after"]), text: z.string().max(400).nullable() }).strict(),
  z.object({ type: z.literal("PUT_OBJECTS"), controls: nullableRecord(id, part.control).optional(),
    courseControls: nullableRecord(id, part.courseControl).optional(), courses: nullableRecord(id, part.course).optional(),
    legs: nullableRecord(z.string().max(140), part.leg).optional(), specialObjects: nullableRecord(id, part.specialObject).optional(),
    event: part.event.optional() }).strict()
]);
export type CourseSettingEditDto = z.infer<typeof courseSettingEditSchema>;

/** Id som en åtgärd skapade hos författaren (`CreatedIds`). */
export const courseSettingCreatedIdsSchema = z.object({ controls: z.array(id).max(1000), courseControls: z.array(id).max(1000),
  courses: z.array(id).max(1000) }).strict();
const idMapSchema = z.object({ controls: z.record(id, id), courseControls: z.record(id, id), courses: z.record(id, id) }).strict();
const edits = z.array(courseSettingEditSchema).min(1).max(COURSE_SETTING_EDITS_MAX);
const createdList = z.array(courseSettingCreatedIdsSchema).max(COURSE_SETTING_EDITS_MAX);

/**
 * Spara åtgärder gjorda mot `baseVersion`. Är den inte den aktuella spelas de upp på den aktuella; det som inte går
 * (eller som någon annan hann ändra) avvisas. `created[i]` = id som åtgärd i skapade hos författaren.
 */
export const courseSettingEditsRequestSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, baseVersion: version, edits, created: createdList.optional()
}).strict().refine(request => request.created === undefined || request.created.length === request.edits.length);
export type CourseSettingEditsRequest = z.infer<typeof courseSettingEditsRequestSchema>;

export const courseSettingRejectedEditSchema = z.object({
  index: z.number().int().nonnegative(), code: z.enum(["NOT_FOUND", "INVALID", "IN_USE", "CONFLICT", "DEPENDS"]), message: z.string().max(400)
}).strict();
export type CourseSettingRejectedEdit = z.infer<typeof courseSettingRejectedEditSchema>;

/**
 * Svaret: versionen nu (oförändrad om inget gick), om åtgärderna spelades upp på en annan version än `baseVersion`
 * (`rebased`), avvisade åtgärder och författarens id → dokumentets id.
 */
export const courseSettingEditsSavedSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, version, updatedAt: instant, rebased: z.boolean(), applied: z.number().int().nonnegative(),
  rejected: z.array(courseSettingRejectedEditSchema).max(COURSE_SETTING_EDITS_MAX), idMap: idMapSchema
}).strict();
export type CourseSettingEditsSaved = z.infer<typeof courseSettingEditsSavedSchema>;

/** Arbetssättet (bara admin). */
export const courseSettingModeRequestSchema = z.object({ formatVersion: z.literal(1), mode: courseSettingModeSchema }).strict();

// Notiser (ADR-0181 beslut 1): utanför dokumentet.
export const courseSettingNoteTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("POINT"), at: point }).strict(),
  z.object({ kind: z.literal("CONTROL"), control: id }).strict(),
  z.object({ kind: z.literal("LEG"), from: id, to: id }).strict(),
  z.object({ kind: z.literal("COURSE"), course: id }).strict()
]);
export type CourseSettingNoteTarget = z.infer<typeof courseSettingNoteTargetSchema>;

const photoTypeSchema = z.enum(COURSE_SETTING_NOTE_PHOTO_TYPES);
export const courseSettingNoteSchema = z.object({
  id: uuid, target: courseSettingNoteTargetSchema,
  /** Läget när notisen skrevs (null för en bana). */
  at: point.nullable(),
  /** Banan som visades när notisen skrevs (eller som den gäller). */
  course: id.nullable(),
  text, status: z.enum(["OPEN", "DONE"]), createdAt: instant, createdBy: actor, resolvedAt: instant.nullable(), resolvedBy: actor.nullable(),
  photo: z.object({ mediaType: photoTypeSchema, bytes: z.number().int().positive().max(COURSE_SETTING_NOTE_PHOTO_MAX_BYTES) }).strict().nullable(),
  replies: z.array(z.object({ id: uuid, text, createdAt: instant, createdBy: actor }).strict()).max(1000)
}).strict();
export type CourseSettingNote = z.infer<typeof courseSettingNoteSchema>;

export const courseSettingNotesSchema = z.object({ formatVersion: z.literal(1), raceId: uuid, notes: z.array(courseSettingNoteSchema).max(5000) }).strict();
export type CourseSettingNotes = z.infer<typeof courseSettingNotesSchema>;

/** Ny notis; fotot i base64 (högst 2 MB). */
export const courseSettingNoteCreateSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, target: courseSettingNoteTargetSchema, at: point.nullable(), course: id.nullable(), text,
  photo: z.object({ mediaType: photoTypeSchema, base64: z.string().min(4).max(Math.ceil(COURSE_SETTING_NOTE_PHOTO_MAX_BYTES * 4 / 3) + 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().nullable()
}).strict();
export type CourseSettingNoteCreate = z.infer<typeof courseSettingNoteCreateSchema>;

export const courseSettingNoteReplySchema = z.object({ formatVersion: z.literal(1), requestId: uuid, text }).strict();
export const courseSettingNoteStatusSchema = z.object({ formatVersion: z.literal(1), status: z.enum(["OPEN", "DONE"]) }).strict();

// Förslag (ADR-0181 beslut 3).
export const courseSettingSuggestionStatusSchema = z.enum(["OPEN", "APPROVED", "PARTIAL", "DECLINED"]);
export const courseSettingSuggestionSchema = z.object({
  id: uuid, baseVersion: version, edits: z.array(courseSettingEditSchema).max(COURSE_SETTING_EDITS_MAX), created: createdList,
  comment: z.string().max(2000), status: courseSettingSuggestionStatusSchema, createdAt: instant, createdBy: actor,
  decidedAt: instant.nullable(), decidedBy: actor.nullable(), decisionComment: z.string().max(2000).nullable(),
  /** Vad godkännandet gav: versionen, gjorda åtgärder (index) och avvisade. */
  result: z.object({ version: version.nullable(), applied: z.array(z.number().int().nonnegative()).max(COURSE_SETTING_EDITS_MAX),
    rejected: z.array(courseSettingRejectedEditSchema).max(COURSE_SETTING_EDITS_MAX) }).strict().nullable()
}).strict();
export type CourseSettingSuggestion = z.infer<typeof courseSettingSuggestionSchema>;

export const courseSettingSuggestionsSchema = z.object({ formatVersion: z.literal(1), raceId: uuid,
  suggestions: z.array(courseSettingSuggestionSchema).max(500) }).strict();
export type CourseSettingSuggestions = z.infer<typeof courseSettingSuggestionsSchema>;

export const courseSettingSuggestionCreateSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, baseVersion: version, edits, created: createdList, comment: z.string().trim().max(2000)
}).strict().refine(request => request.created.length === request.edits.length);
export type CourseSettingSuggestionCreate = z.infer<typeof courseSettingSuggestionCreateSchema>;

/** Godkänn (alla, eller alla utom `skip`) eller avböj, med kommentar. */
export const courseSettingSuggestionDecisionSchema = z.object({
  formatVersion: z.literal(1), requestId: uuid, decision: z.enum(["APPROVE", "DECLINE"]),
  skip: z.array(z.number().int().nonnegative()).max(COURSE_SETTING_EDITS_MAX).optional(), comment: z.string().trim().max(2000).optional()
}).strict();
export type CourseSettingSuggestionDecision = z.infer<typeof courseSettingSuggestionDecisionSchema>;

export const courseSettingSuggestionDecidedSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, suggestion: courseSettingSuggestionSchema, saved: courseSettingEditsSavedSchema.nullable()
}).strict();
export type CourseSettingSuggestionDecided = z.infer<typeof courseSettingSuggestionDecidedSchema>;

/** Ström till editorn (SSE): ny version, notiser, förslag, arbetssätt och vilka som är inne. */
export const courseSettingStreamPresenceSchema = z.array(z.object({ accountId: uuid, displayName: z.string().max(200).nullable(),
  level: courseSettingLevelSchema }).strict()).max(200);
export type CourseSettingPresence = z.infer<typeof courseSettingStreamPresenceSchema>;
