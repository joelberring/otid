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

/** Träningsläget (ADR-0192 beslut 11): delarna per id; formen kontrolleras av paketets applyEdit. */
const trainingParts = z.record(id, z.object({}).loose().nullable()).refine(record => Object.keys(record).length <= 1000);
const trainingPatch = { courses: trainingParts.optional(), areas: trainingParts.optional(), attackPoints: trainingParts.optional(),
  attackStyle: z.object({}).loose().nullable().optional() };

/** En åtgärd (`CourseSettingEdit` i `@o-tid/course-setting`). */
export const courseSettingEditSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ADD_CONTROL"), kind: z.enum(["START", "NORMAL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE", "MAP_ISSUE"]),
    at: point, code: z.string().max(32).optional() }).strict(),
  z.object({ type: z.literal("MOVE_CONTROL"), control: id, at: point }).strict(),
  // En delad kontroll flyttad bara i en bana: ny kontroll i banans kontroller (frågan när en kontroll flyttas långt).
  z.object({ type: z.literal("NEW_CONTROL_IN_COURSE"), course: id, control: id, at: point, courseControls: z.array(id).min(1).max(100),
    code: z.string().max(32).optional() }).strict(),
  z.object({ type: z.literal("DELETE_CONTROL"), control: id }).strict(),
  z.object({ type: z.literal("SET_CONTROL_CODE"), control: id, code: z.string().max(32) }).strict(),
  // ADR-0180 beslut 14: passagens vinkel och kopia av bana.
  z.object({ type: z.literal("SET_CONTROL_ORIENTATION"), control: id, orientation: z.number().finite() }).strict(),
  z.object({ type: z.literal("ADD_COURSE"), name: z.string().max(200), kind: z.enum(["NORMAL", "SCORE"]).optional() }).strict(),
  z.object({ type: z.literal("DUPLICATE_COURSE"), course: id, name: z.string().max(200) }).strict(),
  // ADR-0190: null tar bort undertitel, utskriftsskala, stigning och fast längd; banslaget och platsen i listan.
  z.object({ type: z.literal("UPDATE_COURSE"), course: id, changes: z.object({ name: z.string().max(200).optional(),
    secondaryTitle: z.string().max(400).nullable().optional(), printScale: z.number().finite().nullable().optional(),
    climbMeters: z.number().finite().nullable().optional(), lengthOverrideMeters: z.number().finite().nullable().optional(),
    kind: z.enum(["NORMAL", "SCORE"]).optional(),
    labelKind: z.enum(["SEQUENCE", "CODE", "SEQUENCE_AND_CODE", "SCORE", "CODE_AND_SCORE", "SEQUENCE_AND_SCORE"]).optional(),
    order: z.number().int().min(1).max(10_000).optional(),
    // ADR-0198: de bortvalda varianterna (ersätts helt; null = alla används).
    excludedVariants: z.array(z.object({ code: z.string().min(1).max(64), controls: z.array(z.string().max(32)).max(1000) }).strict())
      .max(5000).nullable().optional(),
    // ADR-0212: banans målnivå för nivåstödet (null = ingen).
    level: z.enum(["GRON", "VIT", "GUL", "ORANGE", "VIOLETT", "BLA", "SVART"]).nullable().optional() }).strict() }).strict(),
  z.object({ type: z.literal("SET_POINTS"), course: id, courseControl: id, points: z.number().int().min(0).max(9999).nullable() }).strict(),
  z.object({ type: z.literal("DELETE_COURSE"), course: id }).strict(),
  z.object({ type: z.literal("INSERT_COURSE_CONTROL"), course: id, control: id, after: id.nullable().optional() }).strict(),
  z.object({ type: z.literal("REMOVE_COURSE_CONTROL"), course: id, courseControl: id }).strict(),
  z.object({ type: z.literal("ADD_SPLIT"), course: id, at: id, kind: z.enum(["FORK", "LOOP"]), branches: z.number().int().min(1).max(20) }).strict(),
  z.object({ type: z.literal("REMOVE_SPLIT"), course: id, at: id }).strict(),
  // ADR-0217: `printLayout` = ett ark i en annan layout än huvudlayouten.
  z.object({ type: z.literal("MOVE_NUMBER"), course: id, courseControl: id, at: point.nullable(), printLayout: id.optional() }).strict(),
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
    // Papperets värden för {datum} och {ekvidistans} (ADR-0197).
    paperValues: z.object({ date: z.string().max(40).optional(), contourInterval: z.string().max(20).optional() }).strict().optional(),
    // Ringklippen (ADR-0180 beslut 10).
    circleCutting: z.object({ overlap: z.boolean(), details: z.boolean() }).strict().optional(),
    // Nivåstödets avvikelser i Varningar (ADR-0212).
    levelNotices: z.boolean().optional(),
    // Mellanrummet mellan sträckan och ringen (ADR-0211 beslut 2); gränserna kontrolleras av paketets applyEdit.
    legCircleGapMm: z.number().finite().optional() }).strict() }).strict(),
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
  z.object({ type: z.literal("SET_PRINT_AREA"), course: id, area: printArea.nullable(), part: z.number().int().min(0).max(50).optional(),
    printLayout: id.optional() }).strict(),
  // Utskriftsprofil och "Kartor per ark" (ADR-0183); formen kontrolleras av paketet (validatePrintProfile, validateSheetLayout).
  // `…_LAYOUT_TEMPLATE` och `layoutTemplate` är lagrade namn (historiken, dokumentet); i koden heter det SheetLayout.
  z.object({ type: z.literal("PUT_PRINT_PROFILE"), profile: z.object({ schemaVersion: z.number().int(), id }).loose() }).strict(),
  z.object({ type: z.literal("DELETE_PRINT_PROFILE"), id }).strict(),
  z.object({ type: z.literal("PUT_LAYOUT_TEMPLATE"), template: z.object({ schemaVersion: z.number().int(), id }).loose() }).strict(),
  z.object({ type: z.literal("DELETE_LAYOUT_TEMPLATE"), id }).strict(),
  // Papperet per bana (kontrollbeskrivningen på kartan); formen kontrolleras av paketet (validatePaperLayout).
  z.object({ type: z.literal("SET_PAPER_LAYOUT"), course: id, layout: z.object({ descriptions: z.object({}).loose().optional(),
    items: z.array(z.object({}).loose()).max(40).optional() }).loose().nullable(), part: z.number().int().min(0).max(50).optional(),
    printLayout: id.optional() }).strict(),
  // Baksidan per löpare (ADR-0213); formen kontrolleras av paketet (validateRunnerBack).
  z.object({ type: z.literal("SET_RUNNER_BACK"), back: z.object({ items: z.array(z.object({}).loose()).max(40) }).strict().nullable() }).strict(),
  // Papperets mallar (ADR-0197); formen kontrolleras av paketet (validatePaperTemplate).
  z.object({ type: z.literal("PUT_PAPER_TEMPLATE"), template: z.object({ schemaVersion: z.number().int(), id }).loose() }).strict(),
  z.object({ type: z.literal("DELETE_PAPER_TEMPLATE"), id }).strict(),
  z.object({ type: z.literal("PUT_OBJECTS"), controls: nullableRecord(id, part.control).optional(),
    courseControls: nullableRecord(id, part.courseControl).optional(), courses: nullableRecord(id, part.course).optional(),
    courseOrder: z.record(id, z.number().int().min(-1_000_000).max(1_000_000)).refine(record => Object.keys(record).length <= 10_000).optional(),
    legs: nullableRecord(z.string().max(140), part.leg).optional(), specialObjects: nullableRecord(id, part.specialObject).optional(),
    event: part.event.optional(),
    // Händelsens fält per namn (null = tas bort); hela dokumentet prövas mot schemat efteråt.
    eventFields: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,59}$/), z.unknown()).refine(record => Object.keys(record).length <= 100).optional(),
    training: z.object(trainingPatch).strict().optional()
  }).strict(),
  z.object({ type: z.literal("PUT_TRAINING"), ...trainingPatch }).strict(),
  // ADR-0217: Layout-fliken; formen kontrolleras av paketet (validatePrintLayout, validateLayoutSheet).
  z.object({ type: z.literal("ADD_LAYOUT"), layout: z.object({ id }).loose() }).strict(),
  z.object({ type: z.literal("UPDATE_LAYOUT"), layout: id, changes: z.object({ name: z.string().max(200).optional(), scale: z.number().finite().optional(),
    page: z.object({ width: z.number().int(), height: z.number().int(), margins: z.number().int(), landscape: z.boolean() }).strict().optional(),
    paperTemplate: id.nullable().optional(), layoutTemplate: z.string().max(200).nullable().optional() }).strict() }).strict(),
  z.object({ type: z.literal("DELETE_LAYOUT"), layout: id }).strict(),
  z.object({ type: z.literal("PUT_LAYOUT_SHEET"), layout: id, course: id, sheet: z.object({}).loose().nullable() }).strict(),
  z.object({ type: z.literal("SET_LAYOUT_CIRCLE_GAPS"), layout: id, control: id, gaps: z.array(z.object({ startDegrees: z.number().finite(),
    endDegrees: z.number().finite() }).strict()).max(100).nullable() }).strict(),
  z.object({ type: z.literal("SET_LAYOUT_LEG_GAPS"), layout: id, from: id, to: id, gaps: z.array(z.object({ start: z.number().finite(),
    length: z.number().finite() }).strict()).max(1000).nullable() }).strict(),
  z.object({ type: z.literal("CLEAR_LAYOUT_ADJUSTMENTS"), layout: id, course: id }).strict(),
  z.object({ type: z.literal("SET_CLASS_LAYOUTS"), classes: z.record(z.string().min(1).max(200), id.nullable())
    .refine(record => Object.keys(record).length <= 2000) }).strict(),
  z.object({ type: z.literal("SAVE_LAYOUT_STATE"), id, name: z.string().max(200), savedAt: instant }).strict(),
  z.object({ type: z.literal("RESTORE_LAYOUT_STATE"), id }).strict(),
  z.object({ type: z.literal("DELETE_LAYOUT_STATE"), id }).strict(),
  // ADR-0199: godtagna varningar per nyckel (null = ångra); nyckeln och lägena kontrolleras av paketet.
  z.object({ type: z.literal("SET_ACCEPTED_CHECKS"), checks: z.record(z.string().min(1).max(400),
    z.object({ at: z.record(z.string().min(1).max(80), point).refine(record => Object.keys(record).length <= 20) }).strict().nullable())
    .refine(record => Object.keys(record).length <= 5000) }).strict(),
  // Ägaren 2026-11-08: vägvalens vägar nära kontrollerna (null = ta bort); gränserna kontrolleras av paketet.
  z.object({ type: z.literal("SET_ROUTE_HINTS"), hints: z.record(z.string().min(1).max(80), z.object({ from: point, to: point,
    lines: z.array(z.array(point).min(2).max(400)).max(10) }).strict().nullable())
    .refine(record => Object.keys(record).length <= 200) }).strict()
]);

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

/** ADR-0214: kartritarens besked om ett kartfel (med länken). */
export const mapMakerVerdictSchema = z.enum(["FIXED", "NOT_FIXED"]);
export type MapMakerVerdict = z.infer<typeof mapMakerVerdictSchema>;

/**
 * Ett svar i notisens tråd. ADR-0214: kartritaren svarar med länken utan konto; då saknas `createdBy` och `mapMaker` har
 * namnet hen skrev (null = "Kartritaren"). Ett besked (`verdict`) kan ha tom text.
 */
function courseSettingNoteReplyItemSchema() {
  return z.object({ id: uuid, text: z.string().max(2000), createdAt: instant, createdBy: actor.nullable(),
    mapMaker: z.object({ name: z.string().min(1).max(80).nullable() }).strict().optional(),
    verdict: mapMakerVerdictSchema.optional(),
    /** ADR-0214 beslut 9: när svaret senast redigerades av den som skrev det ("(ändrad)"). */
    editedAt: instant.optional() }).strict()
    .refine(reply => (reply.createdBy === null) === (reply.mapMaker !== undefined), { message: "Ett svar har ett konto eller kartritarens länk" })
    .refine(reply => reply.text.trim().length > 0 || reply.verdict !== undefined, { message: "Ett svar har text" });
}
export const courseSettingNoteSchema = z.object({
  id: uuid, target: courseSettingNoteTargetSchema, kind: courseSettingNoteKindSchema,
  /** Läget när notisen skrevs (null för en bana). */
  at: point.nullable(),
  /** Banan som visades när notisen skrevs (eller som den gäller). */
  course: id.nullable(),
  text, status: z.enum(["OPEN", "DONE"]), createdAt: instant, createdBy: actor, resolvedAt: instant.nullable(), resolvedBy: actor.nullable(),
  photo: z.object({ mediaType: photoTypeSchema, bytes: z.number().int().positive().max(COURSE_SETTING_NOTE_PHOTO_MAX_BYTES) }).strict().nullable(),
  replies: z.array(courseSettingNoteReplyItemSchema()).max(1000),
  /** ADR-0214 beslut 9: när texten senast redigerades (saknas = aldrig). */
  editedAt: instant.optional()
}).strict();
export type CourseSettingNote = z.infer<typeof courseSettingNoteSchema>;
export type CourseSettingNoteReplyItem = CourseSettingNote["replies"][number];

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
/**
 * ADR-0214 beslut 9: redigera en egen notis eller ett eget svar. `expectedText` är texten som redigeringen bygger på; har
 * någon annan ändrat den sedan dess svarar servern 409 (som en versionskonflikt) och inget skrivs.
 */
export const courseSettingNoteEditSchema = z.object({ formatVersion: z.literal(1), text, expectedText: z.string().max(2000) }).strict();
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
