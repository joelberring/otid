import type { CourseSettingSuggestion } from "@o-tid/contracts";
import {
  replayEdits, type Appearance, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds, type ReplayRejection
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { appearanceSv, labelSv } from "../i18n/course-setting-appearance-sv";
import { coursePrintSv } from "../i18n/course-setting-print-sv";
import { formatRatio } from "./course-setting-appearance";
import { controlLabel } from "./course-setting-text";

/**
 * Steg 66 (ADR-0181 beslut 3): förslagen. Ett förslag spelas upp på en kopia av den aktuella versionen (paketets
 * `replayEdits`, samma som när det godkänns) och jämförs med den: flyttade kontroller (pil från gammalt till nytt läge),
 * nya (streckade) och borttagna (överstrukna). Åtgärderna beskrivs i text för listan där man väljer vilka som godkänns.
 */
export interface SuggestionPreview {
  readonly document: CourseSettingDocument;
  readonly rejected: readonly ReplayRejection[];
}

/** Förslaget på den aktuella versionen (utom åtgärderna i `skip`). */
export function previewSuggestion(current: CourseSettingDocument, suggestion: Pick<CourseSettingSuggestion, "edits" | "created">,
  skip: ReadonlySet<number> = new Set()): SuggestionPreview {
  const result = replayEdits(current, suggestion.edits as CourseSettingEdit[], { created: suggestion.created as CreatedIds[], skip });
  return { document: result.document, rejected: result.rejected };
}

export interface SuggestionOverlay {
  readonly moved: readonly { readonly control: string; readonly from: Point; readonly to: Point }[];
  readonly added: readonly { readonly control: string; readonly at: Point }[];
  readonly removed: readonly { readonly control: string; readonly at: Point }[];
}

/** Skillnaderna i kontrollernas lägen mellan den aktuella versionen och förslaget. */
export function suggestionOverlay(current: CourseSettingDocument, proposed: CourseSettingDocument): SuggestionOverlay {
  const moved: { control: string; from: Point; to: Point }[] = [], added: { control: string; at: Point }[] = [];
  const removed: { control: string; at: Point }[] = [];
  for (const [id, control] of Object.entries(proposed.controls)) {
    const before = current.controls[id];
    if (!before) added.push({ control: id, at: control.at });
    else if (before.at.x !== control.at.x || before.at.y !== control.at.y) moved.push({ control: id, from: before.at, to: control.at });
  }
  for (const [id, control] of Object.entries(current.controls)) if (!proposed.controls[id]) removed.push({ control: id, at: control.at });
  return { moved, added, removed };
}

/** Utseendet i en mening: "Utseende: ringstorlek 1,12, skalning relativt 1:15 000". */
function describeAppearance(changes: Partial<Appearance>): string {
  const ratio = (value: number) => formatRatio(value).replace(".", ",");
  const parts = [
    changes.circleSize !== undefined ? `ringstorlek ${ratio(changes.circleSize)}` : undefined,
    changes.lineWidth !== undefined ? `linjebredd ${ratio(changes.lineWidth)}` : undefined,
    changes.numberSize !== undefined ? `nummerstorlek ${ratio(changes.numberSize)}` : undefined,
    changes.itemScaling !== undefined ? `skalning ${appearanceSv.scalings[changes.itemScaling].toLowerCase()}` : undefined,
    changes.autoLegGap !== undefined ? `avbrott vid sträckor ${ratio(changes.autoLegGap)} mm` : undefined,
    changes.circleGapsScaled !== undefined ? `ringavbrotten ${changes.circleGapsScaled ? "följer" : "följer inte"} skalningen` : undefined
  ].filter((part): part is string => part !== undefined);
  return `Utseende: ${parts.join(", ") || "oförändrat"}`;
}

const mm = (point: Point) => `${point.x.toFixed(1)}, ${point.y.toFixed(1)} mm`;
const KINDS: Record<string, string> = { START: "start", NORMAL: "kontroll", FINISH: "mål", CROSSING_POINT: "passage", MAP_EXCHANGE: "kartbyte",
  MAP_ISSUE: "kartutdelning" };

/** ADR-0190: banans egenskaper i en mening ("Stigning 85 m på Lång"); flera ändringar i samma åtgärd skiljs med komma. */
function describeCourseChanges(changes: Extract<CourseSettingEdit, { type: "UPDATE_COURSE" }>["changes"], name: string): string {
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
}

/** Åtgärden i en mening, med kontrollernas koder i dokumentet som förslaget gjordes mot (eller det aktuella). */
export function describeEdit(edit: CourseSettingEdit, document: CourseSettingDocument): string {
  const label = (id: string) => document.controls[id] ? controlLabel(document, id) : "en ny kontroll";
  const course = (id: string) => document.courses.find(row => row.id === id)?.name ?? "en ny bana";
  const onCourse = (id: string) => { const control = document.courseControls[id]?.control; return control ? label(control) : "en kontroll"; };
  const kind = (value: string | undefined) => (value ? coursePrintSv.kinds[value] : undefined)?.toLowerCase() ?? "specialobjekt";
  const special = (id: string) => kind(document.specialObjects.find(row => row.id === id)?.kind);
  const profileName = (id: string) => document.event.printProfiles?.find(row => row.id === id)?.name;
  const templateName = (id: string) => document.event.layoutTemplates?.find(row => row.id === id)?.name;
  switch (edit.type) {
    case "ADD_CONTROL": return `Ny ${KINDS[edit.kind] ?? "kontroll"}${edit.code ? ` ${edit.code}` : ""} vid ${mm(edit.at)}`;
    case "MOVE_CONTROL": {
      const before = document.controls[edit.control]?.at;
      const distance = before ? Math.hypot(edit.at.x - before.x, edit.at.y - before.y) * document.event.mapScale / 1000 : undefined;
      return `Flytta ${label(edit.control)}${distance !== undefined ? ` ${Math.round(distance)} m` : ""}`;
    }
    case "NEW_CONTROL_IN_COURSE": return `Ny kontroll${edit.code ? ` ${edit.code}` : ""} i stället för ${label(edit.control)} bara på ${course(edit.course)}`;
    case "DELETE_CONTROL": return `Ta bort ${label(edit.control)}`;
    case "SET_CONTROL_CODE": return `Ny kod ${edit.code} för ${label(edit.control)}`;
    case "SET_CONTROL_ORIENTATION": return `Vrid ${label(edit.control)} till ${Math.round(edit.orientation)}°`;
    case "DUPLICATE_COURSE": return `Kopiera banan ${course(edit.course)} som ${edit.name}`;
    case "ADD_COURSE": return `Ny bana ${edit.name}`;
    case "UPDATE_COURSE": return describeCourseChanges(edit.changes, course(edit.course));
    case "SET_POINTS": return `${edit.points ? `${edit.points} poäng` : "Inga poäng"} för ${onCourse(edit.courseControl)} på ${course(edit.course)}`;
    case "DELETE_COURSE": return `Ta bort banan ${course(edit.course)}`;
    case "INSERT_COURSE_CONTROL": return `Lägg in ${label(edit.control)} på ${course(edit.course)}`;
    case "REMOVE_COURSE_CONTROL": return `Ta bort ${onCourse(edit.courseControl)} från ${course(edit.course)}`;
    case "ADD_SPLIT": return `${edit.kind === "FORK" ? "Gaffling" : "Slinga"} vid ${onCourse(edit.at)} på ${course(edit.course)}`;
    case "REMOVE_SPLIT": return `Ta bort gafflingen vid ${onCourse(edit.at)}`;
    case "MOVE_NUMBER": return `Flytta numret för ${onCourse(edit.courseControl)}`;
    case "SET_LEG_BENDS": return `Brytpunkter på sträckan ${label(edit.from)}–${label(edit.to)}`;
    case "SET_LEG_GAPS": return `Avbrott på sträckan ${label(edit.from)}–${label(edit.to)}`;
    case "SET_CIRCLE_GAPS": return `Avbrott i ringen för ${label(edit.control)}`;
    case "SET_EVENT": return "Ändra inställningarna";
    case "SET_APPEARANCE": return describeAppearance(edit.changes);
    case "SET_DESCRIPTION": return `Beskrivningen för ${label(edit.control)}`;
    case "SET_DESCRIPTION_TEXT_LINE": return `Textraden ${edit.location === "before" ? "före" : "efter"} ${label(edit.control)}`;
    case "PUT_OBJECTS": return "Ångra en ändring";
    // Översynen 2026-11-02: specialobjekt, tryckyta, utskriftsprofiler och layoutmallar.
    case "ADD_SPECIAL": return `Nytt objekt: ${kind(edit.special.kind)}`;
    case "MOVE_SPECIAL": return `Flytta ${special(edit.special)}`;
    case "UPDATE_SPECIAL": return `Ändra ${special(edit.special)}`;
    case "DELETE_SPECIAL": return `Ta bort ${special(edit.special)}`;
    case "SET_PAPER_LAYOUT": return `Kontrollbeskrivningen på kartan för ${edit.course === "ALL_CONTROLS" ? "Alla kontroller" : course(edit.course)}`;
    case "SET_PRINT_AREA": return `Tryckytan för ${edit.course === "ALL_CONTROLS" ? "Alla kontroller" : course(edit.course)}`;
    case "PUT_PRINT_PROFILE": return `Utskriftsprofilen ${edit.profile.name}`;
    case "DELETE_PRINT_PROFILE": return `Ta bort utskriftsprofilen ${profileName(edit.id) ?? ""}`.trim();
    case "PUT_LAYOUT_TEMPLATE": return `Layoutmallen ${edit.template.name}`;
    case "DELETE_LAYOUT_TEMPLATE": return `Ta bort layoutmallen ${templateName(edit.id) ?? ""}`.trim();
    // ADR-0192: träningsläget.
    case "PUT_TRAINING": {
      const courses = Object.keys(edit.courses ?? {}).map(course);
      if (courses.length > 0) return `Träningen för ${courses.join(", ")}`;
      if (edit.attackPoints) return "Sista säkra";
      if (edit.areas) return "Träningens områden";
      return "Träningen";
    }
    default: return "Ändring";
  }
}
