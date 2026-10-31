import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminRouteChoice, ControlMapResponse } from "@o-tid/contracts";
import { readMapFile } from "@o-tid/map-file";
import { analyseLeg, buildCostModel, type LegAnalysis } from "@o-tid/route-choice";
import { courseTotal, legRows, plannedLegs, publishableLegs, routeChoiceOptions } from "./route-choice-view";

/**
 * Steg 60: motorn på den syntetiska kartan med sjön (fixtures/maps/vagval.omap) och banfilens kartlägen
 * (course-file-kartfil.xml), genom samma vy som arbetsytan. Sträckan 31–32 går tvärs över sjön och har vägval.
 */
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../fixtures/${name}`, import.meta.url)));
const COURSE = "10000000-0000-4000-8000-000000000001";
const at = { 31: { x: 15, y: 42 }, 32: { x: 42, y: 61 }, 33: { x: 76, y: 52 }, 34: { x: 98, y: 30 }, 35: { x: 82, y: 9 }, 36: { x: 50, y: 18 } };
const state: AdminRouteChoice = { formatVersion: 1, raceId: COURSE, settings: { version: 1 },
  mapFile: { sha256: "a".repeat(64), scale: 10_000, render: { pxPerMm: 8, originX: -2, originY: 102 }, georeference: null,
    image: { width: 992, height: 832 }, placement: "PAPER", mismatch: false },
  controls: Object.entries(at).map(([code, point]) => ({ code: Number(code), at: point })),
  courses: [{ courseId: COURSE, start: { x: 4, y: 8 }, finish: { x: 12, y: 4 }, routeRunners: 0 }], published: [], publishedMapSha256: null };
const courses = [{ courseId: COURSE, name: "Lång", classNames: ["H21"], start: null, finish: null, forking: null,
  variants: [{ code: null, controlCodes: [31, 32, 33, 34, 35, 36], entryCount: 1 }] }] as unknown as ControlMapResponse["courses"];

describe("vägvalen på den syntetiska kartan med sjön", () => {
  it("räknar banan och ger 31–32 vägval runt sjön", () => {
    const map = readMapFile(fixture("maps/vagval.omap"), "vagval.omap");
    const model = buildCostModel(map, { version: 1 });
    const legs = plannedLegs(routeChoiceOptions(courses)[0]!, state);
    const analyses = new Map<string, LegAnalysis>();
    for (const leg of legs) analyses.set(leg.key, analyseLeg(model, leg.input!, { version: 1 }));
    const rows = legRows(legs, analyses);
    const lake = rows.find(row => row.key === "31.1-32.1")!;
    expect(["ROUTE_CHOICE", "ABOUT_EQUAL"]).toContain(lake.verdictKind);
    expect(Number(lake.choices)).toBeGreaterThanOrEqual(2);
    // Runt sjön är längre än fågelvägen; sträckorna i öppen skog nästan raka.
    const lakeAnalysis = analyses.get("31.1-32.1")!;
    expect(lakeAnalysis.best!.meters).toBeGreaterThan(lakeAnalysis.straightMeters * 1.03);
    expect(rows.filter(row => row.key !== "31.1-32.1").every(row => row.verdictKind === "NO_CHOICE")).toBe(true);
    expect(courseTotal(legs, analyses)).toMatch(/^Hela banan: bästa vägen/);
    expect(publishableLegs(legs, analyses)).toHaveLength(7);
    // Alla symboler på fixturkartan finns i standardtabellen (999 är filens egen textsymbol).
    expect(model.unknownSymbols).toEqual([]);
  });
});
