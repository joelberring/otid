import { describe, expect, it } from "vitest";
import { drawRouteChoice, ROUTE_LINE } from "./course-setting-draw";
import { alternativeColor, ROUTE_CHOICE_COLORS } from "./route-choice-view";

/** En kanvas som bara skriver upp vad som ritas (linjer med färg, bredd och streckning, texter). */
function recorder() {
  const strokes: { color: string; width: number; dashed: boolean }[] = [];
  const texts: string[] = [];
  let dash: number[] = [];
  const ctx = {
    strokeStyle: "", fillStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter", font: "", textAlign: "start", textBaseline: "alphabetic",
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, rect() {}, fill() {}, fillRect() {},
    setLineDash(value: number[]) { dash = value; },
    stroke() { strokes.push({ color: String(ctx.strokeStyle), width: ctx.lineWidth, dashed: dash.length > 0 }); },
    measureText(value: string) { return { width: value.length * 7 }; },
    fillText(value: string) { texts.push(value); }
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, texts };
}

describe("drawRouteChoice", () => {
  it("ritar alternativen streckade i egna färger och bästa vägen överst, alla med vit kant, och numrerar alternativen", () => {
    const { ctx, strokes, texts } = recorder();
    const view = { centerX: 50, centerY: 0, pxPerMm: 4, width: 800, height: 600 };
    drawRouteChoice(ctx, view, {
      best: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      alternatives: [
        { points: [{ x: 0, y: 0 }, { x: 50, y: 30 }, { x: 100, y: 0 }], timeRatio: 1.08 },
        { points: [{ x: 0, y: 0 }, { x: 50, y: -30 }, { x: 100, y: 0 }], timeRatio: 1.21 }
      ]
    });
    const halo = (width: number) => ({ color: "rgba(255, 255, 255, 0.9)", width: width + ROUTE_LINE.halo, dashed: false });
    // Sämsta alternativet först, bästa vägen sist; vit kant under varje linje. Etiketternas ramar efter linjerna.
    expect(strokes.slice(0, 6)).toEqual([
      halo(ROUTE_LINE.alternative), { color: alternativeColor(1), width: ROUTE_LINE.alternative, dashed: true },
      halo(ROUTE_LINE.alternative), { color: alternativeColor(0), width: ROUTE_LINE.alternative, dashed: true },
      halo(ROUTE_LINE.best), { color: ROUTE_CHOICE_COLORS.best, width: ROUTE_LINE.best, dashed: false }
    ]);
    expect(ROUTE_LINE.best).toBeGreaterThan(ROUTE_LINE.alternative);
    expect(texts).toEqual(["1 · +8 %", "2 · +21 %"]);
  });
});
