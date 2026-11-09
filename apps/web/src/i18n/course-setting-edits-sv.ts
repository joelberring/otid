import type { Appearance, CourseSettingEdit } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { appearanceSv, labelSv } from "./course-setting-appearance-sv";
import { coursePrintSv } from "./course-setting-print-sv";

/**
 * Steg 66 (ADR-0181 beslut 3): åtgärderna i ett förslag i en mening, för listan där man väljer vilka som godkänns. Lib-delen
 * (`course-setting-suggestion.ts`) ger namnen på kontroller, banor och objekt; här står bara texten.
 */
export interface EditContext {
  /** Kontrollens namn ("kontroll 31") eller "en ny kontroll". */
  readonly label: (id: string) => string;
  readonly course: (id: string) => string;
  /** Kontrollen bakom en bankontroll. */
  readonly onCourse: (id: string) => string;
  /** Ett specialobjekts slag i klartext. */
  readonly special: (id: string) => string;
  readonly kind: (value: string | undefined) => string;
  readonly profileName: (id: string) => string | undefined;
  readonly templateName: (id: string) => string | undefined;
  readonly paperTemplateName: (id: string) => string | undefined;
  /** Flyttens längd i meter i terrängen, när kontrollen fanns. */
  readonly moved: (control: string, at: Point) => number | undefined;
  /** Kvoten skriven med sidans decimaltecken. */
  readonly ratio: (value: number) => string;
}

type Describe = { readonly [K in CourseSettingEdit["type"]]?: (edit: Extract<CourseSettingEdit, { type: K }>, ctx: EditContext) => string };

export interface EditTexts {
  readonly newControl: string;
  readonly newCourse: string;
  readonly aControl: string;
  readonly specialObject: string;
  readonly fallback: string;
  readonly kinds: (value: string) => string | undefined;
  readonly appearance: (changes: Partial<Appearance>, ratio: (value: number) => string) => string;
  readonly courseChanges: (changes: CourseChanges, name: string) => string;
  readonly describe: Describe;
}

type CourseChanges = Extract<CourseSettingEdit, { type: "UPDATE_COURSE" }>["changes"];

const mm = (point: Point) => `${point.x.toFixed(1)}, ${point.y.toFixed(1)} mm`;
const KINDS: Record<string, string> = { START: "start", NORMAL: "kontroll", FINISH: "mål", CROSSING_POINT: "passage", MAP_EXCHANGE: "kartbyte",
  MAP_ISSUE: "kartutdelning" };
const all = (course: string, ctx: EditContext) => course === "ALL_CONTROLS" ? "Alla kontroller" : ctx.course(course);

export const editTextsSv: EditTexts = {
  newControl: "en ny kontroll",
  newCourse: "en ny bana",
  aControl: "en kontroll",
  specialObject: "specialobjekt",
  fallback: "Ändring",
  kinds: value => coursePrintSv.kinds[value]?.toLowerCase(),
  /** "Utseende: ringstorlek 1,12, skalning relativt 1:15 000". */
  appearance: (changes, ratio) => {
    const parts = [
      changes.circleSize !== undefined ? `ringstorlek ${ratio(changes.circleSize)}` : undefined,
      changes.lineWidth !== undefined ? `linjebredd ${ratio(changes.lineWidth)}` : undefined,
      changes.numberSize !== undefined ? `nummerstorlek ${ratio(changes.numberSize)}` : undefined,
      changes.itemScaling !== undefined ? `skalning ${appearanceSv.scalings[changes.itemScaling].toLowerCase()}` : undefined,
      changes.autoLegGap !== undefined ? `avbrott vid sträckor ${ratio(changes.autoLegGap)} mm` : undefined,
      changes.circleGapsScaled !== undefined ? `ringavbrotten ${changes.circleGapsScaled ? "följer" : "följer inte"} skalningen` : undefined
    ].filter((part): part is string => part !== undefined);
    return `Utseende: ${parts.join(", ") || "oförändrat"}`;
  },
  /** ADR-0190: banans egenskaper i en mening ("Stigning 85 m på Lång"); flera ändringar i samma åtgärd skiljs med komma. */
  courseChanges: (changes, name) => {
    if (changes.labelKind !== undefined && Object.keys(changes).length === 1) return `Vid kontrollerna på ${name}: ${labelSv.kinds[changes.labelKind].toLowerCase()}`;
    const parts: string[] = [];
    if (changes.name !== undefined) parts.push(`nytt namn ${changes.name}`);
    if ("secondaryTitle" in changes) parts.push(changes.secondaryTitle ? `klasser ${changes.secondaryTitle}` : "inga klasser");
    if ("printScale" in changes) parts.push(changes.printScale ? `utskriftsskala 1:${changes.printScale}` : "kartans skala");
    if ("climbMeters" in changes) parts.push(changes.climbMeters === null || changes.climbMeters === undefined ? "ingen stigning" : `stigning ${changes.climbMeters} m`);
    if ("lengthOverrideMeters" in changes) parts.push(changes.lengthOverrideMeters ? `fast längd ${changes.lengthOverrideMeters} m` : "uträknad längd");
    if (changes.kind !== undefined) parts.push(changes.kind === "SCORE" ? "poängbana" : "vanlig bana");
    if (changes.labelKind !== undefined) parts.push(`vid kontrollerna: ${labelSv.kinds[changes.labelKind].toLowerCase()}`);
    if (changes.order !== undefined) parts.push(`plats ${changes.order} i listan`);
    if (parts.length === 0) return `Ändra banan ${name}`;
    const text = parts.join(", ");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} på ${name}`;
  },
  describe: {
    ADD_CONTROL: edit => `Ny ${KINDS[edit.kind] ?? "kontroll"}${edit.code ? ` ${edit.code}` : ""} vid ${mm(edit.at)}`,
    MOVE_CONTROL: (edit, ctx) => {
      const distance = ctx.moved(edit.control, edit.at);
      return `Flytta ${ctx.label(edit.control)}${distance !== undefined ? ` ${Math.round(distance)} m` : ""}`;
    },
    NEW_CONTROL_IN_COURSE: (edit, ctx) => `Ny kontroll${edit.code ? ` ${edit.code}` : ""} i stället för ${ctx.label(edit.control)} bara på ${ctx.course(edit.course)}`,
    DELETE_CONTROL: (edit, ctx) => `Ta bort ${ctx.label(edit.control)}`,
    SET_CONTROL_CODE: (edit, ctx) => `Ny kod ${edit.code} för ${ctx.label(edit.control)}`,
    SET_CONTROL_ORIENTATION: (edit, ctx) => `Vrid ${ctx.label(edit.control)} till ${Math.round(edit.orientation)}°`,
    DUPLICATE_COURSE: (edit, ctx) => `Kopiera banan ${ctx.course(edit.course)} som ${edit.name}`,
    ADD_COURSE: edit => `Ny bana ${edit.name}`,
    SET_POINTS: (edit, ctx) => `${edit.points ? `${edit.points} poäng` : "Inga poäng"} för ${ctx.onCourse(edit.courseControl)} på ${ctx.course(edit.course)}`,
    DELETE_COURSE: (edit, ctx) => `Ta bort banan ${ctx.course(edit.course)}`,
    INSERT_COURSE_CONTROL: (edit, ctx) => `Lägg in ${ctx.label(edit.control)} på ${ctx.course(edit.course)}`,
    REMOVE_COURSE_CONTROL: (edit, ctx) => `Ta bort ${ctx.onCourse(edit.courseControl)} från ${ctx.course(edit.course)}`,
    ADD_SPLIT: (edit, ctx) => `${edit.kind === "FORK" ? "Gaffling" : "Slinga"} vid ${ctx.onCourse(edit.at)} på ${ctx.course(edit.course)}`,
    REMOVE_SPLIT: (edit, ctx) => `Ta bort gafflingen vid ${ctx.onCourse(edit.at)}`,
    MOVE_NUMBER: (edit, ctx) => `Flytta numret för ${ctx.onCourse(edit.courseControl)}`,
    SET_LEG_BENDS: (edit, ctx) => `Brytpunkter på sträckan ${ctx.label(edit.from)}–${ctx.label(edit.to)}`,
    SET_LEG_GAPS: (edit, ctx) => `Avbrott på sträckan ${ctx.label(edit.from)}–${ctx.label(edit.to)}`,
    SET_CIRCLE_GAPS: (edit, ctx) => `Avbrott i ringen för ${ctx.label(edit.control)}`,
    SET_EVENT: () => "Ändra inställningarna",
    SET_DESCRIPTION: (edit, ctx) => `Beskrivningen för ${ctx.label(edit.control)}`,
    SET_DESCRIPTION_TEXT_LINE: (edit, ctx) => `Textraden ${edit.location === "before" ? "före" : "efter"} ${ctx.label(edit.control)}`,
    PUT_OBJECTS: () => "Ångra en ändring",
    // Översynen 2026-11-02: specialobjekt, tryckyta, utskriftsprofiler och layoutmallar.
    ADD_SPECIAL: (edit, ctx) => `Nytt objekt: ${ctx.kind(edit.special.kind)}`,
    MOVE_SPECIAL: (edit, ctx) => `Flytta ${ctx.special(edit.special)}`,
    UPDATE_SPECIAL: (edit, ctx) => `Ändra ${ctx.special(edit.special)}`,
    DELETE_SPECIAL: (edit, ctx) => `Ta bort ${ctx.special(edit.special)}`,
    SET_PAPER_LAYOUT: (edit, ctx) => `Papperet för ${all(edit.course, ctx)}`,
    PUT_PAPER_TEMPLATE: edit => `Mallen för papperet ${edit.template.name}`,
    DELETE_PAPER_TEMPLATE: (edit, ctx) => `Ta bort mallen för papperet ${ctx.paperTemplateName(edit.id) ?? ""}`.trim(),
    SET_PRINT_AREA: (edit, ctx) => `Tryckytan för ${all(edit.course, ctx)}`,
    PUT_PRINT_PROFILE: edit => `Utskriftsprofilen ${edit.profile.name}`,
    DELETE_PRINT_PROFILE: (edit, ctx) => `Ta bort utskriftsprofilen ${ctx.profileName(edit.id) ?? ""}`.trim(),
    PUT_LAYOUT_TEMPLATE: edit => `Kartor per ark: ${edit.template.name}`,
    DELETE_LAYOUT_TEMPLATE: (edit, ctx) => `Kartor per ark: ta bort ${ctx.templateName(edit.id) ?? ""}`.trim(),
    // ADR-0192: träningsläget.
    PUT_TRAINING: (edit, ctx) => {
      const courses = Object.keys(edit.courses ?? {}).map(id => ctx.course(id));
      if (courses.length > 0) return `Träningen för ${courses.join(", ")}`;
      if (edit.attackPoints) return "Sista säkra";
      if (edit.areas) return "Träningens områden";
      return "Träningen";
    }
  }
};
