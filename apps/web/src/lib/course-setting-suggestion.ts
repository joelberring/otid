import type { CourseSettingSuggestion } from "@o-tid/contracts";
import {
  replayEdits, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds, type ReplayRejection
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { editTextsSv, type EditContext, type EditTexts } from "../i18n/course-setting-edits-sv";
import { courseSettingSv } from "../i18n/course-setting-sv";
import type { CourseSettingTexts } from "../i18n/course-setting-en";
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

/**
 * Åtgärden i en mening, med kontrollernas koder i dokumentet som förslaget gjordes mot (eller det aktuella). Texterna står i
 * `course-setting-edits-*.ts` på sidans språk.
 */
export function describeEdit(edit: CourseSettingEdit, document: CourseSettingDocument, texts: EditTexts = editTextsSv,
  courseText: CourseSettingTexts = courseSettingSv, decimal = ","): string {
  const label = (id: string) => document.controls[id] ? controlLabel(document, id, courseText) : texts.newControl;
  const course = (id: string) => document.courses.find(row => row.id === id)?.name ?? texts.newCourse;
  const kind = (value: string | undefined) => (value ? texts.kinds(value) : undefined) ?? texts.specialObject;
  const ctx: EditContext = {
    label, course, kind,
    onCourse: id => { const control = document.courseControls[id]?.control; return control ? label(control) : texts.aControl; },
    special: id => kind(document.specialObjects.find(row => row.id === id)?.kind),
    profileName: id => document.event.printProfiles?.find(row => row.id === id)?.name,
    templateName: id => document.event.layoutTemplates?.find(row => row.id === id)?.name,
    paperTemplateName: id => document.event.paperTemplates?.find(row => row.id === id)?.name,
    moved: (control, at) => {
      const before = document.controls[control]?.at;
      return before ? Math.hypot(at.x - before.x, at.y - before.y) * document.event.mapScale / 1000 : undefined;
    },
    ratio: value => formatRatio(value).replace(".", decimal)
  };
  if (edit.type === "UPDATE_COURSE") return texts.courseChanges(edit.changes, course(edit.course));
  if (edit.type === "SET_APPEARANCE") return texts.appearance(edit.changes, ctx.ratio);
  const describe = texts.describe[edit.type] as ((edit: CourseSettingEdit, ctx: EditContext) => string) | undefined;
  return describe ? describe(edit, ctx) : texts.fallback;
}
