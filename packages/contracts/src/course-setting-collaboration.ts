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

const specialFields = z.object({
  orientation: z.number().finite().optional(), stretch: z.number().finite().optional(), text: z.string().max(4000).optional(),
  font: z.object({ name: z.string().min(1).max(100), bold: z.boolean(), italic: z.boolean(), height: z.number().finite().optional() }).strict().optional(),
  color: z.string().max(80).optional(), columns: z.number().int().optional(),
  line: z.object({ kind: z.enum(["single", "double", "dashed"]), width: z.number().finite(), gapSize: z.number().finite(), dashSize: z.number().finite(),
    cornerRadius: z.number().finite().optional() }).strict().optional()
});
const specialInput = specialFields.extend({
  kind: z.enum(["first-aid", "water", "optional-crossing-point", "forbidden-route", "registration-mark", "boundary", "out-of-bounds",
    "dangerous-area", "temporary-construction", "white-out", "text", "descriptions", "image", "line", "rectangle", "ellipse"]),
  points: z.array(point).min(1).max(10_000), courses: z.array(id).max(1000).optional(),
  image: z.object({ format: z.string().min(1).max(16), data: z.string().max(COURSE_SETTING_DOCUMENT_MAX_BYTES) }).strict().optional()
}).strict();
const printArea = z.object({ automatic: z.boolean(), restrictToPageSize: z.boolean(),
  rect: z.object({ minX: part.mm, minY: part.mm, maxX: part.mm, maxY: part.mm }).strict().optional(),
  page: z.object({ width: z.number().int(), height: z.number().int(), margins: z.number().int(), landscape: z.boolean() }).strict().optional() }).strict();

/** En åtgärd (`CourseSettingEdit` i `@o-tid/course-setting`). */
export const courseSettingEditSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ADD_CONTROL"), kind: z.enum(["START", "NORMAL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE", "MAP_ISSUE"]),
    at: point, code: z.string().max(32).optional() }).strict(),
  z.object({ type: z.literal("MOVE_CONTROL"), control: id, at: point }).strict(),
  z.object({ type: z.literal("DELETE_CONTROL"), control: id }).strict(),
  z.object({ type: z.literal("SET_CONTROL_CODE"), control: id, code: z.string().max(32) }).strict(),
  // ADR-0180 beslut 14: passagens vinkel och kopia av bana.
  z.object({ type: z.literal("SET_CONTROL_ORIENTATION"), control: id, orientation: z.number().finite() }).strict(),
  z.object({ type: z.literal("ADD_COURSE"), name: z.string().max(200), kind: z.enum(["NORMAL", "SCORE"]).optional() }).strict(),
  z.object({ type: z.literal("DUPLICATE_COURSE"), course: id, name: z.string().max(200) }).strict(),
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
    descriptionLanguage: z.string().max(16).optional(), allControlsPrintScale: z.number().finite().optional(),
    printProfileId: id.optional(),
    // Ringklippen (ADR-0180 beslut 10).
    circleCutting: z.object({ overlap: z.boolean(), details: z.boolean() }).strict().optional() }).strict() }).strict(),
  // Banans utseende (ADR-0180 beslut 12); gränserna kontrolleras av paketets applyEdit.
  z.object({ type: z.literal("SET_APPEARANCE"), changes: z.object({ itemScaling: z.enum(["None", "RelativeToMap", "RelativeTo15000"]).optional(),
    circleSize: z.number().finite().optional(), lineWidth: z.number().finite().optional(), numberSize: z.number().finite().optional(),
    autoLegGap: z.number().finite().optional(), circleGapsScaled: z.boolean().optional() }).strict() }).strict(),
  z.object({ type: z.literal("SET_DESCRIPTION"), control: id, boxes: z.array(z.object({ box: z.string().max(8), ref: z.string().max(32).optional(),
    text: z.string().max(64).optional() }).strict()).max(16) }).strict(),
  z.object({ type: z.literal("SET_DESCRIPTION_TEXT_LINE"), control: id, location: z.enum(["before", "after"]), text: z.string().max(400).nullable() }).strict(),
  // Steg 64: specialobjekt och tryckyta (fälten kontrolleras av paketets applyEdit).
  z.object({ type: z.literal("ADD_SPECIAL"), special: specialInput }).strict(),
  z.object({ type: z.literal("MOVE_SPECIAL"), special: id, points: z.array(point).min(1).max(10_000) }).strict(),
  z.object({ type: z.literal("UPDATE_SPECIAL"), special: id, changes: specialFields.extend({ courses: z.array(id).max(1000).optional() }).strict() }).strict(),
  z.object({ type: z.literal("DELETE_SPECIAL"), special: id }).strict(),
  z.object({ type: z.literal("SET_PRINT_AREA"), course: id, area: printArea.nullable() }).strict(),
  // Utskriftsprofil och layoutmall (ADR-0183); formen kontrolleras av paketet (validatePrintProfile, validateLayoutTemplate).
  z.object({ type: z.literal("PUT_PRINT_PROFILE"), profile: z.object({ schemaVersion: z.number().int(), id }).loose() }).strict(),
  z.object({ type: z.literal("DELETE_PRINT_PROFILE"), id }).strict(),
  z.object({ type: z.literal("PUT_LAYOUT_TEMPLATE"), template: z.object({ schemaVersion: z.number().int(), id }).loose() }).strict(),
  z.object({ type: z.literal("DELETE_LAYOUT_TEMPLATE"), id }).strict(),
  z.object({ type: z.literal("PUT_OBJECTS"), controls: nullableRecord(id, part.control).optional(),
    courseControls: nullableRecord(id, part.courseControl).optional(), courses: nullableRecord(id, part.course).optional(),
    legs: nullableRecord(z.string().max(140), part.leg).optional(), specialObjects: nullableRecord(id, part.specialObject).optional(),
    event: part.event.optional() }).strict()
]);
export type CourseSettingEditDto = z.infer<typeof courseSettingEditSchema>;

/** Id som en åtgärd skapade hos författaren (`CreatedIds`). */
export const courseSettingCreatedIdsSchema = z.object({ controls: z.array(id).max(1000), courseControls: z.array(id).max(1000),
  courses: z.array(id).max(1000), specialObjects: z.array(id).max(1000).optional() }).strict();
const idMapSchema = z.object({ controls: z.record(id, id), courseControls: z.record(id, id), courses: z.record(id, id),
  specialObjects: z.record(id, id).optional() }).strict();
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
/**
 * ADR-0181 beslut 8: en ritning i notisen (linjer och ytor i kartans mm). Slaget ger färgen: kartfel röd, snitsel och
 * markering orange, allmänt blå. `intent`: "är fel" streckad, "ska vara här" heldragen med pil, null bara markering.
 * Antalet punkter är begränsat (webbläsaren förenklar en frihandslinje innan den sparas).
 */
export const COURSE_SETTING_SKETCH_MAX_SHAPES = 20;
export const COURSE_SETTING_SKETCH_MAX_POINTS = 1000;
export const COURSE_SETTING_SKETCH_STYLES = ["MAP_ERROR", "MARKING", "GENERAL"] as const;
export const courseSettingSketchShapeSchema = z.object({
  kind: z.enum(["LINE", "AREA"]), style: z.enum(COURSE_SETTING_SKETCH_STYLES), intent: z.enum(["WRONG", "RIGHT"]).nullable(),
  points: z.array(point).min(2).max(COURSE_SETTING_SKETCH_MAX_POINTS)
}).strict().refine(shape => shape.kind === "LINE" || shape.points.length >= 3, { message: "En yta har minst tre punkter" });
export type CourseSettingSketchShape = z.infer<typeof courseSettingSketchShapeSchema>;
export const courseSettingSketchSchema = z.array(courseSettingSketchShapeSchema).min(1).max(COURSE_SETTING_SKETCH_MAX_SHAPES)
  .refine(shapes => shapes.reduce((sum, shape) => sum + shape.points.length, 0) <= COURSE_SETTING_SKETCH_MAX_POINTS,
    { message: `Högst ${COURSE_SETTING_SKETCH_MAX_POINTS} punkter i en ritning` });

export const courseSettingNoteTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("POINT"), at: point }).strict(),
  z.object({ kind: z.literal("CONTROL"), control: id }).strict(),
  z.object({ kind: z.literal("LEG"), from: id, to: id }).strict(),
  z.object({ kind: z.literal("COURSE"), course: id }).strict(),
  z.object({ kind: z.literal("SKETCH"), shapes: courseSettingSketchSchema }).strict()
]);
export type CourseSettingNoteTarget = z.infer<typeof courseSettingNoteTargetSchema>;
/**
 * Notisens slag: banläggning (förval) eller kartfel. Ett kartfel sitter på en punkt eller en ritning, aldrig på en kontroll,
 * en sträcka eller en bana (exporten till kartritaren får inte avslöja banorna, ADR-0181 beslut 8).
 */
export const courseSettingNoteKindSchema = z.enum(["COURSE_SETTING", "MAP_ERROR"]);
export type CourseSettingNoteKind = z.infer<typeof courseSettingNoteKindSchema>;
/** Ritningens mitt (rutan runt alla punkter): notisens läge i listan och på kartan. */
export function sketchCenter(shapes: readonly { readonly points: readonly { x: number; y: number }[] }[]): { x: number; y: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of shapes) for (const at of shape.points) {
    minX = Math.min(minX, at.x); maxX = Math.max(maxX, at.x); minY = Math.min(minY, at.y); maxY = Math.max(maxY, at.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 };
  return { x: Math.round((minX + maxX) / 2 * 100) / 100, y: Math.round((minY + maxY) / 2 * 100) / 100 };
}
export const mapErrorTargetAllowed = (target: CourseSettingNoteTarget) => target.kind === "POINT" || target.kind === "SKETCH";

const photoTypeSchema = z.enum(COURSE_SETTING_NOTE_PHOTO_TYPES);
export const courseSettingNoteSchema = z.object({
  id: uuid, target: courseSettingNoteTargetSchema, kind: courseSettingNoteKindSchema,
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
    .regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().nullable(),
  /** Saknas = banläggning (köer i telefonen från före beslut 8). */
  kind: courseSettingNoteKindSchema.optional()
}).strict().refine(request => request.kind !== "MAP_ERROR" || mapErrorTargetAllowed(request.target),
  { message: "Ett kartfel sitter på en punkt eller en ritning" });
export type CourseSettingNoteCreate = z.infer<typeof courseSettingNoteCreateSchema>;

export const courseSettingNoteReplySchema = z.object({ formatVersion: z.literal(1), requestId: uuid, text }).strict();
export const courseSettingNoteStatusSchema = z.object({ formatVersion: z.literal(1), status: z.enum(["OPEN", "DONE"]) }).strict();

// Kollad (steg 67, ADR-0181 beslut 6): per kontroll, utanför dokumentet.
/** En kollad kontroll: vem, när och var kontrollen låg då (mm; null om den inte fanns i dokumentet). */
export const courseSettingInspectionSchema = z.object({ control: id, checkedAt: instant, checkedBy: actor, at: point.nullable() }).strict();
export type CourseSettingInspection = z.infer<typeof courseSettingInspectionSchema>;

export const courseSettingInspectionsSchema = z.object({ formatVersion: z.literal(1), raceId: uuid,
  inspections: z.array(courseSettingInspectionSchema).max(5000) }).strict();
export type CourseSettingInspections = z.infer<typeof courseSettingInspectionsSchema>;

/**
 * Bocka i eller av. `at` är när det gjordes i telefonen (en kö utan nät skickar senare); den senaste vinner, så en äldre
 * bock eller avbockning ändrar inte en nyare. `position` är kontrollens läge i telefonens dokument då.
 */
export const courseSettingInspectionRequestSchema = z.object({ formatVersion: z.literal(1), control: id, checked: z.boolean(), at: instant,
  position: point.nullable() }).strict();
export type CourseSettingInspectionRequest = z.infer<typeof courseSettingInspectionRequestSchema>;

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
export const courseSettingStreamBySchema = z.object({ by: z.string().max(64) });
export const courseSettingStreamVersionSchema = courseSettingStreamBySchema.extend({ version });
