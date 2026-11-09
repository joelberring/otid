import type { CourseSettingEdit } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { appearanceEn, labelEn } from "./course-setting-look-en";
import { courseSettingUxEn } from "./course-setting-ux-en";
import type { EditContext, EditTexts } from "./course-setting-edits-sv";

/** Engelska del 29: åtgärderna i ett förslag i en mening (samma form som `editTextsSv`). */
const mm = (point: Point) => `${point.x.toFixed(1)}, ${point.y.toFixed(1)} mm`;
const KINDS: Record<string, string> = { START: "start", NORMAL: "control", FINISH: "finish", CROSSING_POINT: "crossing point", MAP_EXCHANGE: "map exchange",
  MAP_ISSUE: "map issue" };
const all = (course: string, ctx: EditContext) => course === "ALL_CONTROLS" ? "All controls" : ctx.course(course);
type CourseChanges = Extract<CourseSettingEdit, { type: "UPDATE_COURSE" }>["changes"];

export const editTextsEn: EditTexts = {
  newControl: "a new control",
  newCourse: "a new course",
  aControl: "a control",
  specialObject: "special object",
  fallback: "Change",
  kinds: value => courseSettingUxEn.palette.items[value]?.[0]?.toLowerCase(),
  appearance: (changes, ratio) => {
    const parts = [
      changes.circleSize !== undefined ? `circle size ${ratio(changes.circleSize)}` : undefined,
      changes.lineWidth !== undefined ? `line width ${ratio(changes.lineWidth)}` : undefined,
      changes.numberSize !== undefined ? `number size ${ratio(changes.numberSize)}` : undefined,
      changes.itemScaling !== undefined ? `scaling ${appearanceEn.scalings[changes.itemScaling].toLowerCase()}` : undefined,
      changes.autoLegGap !== undefined ? `gap at legs ${ratio(changes.autoLegGap)} mm` : undefined,
      changes.circleGapsScaled !== undefined ? `the circle gaps ${changes.circleGapsScaled ? "follow" : "do not follow"} the scaling` : undefined
    ].filter((part): part is string => part !== undefined);
    return `Appearance: ${parts.join(", ") || "unchanged"}`;
  },
  courseChanges: (changes: CourseChanges, name: string) => {
    if (changes.labelKind !== undefined && Object.keys(changes).length === 1) return `At the controls on ${name}: ${labelEn.kinds[changes.labelKind].toLowerCase()}`;
    const parts: string[] = [];
    if (changes.name !== undefined) parts.push(`new name ${changes.name}`);
    if ("secondaryTitle" in changes) parts.push(changes.secondaryTitle ? `classes ${changes.secondaryTitle}` : "no classes");
    if ("printScale" in changes) parts.push(changes.printScale ? `print scale 1:${changes.printScale}` : "the map's scale");
    if ("climbMeters" in changes) parts.push(changes.climbMeters === null || changes.climbMeters === undefined ? "no climb" : `climb ${changes.climbMeters} m`);
    if ("lengthOverrideMeters" in changes) parts.push(changes.lengthOverrideMeters ? `fixed length ${changes.lengthOverrideMeters} m` : "calculated length");
    if (changes.kind !== undefined) parts.push(changes.kind === "SCORE" ? "score course" : "normal course");
    if (changes.labelKind !== undefined) parts.push(`at the controls: ${labelEn.kinds[changes.labelKind].toLowerCase()}`);
    if (changes.order !== undefined) parts.push(`place ${changes.order} in the list`);
    if (parts.length === 0) return `Change the course ${name}`;
    const text = parts.join(", ");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} on ${name}`;
  },
  describe: {
    ADD_CONTROL: edit => `New ${KINDS[edit.kind] ?? "control"}${edit.code ? ` ${edit.code}` : ""} at ${mm(edit.at)}`,
    MOVE_CONTROL: (edit, ctx) => {
      const distance = ctx.moved(edit.control, edit.at);
      return `Move ${ctx.label(edit.control)}${distance !== undefined ? ` ${Math.round(distance)} m` : ""}`;
    },
    NEW_CONTROL_IN_COURSE: (edit, ctx) => `New control${edit.code ? ` ${edit.code}` : ""} instead of ${ctx.label(edit.control)} only on ${ctx.course(edit.course)}`,
    DELETE_CONTROL: (edit, ctx) => `Delete ${ctx.label(edit.control)}`,
    SET_CONTROL_CODE: (edit, ctx) => `New code ${edit.code} for ${ctx.label(edit.control)}`,
    SET_CONTROL_ORIENTATION: (edit, ctx) => `Turn ${ctx.label(edit.control)} to ${Math.round(edit.orientation)}°`,
    DUPLICATE_COURSE: (edit, ctx) => `Copy the course ${ctx.course(edit.course)} as ${edit.name}`,
    ADD_COURSE: edit => `New course ${edit.name}`,
    SET_POINTS: (edit, ctx) => `${edit.points ? `${edit.points} points` : "No points"} for ${ctx.onCourse(edit.courseControl)} on ${ctx.course(edit.course)}`,
    DELETE_COURSE: (edit, ctx) => `Remove the course ${ctx.course(edit.course)}`,
    INSERT_COURSE_CONTROL: (edit, ctx) => `Insert ${ctx.label(edit.control)} on ${ctx.course(edit.course)}`,
    REMOVE_COURSE_CONTROL: (edit, ctx) => `Remove ${ctx.onCourse(edit.courseControl)} from ${ctx.course(edit.course)}`,
    ADD_SPLIT: (edit, ctx) => `${edit.kind === "FORK" ? "Fork" : "Loop"} at ${ctx.onCourse(edit.at)} on ${ctx.course(edit.course)}`,
    REMOVE_SPLIT: (edit, ctx) => `Remove the fork at ${ctx.onCourse(edit.at)}`,
    MOVE_NUMBER: (edit, ctx) => `Move the number for ${ctx.onCourse(edit.courseControl)}`,
    SET_LEG_BENDS: (edit, ctx) => `Bend points on the leg ${ctx.label(edit.from)}–${ctx.label(edit.to)}`,
    SET_LEG_GAPS: (edit, ctx) => `Gaps on the leg ${ctx.label(edit.from)}–${ctx.label(edit.to)}`,
    SET_CIRCLE_GAPS: (edit, ctx) => `Gaps in the circle for ${ctx.label(edit.control)}`,
    SET_EVENT: () => "Change the settings",
    SET_DESCRIPTION: (edit, ctx) => `The description for ${ctx.label(edit.control)}`,
    SET_DESCRIPTION_TEXT_LINE: (edit, ctx) => `The text line ${edit.location === "before" ? "before" : "after"} ${ctx.label(edit.control)}`,
    PUT_OBJECTS: () => "Undo a change",
    ADD_SPECIAL: (edit, ctx) => `New object: ${ctx.kind(edit.special.kind)}`,
    MOVE_SPECIAL: (edit, ctx) => `Move ${ctx.special(edit.special)}`,
    UPDATE_SPECIAL: (edit, ctx) => `Change ${ctx.special(edit.special)}`,
    DELETE_SPECIAL: (edit, ctx) => `Delete ${ctx.special(edit.special)}`,
    SET_PAPER_LAYOUT: (edit, ctx) => `The paper for ${all(edit.course, ctx)}`,
    PUT_PAPER_TEMPLATE: edit => `The paper template ${edit.template.name}`,
    DELETE_PAPER_TEMPLATE: (edit, ctx) => `Delete the paper template ${ctx.paperTemplateName(edit.id) ?? ""}`.trim(),
    SET_PRINT_AREA: (edit, ctx) => `The print area for ${all(edit.course, ctx)}`,
    PUT_PRINT_PROFILE: edit => `The print profile ${edit.profile.name}`,
    DELETE_PRINT_PROFILE: (edit, ctx) => `Delete the print profile ${ctx.profileName(edit.id) ?? ""}`.trim(),
    PUT_LAYOUT_TEMPLATE: edit => `Maps per sheet: ${edit.template.name}`,
    DELETE_LAYOUT_TEMPLATE: (edit, ctx) => `Maps per sheet: delete ${ctx.templateName(edit.id) ?? ""}`.trim(),
    PUT_TRAINING: (edit, ctx) => {
      const courses = Object.keys(edit.courses ?? {}).map(id => ctx.course(id));
      if (courses.length > 0) return `The training for ${courses.join(", ")}`;
      if (edit.attackPoints) return "Last safe point";
      if (edit.areas) return "The training's areas";
      return "The training";
    }
  }
};
