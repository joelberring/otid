import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEdit, BUILT_IN_PRINT_PROFILES, emptyDocument, layoutCoursePage, sheetOfPage, type CourseSettingDocument, type CourseSettingEdit, type SheetFrame } from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { compareFrame, proposalState } from "../../lib/course-setting-bl-proposal";
import { BlCompare, BlLayers } from "./course-setting-bl-compare";

(globalThis as { React?: typeof React }).React = React;

const forest = BUILT_IN_PRINT_PROFILES.find(item => item.id === "bl-forest-2026-11-02")!;
const color = (id: number, name: string, rank: number, cmyk: [number, number, number, number]): MapColor =>
  ({ id, name, rank, cmyk: { c: cmyk[0] / 100, m: cmyk[1] / 100, y: cmyk[2] / 100, k: cmyk[3] / 100 }, rgb: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1 });
const used = (codes: string[], kinds: ColorUsage["kinds"]): ColorUsage =>
  ({ objects: 4, kinds, codes, mains: codes.map(code => Number.parseInt(code, 10)), sample: { x: 10, y: 20 } });

const colors = [
  color(1, "Svart", 0, [0, 0, 0, 100]),
  color(2, "Svart", 1, [0, 0, 0, 100]),
  color(3, "Gul 100%", 2, [0, 27, 79, 0])
];
const usage = new Map<number, ColorUsage>([[1, used(["505"], ["LINE"])], [2, used(["506"], ["LINE"])], [3, used(["401"], ["AREA"])]]);

function sampleFrame(): SheetFrame {
  let document: CourseSettingDocument = emptyDocument({ title: "BL", mapScale: 10000 });
  const edit = (change: CourseSettingEdit) => { const result = applyEdit(document, change); document = result.document; return result.created ?? ""; };
  const s = edit({ type: "ADD_CONTROL", kind: "START", at: { x: 20, y: 20 } });
  const c = edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 50, y: 50 }, code: "31" });
  const f = edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 80, y: 20 } });
  const course = edit({ type: "ADD_COURSE", name: "A" });
  for (const id of [s, c, f]) edit({ type: "INSERT_COURSE_CONTROL", course, control: id });
  const whiteOut = edit({ type: "ADD_SPECIAL", special: { kind: "white-out", points: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] } });
  const base = sheetOfPage(layoutCoursePage(document, { course, mapBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } })[0]!).frames[0]!;
  return {
    ...base,
    mirror: true,
    markingClip: { polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }], refs: [whiteOut] },
    whiteAreas: [[{ x: 12, y: 12 }, { x: 30, y: 12 }, { x: 30, y: 30 }, { x: 12, y: 30 }]]
  };
}

describe("BlCompare och BlLayers (Etapp 1C)", () => {
  it("BlCompare respekterar whiteAreas, markingClip och spegling (compareFrame speglar mapArea)", () => {
    const frame = sampleFrame();
    const cropped = compareFrame(frame, 10);
    // Ursprunglig axel = (0 + 100) / 2 = 50; speglat mapArea behåller samma bredd och speglas kring axeln.
    expect(cropped.mapArea.maxX - cropped.mapArea.minX).toBeCloseTo(cropped.clip.width / cropped.transform.scale, 3);
    const state = proposalState(forest, colors, usage)!;
    const html = renderToStaticMarkup(<BlCompare frame={frame} profile={forest} state={state} colors={colors} symbols={new Map()}
      render={() => new Promise(() => undefined)} norm="ISOM" />);
    expect(html).toContain('data-testid="bl-compare-before"');
    expect(html).toContain('id="bl-beforem"');
    expect(html).toContain('id="bl-beforew0"');
    expect(html).toContain('data-marking-clip=""');
  });

  it("BlLayers visar konsekvent text för numbersOnTop och hanterar dubblettnamn med unika nycklar", () => {
    const state = proposalState(forest, colors, usage)!;
    const defaultHtml = renderToStaticMarkup(<BlLayers profile={forest} state={state} norm="ISOM" />);
    expect(defaultHtml).toContain("ringar, linjer, nummer, start och mål");
    expect(defaultHtml).not.toContain("nummer och markeringar ligger överst");
    const topHtml = renderToStaticMarkup(<BlLayers profile={{ ...forest, numbersOnTop: true }} state={state} norm="ISOM" />);
    expect(topHtml).toContain("nummer och markeringar ligger överst");
  });
});
