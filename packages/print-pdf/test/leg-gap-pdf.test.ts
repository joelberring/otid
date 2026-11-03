/** ADR-0211 beslut 2: sträckorna slutar ett mellanrum utanför ringarna, också i PDF:en (ISOM 2017-2, 705). */
import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_PRINT_PROFILES, layoutCoursePage, LEG_CIRCLE_GAP_MM, readPpen, sheetOfPage, type CourseSettingDocument,
  type OverprintPrimitive
} from "@o-tid/course-setting";
import { PT_PER_MM, writeSheetsPdf } from "../src";
import { num } from "../src/content";
import { fixture, fontFiles, parsePdf } from "./helpers";

type Line = Extract<OverprintPrimitive, { kind: "polyline" }>;

async function legStartInPdf(document: CourseSettingDocument) {
  const course = [...document.courses].sort((a, b) => a.order - b.order)[0]!;
  const sheets = layoutCoursePage(document, { course: course.id }).map(sheetOfPage);
  const frame = sheets[0]!.frames[0]!;
  const leg = frame.figures.find((item): item is Line => item.kind === "polyline" && item.role === "LEG")!;
  const [fromId] = leg.ref!.split("-");
  const from = document.controls[document.courseControls[fromId!]?.control ?? fromId!]!;
  const pdf = await parsePdf((await writeSheetsPdf({ sheets, map: null, profile: BUILT_IN_PRINT_PROFILES.find(item => item.id === "office")!,
    mode: "OFFICE", fonts: fontFiles() })).bytes);
  // Kartans mm (y uppåt) till PDF:ens punkter som `write-pdf.ts` gör det (mapMatrix).
  const H = sheets[0]!.paper.heightMm, s = frame.transform.scale;
  const at = leg.points[0]!;
  const x = PT_PER_MM * (s * at.x + frame.transform.translateX), y = PT_PER_MM * (s * at.y + H - frame.transform.translateY);
  return { written: pdf.pages[0]!.content.includes(`${num(x)} ${num(y)} m`), distance: Math.hypot(at.x - from.at.x, at.y - from.at.y), ratio: s };
}

describe("mellanrummet mellan sträckan och ringen i PDF:en (ADR-0211 beslut 2)", () => {
  it("sträckans första punkt står i PDF:en ett mellanrum utanför ringens ytterkant", async () => {
    const document = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
    const standard = await legStartInPdf(document);
    const none = await legStartInPdf(applyEdit(document, { type: "SET_EVENT", changes: { legCircleGapMm: 0 } }).document);
    expect(standard.written).toBe(true);
    expect(none.written).toBe(true);
    // Skillnaden mellan förvalet och 0 är mellanrummet (kartfil.ppen: 1:10 000 utan skalning, samma mm som på papperet).
    expect(standard.distance - none.distance).toBeCloseTo(LEG_CIRCLE_GAP_MM, 6);
  });
});
