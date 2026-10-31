import {
  CourseSettingEditError, type CourseSettingDocument, type CourseSettingEdit, type EditResult
} from "@o-tid/course-setting";

/**
 * Steg 62: ett litet dokument och en enkel `applyEdit` för webbens enhetstester (kontrollerna läggs till, flyttas, tas bort
 * och läggs in på en ogafflad bana). Paketets riktiga `applyEdit` provas i paketet och i Playwright.
 */
export function testDocument(): CourseSettingDocument {
  return {
    version: 1,
    event: { title: "Träning", mapScale: 10000, overprintStandard: "ISOM2017", descriptionStandard: "2018", numbering: { start: 31, disallowInvertible: false } },
    controls: {
      s: { id: "s", kind: "START", at: { x: 0, y: 0 }, descriptions: [] },
      a: { id: "a", kind: "NORMAL", code: "31", at: { x: 10, y: 0 }, descriptions: [] },
      b: { id: "b", kind: "NORMAL", code: "32", at: { x: 20, y: 10 }, descriptions: [] },
      f: { id: "f", kind: "FINISH", at: { x: 0, y: 10 }, descriptions: [] }
    },
    courseControls: {
      c1: { id: "c1", control: "s", next: "c2" }, c2: { id: "c2", control: "a", next: "c3" }, c3: { id: "c3", control: "b", next: "c4" },
      c4: { id: "c4", control: "f" }
    },
    courses: [{ id: "k", name: "Lång", kind: "NORMAL", order: 1, first: "c1", labelKind: "SEQUENCE" }],
    legs: {}, specialObjects: [], raw: []
  };
}

let counter = 0;

export function testApply(document: CourseSettingDocument, edit: CourseSettingEdit): EditResult {
  const id = () => `n${++counter}`;
  switch (edit.type) {
    case "ADD_CONTROL": {
      const created = id();
      return { document: { ...document, controls: { ...document.controls, [created]: { id: created, kind: edit.kind, code: edit.code, at: edit.at,
        descriptions: [] } } }, created };
    }
    case "MOVE_CONTROL": {
      const control = document.controls[edit.control];
      if (!control) throw new CourseSettingEditError("NOT_FOUND", "Kontrollen finns inte");
      return { document: { ...document, controls: { ...document.controls, [edit.control]: { ...control, at: edit.at } } } };
    }
    case "DELETE_CONTROL": {
      if (Object.values(document.courseControls).some(row => row.control === edit.control)) {
        throw new CourseSettingEditError("IN_USE", "Kontrollen används på en bana");
      }
      const controls = { ...document.controls };
      delete controls[edit.control];
      return { document: { ...document, controls } };
    }
    case "INSERT_COURSE_CONTROL": {
      const created = id();
      const course = document.courses.find(row => row.id === edit.course)!;
      const chain: string[] = [];
      for (let at = course.first; at; at = document.courseControls[at]?.next) chain.push(at);
      const index = edit.after === null ? 0 : edit.after === undefined
        ? Math.max(0, chain.findIndex(row => document.controls[document.courseControls[row]!.control]?.kind === "FINISH")) || chain.length
        : chain.indexOf(edit.after) + 1;
      chain.splice(index, 0, created);
      const courseControls: Record<string, CourseSettingDocument["courseControls"][string]> = { ...document.courseControls, [created]: { id: created, control: edit.control } };
      chain.forEach((row, position) => { courseControls[row] = { ...courseControls[row]!, next: chain[position + 1] }; });
      return { document: { ...document, courseControls, courses: document.courses.map(row => row.id === course.id ? { ...row, first: chain[0] } : row) },
        created };
    }
    case "REMOVE_COURSE_CONTROL": {
      const course = document.courses.find(row => row.id === edit.course)!;
      const chain: string[] = [];
      for (let at = course.first; at; at = document.courseControls[at]?.next) if (at !== edit.courseControl) chain.push(at);
      const courseControls: Record<string, CourseSettingDocument["courseControls"][string]> = { ...document.courseControls };
      delete courseControls[edit.courseControl];
      chain.forEach((row, position) => { courseControls[row] = { ...courseControls[row]!, next: chain[position + 1] }; });
      return { document: { ...document, courseControls, courses: document.courses.map(row => row.id === course.id ? { ...row, first: chain[0] } : row) } };
    }
    case "SET_LEG_BENDS":
      return { document: { ...document, legs: { ...document.legs, [`${edit.from}-${edit.to}`]: { from: edit.from, to: edit.to, bends: edit.bends, gaps: [] } } } };
    default:
      throw new CourseSettingEditError("INVALID", `${edit.type} finns inte i testet`);
  }
}
