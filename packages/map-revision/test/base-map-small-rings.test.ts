import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { closeFormlineHooks, oneMarkPerKnoll, smallRingsToPoints } from "../src/base-map/small-rings";

const ring = (cx: number, cy: number, r: number, elevation: number, layer = "contour"): SourceFeature => ({ layer, elevation,
  geometry: { kind: "line", closed: true, points: Array.from({ length: 12 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 6), cy + r * Math.sin(i * Math.PI / 6)] as [number, number]) } });

describe("små slutna kurvor blir punkthöjder (ISOM 2017-2)", () => {
  it("följer normens minsta mått: en grop behöver 1,1 mm, en kulle 0,9 mm", () => {
    // 1:15 000: en ring med diametern 14 m räcker för en kulle (13,5 m) men inte för en grop (16,5 m).
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(-40, 0, 7, 15), ring(40, 0, 7, 5)], 15000, 1);
    expect(out.filter(f => f.geometry.kind === "line").map(f => f.elevation).sort()).toEqual([10, 15]);
    expect(out.filter(f => f.geometry.kind === "point").map(f => f.layer)).toEqual(["udepression"]);
  });
  it("generaliserar med en marginal på 20 % över normens minsta", () => {
    // 14 m räcker för en kulle i 1:15 000 enligt normen (13,5 m) men inte med marginalen (16,2 m).
    expect(smallRingsToPoints([ring(0, 0, 100, 10), ring(-40, 0, 7, 15)], 15000).map(f => f.layer)).toEqual(["contour", "dotknoll"]);
  });
  it("gör en liten stödkurvering till vanlig kurva och tar bort små formlinjeringar", () => {
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(0, 0, 9, 25, "contour_index"), { ...ring(200, 0, 5, 0, "formline"), elevation: undefined }], 15000, 1);
    expect(out.map(f => f.layer).sort()).toEqual(["contour", "contour"]);
  });
  it("nedgraderar små slutna stödkurvor (102), gropar, korta isolerade snuttar och fel höjdnivå i både 1:15 000 och 1:10 000", () => {
    const line = (pts: [number, number][], elevation: number, layer = "contour_index"): SourceFeature =>
      ({ layer, elevation, geometry: { kind: "line", closed: false, points: pts } });
    const base: SourceFeature[] = [
      // Ramkurvor på 5 m-ekvidistans (utbredning 0..400 × 0..400 m) så både kant och ekvidistans känns igen.
      line([[0, 0], [400, 0]], 15, "contour"),
      line([[0, 400], [400, 400]], 20, "contour"),
      line([[0, 350], [400, 350]], 30, "contour"),
      // Liten sluten 102-kulle (r = 12 m -> omkrets ~75 m < 97,5 m, yta ~452 m² < 562 m²) -> nedgraderas till contour.
      ring(100, 100, 12, 25, "contour_index"),
      // Stor sluten 102-kulle (r = 25 m -> omkrets ~157 m, yta ~1 963 m²) -> behålls som contour_index.
      ring(250, 100, 25, 25, "contour_index"),
      // Medelstor sluten sänka på 25 m (r = 18 m -> omkrets ~113 m < 150 m) -> nedgraderas till depression.
      ring(250, 250, 18, 25, "depression_index"),
      // Kort isolerad öppen 102-snutt mitt i rutan (30 m < 60 m) -> nedgraderas till contour.
      line([[120, 200], [150, 200]], 25, "contour_index"),
      // Kort öppen 102-kurva som når ytterkanten (x = 0, fortsätter utanför) -> behålls som contour_index.
      line([[0, 200], [30, 200]], 25, "contour_index"),
      // Lång öppen kurva på fel nivå (30 m i stället för 25/50 m) -> nedgraderas till contour.
      line([[50, 300], [350, 300]], 30, "contour_index")
    ];
    for (const scale of [15_000, 10_000]) {
      const out = smallRingsToPoints(base, scale);
      const layers = out.map(f => f.layer);
      expect(layers.filter(l => l === "contour_index")).toHaveLength(2);
      expect(layers.filter(l => l === "depression")).toHaveLength(1);
      expect(layers.filter(l => l === "depression_index")).toHaveLength(0);
    }
    // Sprintkarta (1:4 000, 2,5 m) som medvetet lägger stödkurva var 4:e kurva (10, 20, 30, 40 m) behåller sina stödkurvor.
    const sprint: SourceFeature[] = [
      line([[0, 0], [200, 0]], 22.5, "contour"),
      line([[0, 50], [200, 50]], 25, "contour"),
      line([[0, 100], [200, 100]], 27.5, "contour"),
      line([[0, 150], [200, 150]], 30, "contour_index"),
      line([[0, 200], [200, 200]], 40, "contour_index"),
      line([[20, 120], [180, 120]], 32.5, "contour_index")
    ];
    const sprintOut = smallRingsToPoints(sprint, 4_000);
    expect(sprintOut.filter(f => f.layer === "contour_index").map(f => f.elevation)).toEqual([30, 40]);
  });
  it("bevarar en verklig liten 101-toppring (t.ex. 24 m diameter) i stället för att låta en laserkulle radera den", () => {
    // 1:15 000: r = 12 m (diameter 24 m > 16,2 m, yta ~452 m² < 3 000 m²): kurvringen behålls och dubbletten tas bort.
    const hillRing = ring(100, 100, 12, 20, "contour");
    const laser: SourceFeature = { layer: "dotknoll_laser", geometry: { kind: "point", at: [100, 100] } };
    const out = smallRingsToPoints([ring(100, 100, 100, 15, "contour"), hillRing, laser], 15_000);
    expect(out.filter(f => f.geometry.kind === "line")).toHaveLength(2);
    expect(out.filter(f => f.layer === "dotknoll_laser")).toHaveLength(0);
  });
  it("en liten ring på en högre nivå än omgivningen blir en liten kulle, en lägre blir en grop", () => {
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(0, 0, 5, 15), ring(50, 0, 4, 5)], 15000, 1);
    expect(out.filter(f => f.geometry.kind === "line")).toHaveLength(1);
    expect(out.filter(f => f.geometry.kind === "point").map(f => f.layer).sort()).toEqual(["dotknoll", "udepression"]);
  });
  it("lämnar stora ringar, och gör ingen ny kulle där Karttapullautins knoll redan ligger", () => {
    const knoll: SourceFeature = { layer: "dotknoll", geometry: { kind: "point", at: [1, 0] } };
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(0, 0, 5, 15), ring(300, 0, 30, 10), knoll], 15000, 1);
    expect(out.filter(f => f.geometry.kind === "point")).toEqual([knoll]);
    expect(out.filter(f => f.geometry.kind === "line")).toHaveLength(2);
  });
  it("tar bort laserns kulle nära Karttapullautins eller inuti en kvarvarande liten toppkurva", () => {
    const laser = (x: number, y: number): SourceFeature => ({ layer: "dotknoll_laser", geometry: { kind: "point", at: [x, y] } });
    const knoll: SourceFeature = { layer: "dotknoll", geometry: { kind: "point", at: [200, 0] } };
    const out = smallRingsToPoints([ring(0, 0, 300, 10), ring(100, 0, 20, 15), knoll, laser(203, 0), laser(100, 0), laser(-150, 0)], 15000, 1);
    expect(out.filter(f => f.layer === "dotknoll_laser").map(f => (f.geometry as { at: readonly [number, number] }).at)).toEqual([[-150, 0]]);
  });
});

describe("en markering per kulle (ägaren 2026-11-13)", () => {
  const circle = (cx: number, cy: number, r: number): [number, number][] => Array.from({ length: 24 }, (_, i) =>
    [cx + r * Math.cos(i * Math.PI / 12), cy + r * Math.sin(i * Math.PI / 12)]);
  const point = (layer: string, x: number, y: number): SourceFeature => ({ layer, geometry: { kind: "point", at: [x, y] } });

  it("tar bort en liten formlinjering som har en punkthöjd (även avlång 110) i sig, men inte en större", () => {
    // 1:10 000/1:15 000: 2,5 mm = 37,5 m. En liten formlinje (16 m) med punkthöjd tas bort; en 40 m stor kurva behålls.
    const small: SourceFeature = { layer: "formline", geometry: { kind: "line", closed: true, points: circle(0, 0, 8) }, elevation: 12 };
    const smallAvlang: SourceFeature = { layer: "formline", geometry: { kind: "line", closed: true, points: circle(100, 0, 8) }, elevation: 12 };
    const large: SourceFeature = { layer: "contour", geometry: { kind: "line", closed: true, points: circle(200, 0, 20) }, elevation: 15 };
    const out = oneMarkPerKnoll([small, smallAvlang, large, point("dotknoll_laser", 0, 0), point("dotknoll_avlang", 100, 0), point("dotknoll", 200, 0)], 10000);
    expect(out).not.toContain(small);
    expect(out).not.toContain(smallAvlang);
    expect(out).toContain(large);
    expect(out.filter(feature => feature.geometry.kind === "point")).toHaveLength(3);
  });

  it("väljer mellan sten och punkthöjd på samma plats", () => {
    const stone = point("sten", 0, 0), laser = point("dotknoll_laser", 2, 1), stone2 = point("sten", 100, 0), pullautin = point("dotknoll", 101, 1);
    const out = oneMarkPerKnoll([stone, laser, stone2, pullautin, point("sten", 300, 0)], 10000);
    expect(out).toContain(laser); expect(out).not.toContain(stone);
    expect(out).toContain(stone2); expect(out).not.toContain(pullautin);
    expect(out).toHaveLength(3);
  });

  it("sluter en kort formlinje som nästan går runt, men inte en lång eller rak", () => {
    const hook: [number, number][] = circle(0, 0, 8).slice(0, 21);
    const straight: [number, number][] = [[0, 100], [10, 100], [20, 100], [30, 100]];
    const [closed, open] = closeFormlineHooks([
      { layer: "formline", geometry: { kind: "line", closed: false, points: hook } },
      { layer: "formline", geometry: { kind: "line", closed: false, points: straight } }
    ], 10000);
    expect(closed!.geometry.kind === "line" && closed!.geometry.closed).toBe(true);
    expect(open!.geometry.kind === "line" && open!.geometry.closed).toBe(false);
  });

  it("spatialt rutnät och förberäknad extentOf hanterar 500 toppkurvor, 1 000 laserkullar och 500 stenar snabbt och exakt", () => {
    const features: SourceFeature[] = [];
    for (let i = 0; i < 500; i += 1) {
      const x = (i % 25) * 120, y = Math.floor(i / 25) * 120;
      // Toppkurva med r = 20 m (area ~1 256 m² < 3 000 m², diameter 40 m > 25 m): täcker laserkullen i mitten.
      features.push({ layer: "contour", elevation: 20, geometry: { kind: "line", closed: true, points: circle(x, y, 20) } });
      features.push(point("dotknoll_laser", x, y));
      // En laserkulle utanför toppkurvan (50 m bort) står kvar och slår ut stenen intill den.
      features.push(point("dotknoll_laser", x + 50, y));
      features.push(point("sten", x + 51, y));
    }
    const started = performance.now();
    const out = smallRingsToPoints(features, 10_000, 1);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(out.filter(f => f.layer === "dotknoll_laser")).toHaveLength(500);
    expect(out.filter(f => f.layer === "sten")).toHaveLength(0);
    expect(out.filter(f => f.layer === "contour")).toHaveLength(500);
  });
});
