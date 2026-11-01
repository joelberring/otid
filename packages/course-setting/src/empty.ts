/** Ett nytt, tomt dokument med Purple Pens förval för en ny tävling (Controller.InitialNewEvent). */
import { toRaw } from "./ppen-common";
import type { CourseSettingDocument } from "./types";
import { CourseSettingEditError } from "./types";
import { el } from "./xml";

export function createEmptyDocument(options: { readonly title: string; readonly mapScale: number; readonly sprint?: boolean }): CourseSettingDocument {
  if (!(Number.isFinite(options.mapScale) && options.mapScale > 0)) throw new CourseSettingEditError("INVALID", "Kartans skala måste vara positiv");
  const sprint = options.sprint === true;
  // ISSprOM skalar med kartan; ISOM 2017 som 1:15 000 när utskriften ligger nära den skalan, som Purple Pen.
  const scaleSizes = sprint || options.mapScale < 9500 || options.mapScale > 15500 ? "RelativeToMap" : "RelativeTo15000";
  const scale = String(options.mapScale);
  return {
    version: 1,
    event: {
      title: options.title,
      mapScale: options.mapScale,
      overprintStandard: sprint ? "ISSPROM2019" : "ISOM2017",
      descriptionStandard: "2018",
      numbering: { start: 31, disallowInvertible: true },
      descriptionLanguage: "sv",
      raw: [
        el("event", [["id", "1"]]),
        el("map", [["kind", "none"]]),
        el("standards"),
        el("all-controls", [["print-scale", scale], ["description-kind", "symbols"]]),
        el("numbering"),
        el("punch-card", [["rows", "3"], ["columns", "8"], ["left-to-right", "true"], ["top-to-bottom", "false"]]),
        el("course-appearance", [
          ["scale-sizes", scaleSizes], ["scale-sizes-circle-gaps", "true"], ["number-font", "Roboto"], ["auto-leg-gap-size", "3.5"],
          ["blend-purple", "true"], ["blend-style", "blend"]
        ]),
        el("descriptions", [["color", "black"]]),
        el("ocad", [["overprint-colors", "false"]])
      ].map(toRaw)
    },
    controls: {},
    courseControls: {},
    courses: [],
    legs: {},
    specialObjects: [],
    raw: []
  };
}
