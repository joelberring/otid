import type { CourseSettingDocument } from "@o-tid/course-setting";

/**
 * Steg 62: ett litet dokument för webbens enhetstester (en ogafflad bana: start, 31, 32, mål).
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
