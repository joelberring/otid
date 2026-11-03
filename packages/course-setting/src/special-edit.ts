/**
 * Steg 64: ändringar av specialobjekt och tryckyta. Reglerna för punkter, texter och beskrivningar följer Purple Pens
 * Special.Validate (EventDB.cs, BSD, Peter Golde); en bana kan bara ha en beskrivning på kartan.
 */
import type { Point } from "@o-tid/map-file";
import { nextId } from "./ppen-common";
import { BUILT_IN_TEMPLATES, validateLayoutTemplate } from "./layout-template";
import { PAPER_LIMITS, validatePaperLayout, validatePaperTemplate } from "./paper-items";
import { newSpecial } from "./ppen-special";
import { BUILT_IN_PRINT_PROFILES, validatePrintProfile } from "./print-profile";
import type { CourseSettingDocument, EditResult, PrintArea, SpecialEdit, SpecialKind, SpecialObject } from "./types";
import { CourseSettingEditError } from "./types";

export const SPECIAL_KIND_LIST: readonly SpecialKind[] = [
  "first-aid", "water", "optional-crossing-point", "forbidden-route", "registration-mark", "boundary", "out-of-bounds",
  "dangerous-area", "temporary-construction", "white-out", "text", "descriptions", "image", "line", "rectangle", "ellipse"
];
const POINT_KINDS = new Set(["first-aid", "water", "optional-crossing-point", "forbidden-route", "registration-mark"]);
const LINE_KINDS = new Set(["boundary", "line"]);
const AREA_KINDS = new Set(["out-of-bounds", "dangerous-area", "temporary-construction", "white-out"]);

const invalid = (message: string) => new CourseSettingEditError("INVALID", message);
const BUILT_IN_IDS = new Set([...BUILT_IN_PRINT_PROFILES.map(profile => profile.id), ...BUILT_IN_TEMPLATES.map(template => template.id)]);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Antalet punkter som slaget ska ha (Special.Validate). */
export function specialPointCount(kind: string): { min: number; max: number } {
  if (POINT_KINDS.has(kind)) return { min: 1, max: 1 };
  if (LINE_KINDS.has(kind)) return { min: 2, max: 10_000 };
  if (AREA_KINDS.has(kind)) return { min: 3, max: 10_000 };
  return { min: 2, max: 2 };
}

function checkPoints(kind: string, points: readonly Point[]): void {
  const { min, max } = specialPointCount(kind);
  if (points.length < min || points.length > max) throw invalid(min === max ? `Specialobjektet ska ha ${min} punkt${min === 1 ? "" : "er"}` : `Specialobjektet ska ha minst ${min} punkter`);
  if (!points.every(p => finite(p.x) && finite(p.y))) throw invalid("Specialobjektets punkter är inte punkter");
  if (kind === "descriptions" && points[0]!.x === points[1]!.x && points[0]!.y === points[1]!.y) throw invalid("Beskrivningens ruta har ingen storlek");
}

function checkSpecial(document: CourseSettingDocument, special: SpecialObject, others: readonly SpecialObject[]): void {
  if (!SPECIAL_KIND_LIST.includes(special.kind as SpecialKind)) throw invalid(`Okänt specialobjekt ${special.kind}`);
  checkPoints(special.kind, special.points);
  const courseIds = new Set(document.courses.map(course => course.id));
  for (const course of special.courses) if (course !== "0" && !courseIds.has(course)) throw new CourseSettingEditError("NOT_FOUND", `Banan ${course} finns inte`);
  if (special.kind === "text" && (special.text === undefined || !special.font?.name)) throw invalid("Texten saknar text eller typsnitt");
  if (special.font && special.font.height !== undefined && !(finite(special.font.height) && special.font.height > 0)) throw invalid("Textens höjd måste vara positiv");
  if (special.line && !([special.line.width, special.line.gapSize, special.line.dashSize].every(value => finite(value) && value >= 0))) {
    throw invalid("Linjens mått måste vara positiva");
  }
  if (special.columns !== undefined && !(Number.isInteger(special.columns) && special.columns >= 1 && special.columns <= 100)) throw invalid("1–100 spalter");
  if (special.orientation !== undefined && !finite(special.orientation)) throw invalid("Vinkeln är inte ett tal");
  if (special.stretch !== undefined && !(finite(special.stretch) && special.stretch >= 0)) throw invalid("Förlängningen måste vara positiv");
  if (special.kind === "descriptions") {
    // En bana (eller Alla kontroller) har högst en beskrivning på kartan.
    const covers = (item: SpecialObject, course: string) => item.courses.length === 0 || item.courses.includes(course);
    const mine = special.courses.length === 0 ? ["0", ...courseIds] : special.courses;
    for (const other of others) {
      if (other.kind !== "descriptions" || other.id === special.id) continue;
      if (mine.some(course => covers(other, course))) throw new CourseSettingEditError("IN_USE", "Banan har redan en beskrivning på kartan");
    }
  }
}

function findSpecial(document: CourseSettingDocument, id: string): SpecialObject {
  const found = document.specialObjects.find(special => special.id === id);
  if (!found) throw new CourseSettingEditError("NOT_FOUND", `Specialobjektet ${id} finns inte`);
  return found;
}

function checkPrintArea(area: PrintArea): void {
  if (typeof area.automatic !== "boolean" || typeof area.restrictToPageSize !== "boolean") throw invalid("Tryckytan anges med automatisk och fast storlek");
  if (area.rect) {
    const { minX, minY, maxX, maxY } = area.rect;
    if (![minX, minY, maxX, maxY].every(finite) || minX >= maxX || minY >= maxY) throw invalid("Tryckytan är ingen rektangel");
  }
  if (area.page) {
    const { width, height, margins } = area.page;
    if (![width, height, margins].every(value => Number.isInteger(value) && value >= 0) || width < 100 || height < 100 || margins * 2 >= Math.min(width, height)) {
      throw invalid("Papperets storlek eller marginal stämmer inte");
    }
  }
}

const defined = <T extends object>(object: T): T => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;

export function applySpecialEdit(document: CourseSettingDocument, edit: SpecialEdit): EditResult {
  const specials = document.specialObjects;
  switch (edit.type) {
    case "ADD_SPECIAL": {
      const id = nextId(specials.map(special => special.id));
      if (edit.special.kind === "image" && !(edit.special.image && /^[A-Za-z0-9+/=\s]+$/.test(edit.special.image.data))) throw invalid("Bilden saknar data");
      const special = newSpecial(id, defined(edit.special));
      checkSpecial(document, special, specials);
      return { document: { ...document, specialObjects: [...specials, special] }, created: id };
    }
    case "MOVE_SPECIAL": {
      const current = findSpecial(document, edit.special);
      checkPoints(current.kind, edit.points);
      const special = { ...current, points: edit.points.map(p => ({ x: p.x, y: p.y })) };
      return { document: { ...document, specialObjects: specials.map(item => item.id === special.id ? special : item) } };
    }
    case "UPDATE_SPECIAL": {
      const current = findSpecial(document, edit.special);
      const changes = defined(edit.changes);
      const special: SpecialObject = { ...current, ...changes, courses: changes.courses ? [...changes.courses] : current.courses };
      checkSpecial(document, special, specials);
      return { document: { ...document, specialObjects: specials.map(item => item.id === special.id ? special : item) } };
    }
    case "DELETE_SPECIAL":
      findSpecial(document, edit.special);
      return { document: { ...document, specialObjects: specials.filter(item => item.id !== edit.special) } };
    case "PUT_PRINT_PROFILE": case "PUT_LAYOUT_TEMPLATE": {
      const key = edit.type === "PUT_PRINT_PROFILE" ? "printProfiles" : "layoutTemplates";
      const item = edit.type === "PUT_PRINT_PROFILE" ? validatePrintProfile(edit.profile) : validateLayoutTemplate(edit.template);
      if (BUILT_IN_IDS.has(item.id)) throw invalid("En inbyggd profil eller mall ändras genom att kopieras med nytt id");
      const list = (document.event[key] ?? []) as readonly { id: string }[];
      if (list.length >= 50 && !list.some(row => row.id === item.id)) throw invalid("Högst 50 profiler eller mallar");
      const next = list.some(row => row.id === item.id) ? list.map(row => row.id === item.id ? item : row) : [...list, item];
      return { document: { ...document, event: { ...document.event, [key]: next } } };
    }
    case "DELETE_PRINT_PROFILE": case "DELETE_LAYOUT_TEMPLATE": {
      const key = edit.type === "DELETE_PRINT_PROFILE" ? "printProfiles" : "layoutTemplates";
      const list = (document.event[key] ?? []) as readonly { id: string }[];
      if (!list.some(row => row.id === edit.id)) throw new CourseSettingEditError("NOT_FOUND", `${edit.id} finns inte`);
      const event = { ...document.event, [key]: list.filter(row => row.id !== edit.id) };
      if (key === "printProfiles" && event.printProfileId === edit.id) delete (event as { printProfileId?: string }).printProfileId;
      return { document: { ...document, event } };
    }
    case "SET_PAPER_LAYOUT": {
      if (edit.course !== "ALL_CONTROLS" && !document.courses.some(item => item.id === edit.course)) {
        throw new CourseSettingEditError("NOT_FOUND", `Banan ${edit.course} finns inte`);
      }
      const layouts = { ...(document.event.paperLayouts ?? {}) };
      delete layouts[edit.course];
      const layout = edit.layout ? validatePaperLayout(edit.layout) : undefined;
      if (layout && Object.keys(layout).length > 0) {
        if (layout.template !== undefined && !(document.event.paperTemplates ?? []).some(item => item.id === layout.template)) {
          throw new CourseSettingEditError("NOT_FOUND", `Mallen ${layout.template} finns inte`);
        }
        layouts[edit.course] = layout;
      }
      const event = { ...document.event };
      delete event.paperLayouts;
      return { document: { ...document, event: Object.keys(layouts).length > 0 ? { ...event, paperLayouts: layouts } : event } };
    }
    case "PUT_PAPER_TEMPLATE": {
      const template = validatePaperTemplate(edit.template);
      const list = document.event.paperTemplates ?? [];
      const known = list.some(row => row.id === template.id);
      if (!known && list.length >= PAPER_LIMITS.templates) throw invalid(`Högst ${PAPER_LIMITS.templates} mallar för papperet`);
      const next = known ? list.map(row => row.id === template.id ? template : row) : [...list, template];
      return { document: { ...document, event: { ...document.event, paperTemplates: next } } };
    }
    case "DELETE_PAPER_TEMPLATE": {
      const list = document.event.paperTemplates ?? [];
      if (!list.some(row => row.id === edit.id)) throw new CourseSettingEditError("NOT_FOUND", `Mallen ${edit.id} finns inte`);
      // Banorna som ärvde av mallen står kvar utan mall (deras egna element och ändringar finns kvar).
      const layouts = Object.fromEntries(Object.entries(document.event.paperLayouts ?? {}).map(([course, layout]) => {
        if (layout.template !== edit.id) return [course, layout];
        const rest = { ...layout };
        delete rest.template; delete rest.hidden;
        return [course, rest];
      }).filter(([, layout]) => Object.keys(layout as object).length > 0));
      const event = { ...document.event, paperTemplates: list.filter(row => row.id !== edit.id) };
      delete event.paperLayouts;
      if (event.paperTemplates.length === 0) delete (event as { paperTemplates?: unknown }).paperTemplates;
      return { document: { ...document, event: Object.keys(layouts).length > 0 ? { ...event, paperLayouts: layouts } : event } };
    }
    case "SET_PRINT_AREA": {
      if (edit.area) checkPrintArea(edit.area);
      const area = edit.area ? defined({ automatic: edit.area.automatic, restrictToPageSize: edit.area.restrictToPageSize, rect: edit.area.rect,
        page: edit.area.page }) : undefined;
      if (edit.course === "ALL_CONTROLS") {
        const event = { ...document.event };
        delete event.printArea;
        return { document: { ...document, event: area ? { ...event, printArea: area } : event } };
      }
      const course = document.courses.find(item => item.id === edit.course);
      if (!course) throw new CourseSettingEditError("NOT_FOUND", `Banan ${edit.course} finns inte`);
      const rest = { ...course };
      delete rest.printArea;
      const next = area ? { ...rest, printArea: area } : rest;
      return { document: { ...document, courses: document.courses.map(item => item.id === course.id ? next : item) } };
    }
  }
}
