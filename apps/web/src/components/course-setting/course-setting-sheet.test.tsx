import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEdit, emptyDocument, layoutCoursePage, sheetOfPage, type CourseSettingDocument, type CourseSettingEdit, type Sheet } from "@o-tid/course-setting";
import { overBandImageKey } from "../../lib/course-setting-press-layers";
import { pageNodes } from "../../lib/course-setting-print";
import { frameImageKey, SheetView } from "./course-setting-sheet";

/**
 * Städrundan 2026-11-07 + Etapp 1C: normens färgordning, bandade OVER-lager i exakt rank-ordning,
 * icke-isolerad mask direkt på `<image>` (så Darken fungerar även med white-out/vita ytor),
 * överlappande `whiteAreas` utan even-odd-utslagning, och specialbilder med `role: "SPECIAL"`.
 */
// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function sheet() {
  let document: CourseSettingDocument = emptyDocument({ title: "Lager", mapScale: 10000 });
  const edit = (change: CourseSettingEdit) => { const result = applyEdit(document, change); document = result.document; return result.created ?? ""; };
  const ids = [edit({ type: "ADD_CONTROL", kind: "START", at: { x: 20, y: 20 } }), edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 50, y: 50 }, code: "31" }),
    edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 80, y: 20 } })];
  const course = edit({ type: "ADD_COURSE", name: "A" });
  for (const id of ids) edit({ type: "INSERT_COURSE_CONTROL", course, control: id });
  const whiteOut = edit({ type: "ADD_SPECIAL", special: { kind: "white-out", points: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] } });
  const image = edit({ type: "ADD_SPECIAL", special: { kind: "image", points: [{ x: 25, y: 35 }, { x: 35, y: 25 }], image: { format: "png", data: PNG } } });
  return { sheet: sheetOfPage(layoutCoursePage(document, { course, mapBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } })[0]!), whiteOut, image };
}

describe("arket med normens färgordning (förhandsvisningen)", () => {
  it("vita specialobjekt och bilder ligger under banans lila, och masken sitter direkt på OVER-bilden utan isolerande <g mask>", () => {
    const { sheet: printed, whiteOut, image } = sheet();
    const key = frameImageKey(printed.frames[0]!, "c");
    const images = { [key]: "data:image/png;base64,", [overBandImageKey(key, 0)]: "data:image/png;base64," };
    const html = renderToStaticMarkup(<SheetView sheet={printed} index={0} symbols={new Map()} images={images} colorsKey="c" label="Ark"
      pressLayers={{ norm: "ISOM", numbersOnTop: false, over: [1], overBands: [{ kind: "INK", ids: [1] }], overWhite: [], overInk: [1], under: [2] }} />);
    const at = (pattern: string) => html.indexOf(pattern);
    const beneath = at('data-layer="beneath"'), lower = at('data-layer="lower"'), over = at('data-testid="print-map-over"'), upper = at('data-layer="upper"');
    expect(beneath).toBeGreaterThan(-1);
    expect(beneath).toBeLessThan(lower);
    expect(lower).toBeLessThan(over);
    expect(over).toBeLessThan(upper);
    const beneathLayer = html.slice(beneath, lower), upperLayer = html.slice(upper);
    const white = `fill="#fff" fill-rule="evenodd"`, picture = `<image href="data:image/png;base64,${PNG}"`;
    expect(beneathLayer).toContain(`${white}`);
    expect(beneathLayer).toMatch(new RegExp(`${white}[^>]*data-ref="${whiteOut}" data-role="SPECIAL"`));
    expect(beneathLayer).toContain(`${picture}`);
    expect(beneathLayer).toMatch(new RegExp(`data-ref="${image}" data-role="SPECIAL"`));
    expect(upperLayer).not.toContain(white);
    expect(upperLayer).not.toContain(picture);
    // Masken sitter direkt på <image> (inte på en isolerande wrapper-<g mask>), så mix-blend-mode: darken blandar mot banan!
    expect(html).not.toMatch(/<g[^>]*mask="/);
    expect(html).toMatch(/<mask id="s0f0c"[^>]*>.*fill="#000".*fill="#000".*<\/mask>/);
    expect(html).toMatch(/<image[^>]*data-testid="print-map-over"[^>]*mask="url\(#s0f0c\)"[^>]*style="mix-blend-mode:darken"/);
  });

  it("ritar bandade OVER-lager i exakt rank-ordning (INK -> WHITE -> INK) och klipper specialbild mot markingClip och överlappande whiteAreas", () => {
    const { sheet: printed, image } = sheet();
    const frame0 = printed.frames[0]!;
    // Kontrollera att pageNodes ger image-noden role: "SPECIAL".
    expect(pageNodes(frame0, new Map()).find(node => node.tag === "image")).toMatchObject({ tag: "image", role: "SPECIAL", ref: image });
    const withExtras: Sheet = {
      ...printed,
      frames: [{
        ...frame0,
        mirror: true,
        markingClip: { polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }], refs: [image] },
        whiteAreas: [
          [{ x: 15, y: 15 }, { x: 45, y: 15 }, { x: 45, y: 45 }, { x: 15, y: 45 }],
          [{ x: 30, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 60 }, { x: 30, y: 60 }]
        ]
      }]
    };
    const key = frameImageKey(withExtras.frames[0]!, "c");
    const images = {
      [key]: "data:image/png;base64,base",
      [overBandImageKey(key, 0)]: "data:image/png;base64,band0",
      [overBandImageKey(key, 1)]: "data:image/png;base64,band1",
      [overBandImageKey(key, 2)]: "data:image/png;base64,band2"
    };
    const html = renderToStaticMarkup(<SheetView sheet={withExtras} index={0} symbols={new Map()} images={images} colorsKey="c" label="Ark"
      pressLayers={{
        norm: "ISOM", numbersOnTop: false, over: [6, 2, 1],
        overBands: [{ kind: "INK", ids: [6] }, { kind: "WHITE", ids: [2] }, { kind: "INK", ids: [1] }],
        overWhite: [2], overInk: [6, 1], under: [7]
      }} />);
    expect(html).toContain('data-map="ready"');
    // Bandordning: band0 (INK) < band1 (WHITE, utan darken) < band2 (INK).
    const b0 = html.indexOf('data-band="0"'), b1 = html.indexOf('data-band="1"'), b2 = html.indexOf('data-band="2"');
    expect(b0).toBeGreaterThan(-1);
    expect(b0).toBeLessThan(b1);
    expect(b1).toBeLessThan(b2);
    const whiteBandTag = html.slice(html.lastIndexOf("<image", b1), html.indexOf(">", b1) + 1);
    expect(whiteBandTag).toContain('data-testid="print-map-over-white"');
    expect(whiteBandTag).not.toContain("mix-blend-mode");
    expect(whiteBandTag).toContain('mask="url(#s0f0c)"');
    // Överlappande whiteAreas får två separata clipPaths (inte en sammanslagen even-odd) och speglad mask.
    expect(html).toContain('id="s0f0w0"');
    expect(html).toContain('id="s0f0w1"');
    expect(html).toMatch(/<mask id="s0f0c"[^>]*>.*<g transform="translate\([^)]+\) scale\(-1 1\)">/);
    // Specialbilden klipps av både markingClip och whiteAreas.
    expect(html).toContain('data-testid="print-marking-white"');
    expect(html).toContain('data-testid="print-marking-clipped"');
  });

  it("utan normens färgordning: allt banpåtryck i ett lager över kartan och ingen mask", () => {
    const { sheet: printed } = sheet();
    const html = renderToStaticMarkup(<SheetView sheet={printed} index={0} symbols={new Map()} images={{}} colorsKey="c" label="Ark" />);
    expect(html).not.toContain("data-layer=");
    expect(html).not.toContain("<mask");
  });
});
