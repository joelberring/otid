import { describe, expect, it } from "vitest";
import { crossArm, drawCenterCross, LIFT_PX, liftedPoint } from "./course-setting-draw-cross";

/** Ägarens önskemål från skogen: kryss i vald kontrolls mitt och dragning med fingret lyft ovanför fingret. */
type Call = [string, ...unknown[]];
function recorder() {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_target, key: string) => (...args: unknown[]) => { calls.push([key, ...args]); },
    set: (_target, key: string, value: unknown) => { calls.push([`=${key}`, value]); return true; }
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
const view = { centerX: 0, centerY: 0, pxPerMm: 4, width: 200, height: 100 };

describe("krysset i vald kontrolls mitt", () => {
  it("lyfter bara en dragning med fingret", () => {
    expect(liftedPoint({ x: 10, y: 100 }, "touch")).toEqual({ x: 10, y: 100 - LIFT_PX });
    expect(liftedPoint({ x: 10, y: 100 }, "mouse")).toEqual({ x: 10, y: 100 });
    expect(liftedPoint({ x: 10, y: 100 }, "pen")).toEqual({ x: 10, y: 100 });
  });

  it("har korta armar i vila och armar utanför cirkeln medan man drar", () => {
    expect(crossArm(24, false)).toBeLessThan(24);
    expect(crossArm(24, true)).toBeGreaterThan(24);
    expect(crossArm(2, false)).toBe(5);
  });

  it("ritas svart med vit kant i kontrollens mitt, med en linje till fingret när den lyfts", () => {
    const { ctx, calls } = recorder();
    drawCenterCross(ctx, view, { at: { x: 5, y: 2.5 }, dragging: true }, 3, { x: 120, y: 90 });
    // Mitten (5, 2.5) mm är (120, 40) på skärmen.
    expect(calls).toContainEqual(["lineTo", 120, 40]);
    const colors = calls.filter(call => call[0] === "=strokeStyle").map(call => call[1]);
    expect(colors).toEqual(["rgba(0, 0, 0, 0.7)", "#fff", "#000"]);
    const arm = crossArm(12, true);
    expect(calls).toContainEqual(["moveTo", 120 - arm, 40]);
    expect(calls).toContainEqual(["moveTo", 120, 90]);
  });
});
