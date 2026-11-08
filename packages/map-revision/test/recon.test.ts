import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import {
  areaProgress, checkStillValid, coverageGrid, DEFAULT_RECON, metersToMm, reconGroup, reconMarkers, reconSettingsProblem, vegetationFactor,
  type ReconObject, type TrackPoint
} from "../src";

/** ADR-0219 K3: rekningens status ur GPS-spår och bekräftelser. Kartan 1:10 000: 1 mm = 10 m. */
const SCALE = 10000;
const point = (key: string, code: string, x: number, y: number): ReconObject => ({ key, code, object: { kind: "point", symbol: code, at: { x, y }, angle: 0 } });
const line = (key: string, code: string, points: [number, number][]): ReconObject => ({ key, code, object: { kind: "line", symbol: code,
  path: points.map(([x, y], index) => ({ type: index === 0 ? "M" as const : "L" as const, x, y })) } });
const area = (key: string, code: string, minX: number, minY: number, maxX: number, maxY: number): ReconObject => ({ key, code, object: {
  kind: "area", symbol: code, angle: 0, rings: [[{ type: "M", x: minX, y: minY }, { type: "L", x: maxX, y: minY }, { type: "L", x: maxX, y: maxY },
    { type: "L", x: minX, y: maxY }]] } as MapObject });
/** Ett spår längs x-axeln från x0 till x1 (mm) med 5 m noggrannhet. */
const walk = (x0: number, x1: number, y = 0, step = 0.5): TrackPoint[] => {
  const out: TrackPoint[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) out.push({ x, y, accuracyM: 5 });
  return out;
};
const statusOf = (markers: ReturnType<typeof reconMarkers>, key: string) => markers.find(row => row.key === key)?.status;

describe("rekningens status (K3)", () => {
  it("grupperna efter ISOM-numret; tekniska symboler och banpåtryck har ingen", () => {
    expect([reconGroup("101"), reconGroup("201"), reconGroup("204.1"), reconGroup("308"), reconGroup("406"), reconGroup("505"), reconGroup("520.1")])
      .toEqual(["LANDFORMS", "ROCK", "STONES", "WATER", "VEGETATION", "MANMADE", "MANMADE"]);
    expect([reconGroup("601"), reconGroup("701"), reconGroup("Text"), reconGroup("")]).toEqual([null, null, null, null]);
    expect([vegetationFactor("406"), vegetationFactor("408"), vegetationFactor("410"), vegetationFactor("405")]).toEqual([0.75, 0.5, 0.35, undefined]);
  });

  it("en sten inom siktavståndet är passerad, en längre bort inte; bekräftad är kollad", () => {
    // Stenar 15 m (1,5 mm) plus halva noggrannheten (2,5 m).
    const objects = [point("near", "204", 5, 1.5), point("far", "204", 5, 2.2), point("cliff", "201", 5, 2.2), point("done", "204", 50, 50)];
    const markers = reconMarkers(objects, [walk(0, 10)], new Set(["done"]), DEFAULT_RECON, SCALE);
    expect(statusOf(markers, "near")).toBe("PASSED");
    expect(statusOf(markers, "far")).toBe("UNSEEN");
    // Branter syns längre (25 m).
    expect(statusOf(markers, "cliff")).toBe("PASSED");
    expect(statusOf(markers, "done")).toBe("CHECKED");
  });

  it("i tät vegetation krymper siktavståndet", () => {
    const stone = point("stone", "201", 5, 2.2);
    const thicket = area("thicket", "410", 0, -10, 10, 10);
    expect(statusOf(reconMarkers([stone], [walk(0, 10)], new Set(), DEFAULT_RECON, SCALE), "stone")).toBe("PASSED");
    expect(statusOf(reconMarkers([stone, thicket], [walk(0, 10)], new Set(), DEFAULT_RECON, SCALE), "stone")).toBe("UNSEEN");
  });

  it("en linje är passerad när 80 % av den varit inom siktavståndet; en lucka i spåret räknas inte", () => {
    const wall = line("wall", "513", [[0, 1], [10, 1]]);
    expect(statusOf(reconMarkers([wall], [walk(0, 9)], new Set(), DEFAULT_RECON, SCALE), "wall")).toBe("PASSED");
    expect(statusOf(reconMarkers([wall], [walk(0, 5)], new Set(), DEFAULT_RECON, SCALE), "wall")).toBe("UNSEEN");
    // Två punkter 200 m isär: tappad signal, inte gången.
    const jump: TrackPoint[] = [{ x: 0, y: 1, accuracyM: 3 }, { x: 20, y: 1, accuracyM: 3 }];
    const long = line("long", "513", [[2, 1], [18, 1]]);
    expect(statusOf(reconMarkers([long], [jump], new Set(), DEFAULT_RECON, SCALE), "long")).toBe("UNSEEN");
  });

  it("en yta är passerad när hälften varit inom siktavståndet; utan spår är allt ej rekat", () => {
    const open = area("open", "401", 0, -2, 10, 2);
    expect(statusOf(reconMarkers([open], [walk(0, 10)], new Set(), DEFAULT_RECON, SCALE), "open")).toBe("PASSED");
    const big = area("big", "401", 0, -20, 10, 20);
    expect(statusOf(reconMarkers([big], [walk(0, 10)], new Set(), DEFAULT_RECON, SCALE), "big")).toBe("UNSEEN");
    expect(reconMarkers([open, point("p", "204", 1, 0)], [], new Set(), DEFAULT_RECON, SCALE).map(row => row.status)).toEqual(["UNSEEN", "UNSEEN"]);
  });

  it("täckningen och delområdets framsteg", () => {
    const bounds = { minX: 0, minY: -10, maxX: 20, maxY: 10 };
    const coverage = coverageGrid([walk(0, 20)], bounds, DEFAULT_RECON, SCALE);
    expect(coverage.cellMm).toBeCloseTo(metersToMm(5, SCALE), 9);
    // Bandet ±20 m (±2 mm) av höjden 20 mm: ungefär 4/20.
    const left = [[{ x: 0, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: 0, y: 10 }]];
    const markers = reconMarkers([point("a", "204", 5, 0), point("b", "204", 5, 8), point("c", "204", 15, 0)], [walk(0, 20)], new Set(["b"]),
      DEFAULT_RECON, SCALE);
    const progress = areaProgress(left, coverage, markers);
    expect(progress.coveredShare).toBeCloseTo(0.2, 1);
    expect(progress).toMatchObject({ objects: 2, seenShare: 1, checkedShare: 0.5 });
    expect(areaProgress(left, undefined, []).coveredShare).toBe(0);
  });

  it("en bekräftelse gäller tills objektet ändras; inställningarna kontrolleras", () => {
    expect(checkStillValid(null, null, false)).toBe(true);
    expect(checkStillValid("e1", "e1", false)).toBe(true);
    expect(checkStillValid("e1", "e2", false)).toBe(false);
    expect(checkStillValid(null, null, true)).toBe(false);
    expect(reconSettingsProblem(DEFAULT_RECON)).toBeUndefined();
    expect(reconSettingsProblem({ ...DEFAULT_RECON, coverM: 1 })).toBe("coverM");
    expect(reconSettingsProblem({ ...DEFAULT_RECON, sightM: { ...DEFAULT_RECON.sightM, STONES: 500 } })).toBe("sightM");
    expect(reconSettingsProblem({ ...DEFAULT_RECON, extra: 1 })).toBe("settings");
  });
});
