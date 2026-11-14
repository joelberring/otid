import type { MapObject, Path } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { snapTicks } from "../src/base-map/ticks";

type Tick = Extract<MapObject, { kind: "point" }>;
const line = (...points: [number, number][]): Path => points.map(([x, y], index) => ({ type: index === 0 ? "M" : "L", x, y }) as Path[number]);
const tick = (x: number, y: number, angle: number): Tick => ({ kind: "point", symbol: "s", at: { x, y }, angle });

describe("lutningsstreck följer med till nya kurvor", () => {
  it("flyttar strecket till närmaste punkt på den nya kurvan och behåller vinkeln när kurvan går åt samma håll", () => {
    const out = snapTicks([tick(5, 0, 40)], [line([0, 0], [10, 0])], [line([0, 0.8], [10, 0.8])]);
    expect(out.dropped).toBe(0);
    expect(out.ticks).toHaveLength(1);
    expect(out.ticks[0]!.at.x).toBeCloseTo(5, 0); expect(out.ticks[0]!.at.y).toBeCloseTo(0.8, 3);
    expect(out.ticks[0]!.angle).toBe(40);
    expect(out.ticks[0]!.symbol).toBe("s");
  });
  it("vrider strecket lika mycket som kurvan har vridits, åt det närmaste hållet", () => {
    // Den gamla kurvan går österut, den nya 30° moturs: strecket vrids 30°.
    const slope = Math.tan(30 * Math.PI / 180);
    const out = snapTicks([tick(5, 0, 10)], [line([0, 0], [10, 0])], [line([0, -5 * slope], [10, 5 * slope])]);
    expect(out.ticks[0]!.angle).toBeCloseTo(40, 0);
    // En ny kurva ritad åt andra hållet (västerut) vänder inte strecket.
    const back = snapTicks([tick(5, 0, 10)], [line([0, 0], [10, 0])], [line([10, 0.3], [0, 0.3])]);
    expect(back.ticks[0]!.angle).toBe(10);
  });
  it("tar bort streck utan gammal kurva intill eller utan ny kurva inom räckhåll, och dubbletter på samma ställe", () => {
    const old = [line([0, 0], [10, 0])];
    expect(snapTicks([tick(5, 3, 0)], old, [line([0, 3], [10, 3])])).toEqual({ ticks: [], dropped: 1 });
    expect(snapTicks([tick(5, 0, 0)], old, [line([0, 5], [10, 5])])).toEqual({ ticks: [], dropped: 1 });
    const twice = snapTicks([tick(5, 0, 0), tick(5.02, 0, 0)], old, [line([0, 0.5], [10, 0.5])]);
    expect(twice.ticks).toHaveLength(1); expect(twice.dropped).toBe(1);
  });
});
