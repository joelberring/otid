import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEdit, emptyDocument, layoutCoursePage, sheetOfPage, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { frameImageKey, SheetView } from "./course-setting-sheet";

/**
 * Städrundan 2026-11-07: med normens färgordning ritar förhandsvisningen vita specialobjekt (white-out) och bilder under banan
 * som PDF:en (`courseLayerOf`): förut låg de i övre lila, så att vitt raderade ringar och sträckor och bilder täckte banan.
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
  it("vita specialobjekt och bilder ligger under banans lila, och kartans bild över banan maskas bort i dem", () => {
    const { sheet: printed, whiteOut, image } = sheet();
    const key = frameImageKey(printed.frames[0]!, "c");
    const images = { [key]: "data:image/png;base64,", [`${key}|OVER`]: "data:image/png;base64," };
    const html = renderToStaticMarkup(<SheetView sheet={printed} index={0} symbols={new Map()} images={images} colorsKey="c" label="Ark"
      pressLayers={{ norm: "ISOM", numbersOnTop: false, over: [1], overWhite: [], overInk: [1], under: [2] }} />);
    const at = (pattern: string) => html.indexOf(pattern);
    const beneath = at('data-layer="beneath"'), lower = at('data-layer="lower"'), over = at('data-testid="print-map-over"'), upper = at('data-layer="upper"');
    expect(beneath).toBeGreaterThan(-1);
    expect(beneath).toBeLessThan(lower);
    expect(lower).toBeLessThan(over);
    expect(over).toBeLessThan(upper);
    // Det vita och bilden står i lagret under banan, inte i övre lila.
    const beneathLayer = html.slice(beneath, lower), upperLayer = html.slice(upper);
    // (Kontrollerna har egna id som kan vara samma tal; specialobjekten märks med rollen, bilden är en <image>.)
    const white = `fill="#fff" fill-rule="evenodd"`, picture = `<image href="data:image/png;base64,${PNG}"`;
    expect(beneathLayer).toContain(`${white}`);
    expect(beneathLayer).toMatch(new RegExp(`${white}[^>]*data-ref="${whiteOut}" data-role="SPECIAL"`));
    expect(beneathLayer).toContain(`${picture}`);
    expect(beneathLayer).toContain(`data-ref="${image}"`);
    expect(upperLayer).not.toContain(white);
    expect(upperLayer).not.toContain(picture);
    // Masken för kartans färger över banan: hela ramen vit, det vita objektet och bildens ruta svarta.
    expect(html).toMatch(/<mask id="s0f0c"[^>]*>.*fill="#000".*fill="#000".*<\/mask>/);
    expect(html).toContain('mask="url(#s0f0c)"');
  });

  it("utan normens färgordning: allt banpåtryck i ett lager över kartan och ingen mask", () => {
    const { sheet: printed } = sheet();
    const html = renderToStaticMarkup(<SheetView sheet={printed} index={0} symbols={new Map()} images={{}} colorsKey="c" label="Ark" />);
    expect(html).not.toContain("data-layer=");
    expect(html).not.toContain("<mask");
  });
});
