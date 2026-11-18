import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { LASER_TRACK_LAYER, snapPathsToTracks, tracksOffFields } from "../src/base-map/path-snap";

const line = (layer: string, points: [number, number][]): SourceFeature => ({ layer, geometry: { kind: "line", closed: false, points } });

describe("OpenStreetMaps stigar till laserns fåror (ägaren 2026-11-17)", () => {
  it("en stig 8 m vid sidan av fåran flyttas till den; vägen vid korsningen ligger kvar", () => {
    const track = line(LASER_TRACK_LAYER, [[0, 108], [300, 108]]);
    const path = line("OSM stig", [[-100, 100], [0, 100], [300, 100], [400, 100]]);
    const road = line("OSM väg (unclassified)", [[-100, 0], [-100, 200]]);
    const out = snapPathsToTracks([track, path, line("OSM väg (unclassified)", [[-100, 100], [-150, 100]]), road]);
    expect(out.moved).toBe(1);
    const moved = out.features.find(feature => feature.layer === "OSM stig")!.geometry as unknown as { points: [number, number][] };
    // Mitt på ligger stigen i fåran, ändarna (korsningen) där de var.
    const yAt = (x: number) => { const k = moved.points.findIndex(point => point[0] >= x); const [ax, ay] = moved.points[k - 1]!, [bx, by] = moved.points[k]!; return ay + (by - ay) * (x - ax) / (bx - ax); };
    for (const x of [60, 150, 240]) expect(Math.abs(yAt(x) - 108)).toBeLessThan(0.6);
    // Avtoningen: nära korsningen vid x = −100 nästan orörd.
    expect(Math.abs(yAt(-95) - 100)).toBeLessThan(2);
    expect(moved.points[0]).toEqual([-100, 100]);
    // Fåran är samma spår som stigen och tas bort.
    expect(out.features.some(feature => feature.layer === LASER_TRACK_LAYER)).toBe(false);
  });
  it("en fåra tvärs över stigen flyttar den inte och står kvar som ett nytt spår", () => {
    const track = line(LASER_TRACK_LAYER, [[150, 0], [150, 200]]);
    const path = line("OSM stig", [[0, 100], [300, 100]]);
    const out = snapPathsToTracks([track, path]);
    expect(out.moved).toBe(0);
    expect(out.features.filter(feature => feature.layer === LASER_TRACK_LAYER).length).toBe(1);
  });
  it("utan fåror ändras inget", () => {
    const features = [line("OSM stig", [[0, 0], [100, 0]])];
    expect(snapPathsToTracks(features).features).toEqual(features);
  });
});

describe("laserns fåror på åker (ägaren 2026-11-18)", () => {
  it("delen på åkern tas bort, delen i skogen blir kvar, korta stumpar försvinner", () => {
    const field: SourceFeature = { layer: "aker", geometry: { kind: "area", rings: [[[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]]] } };
    const across: SourceFeature = { layer: "spar_laser", geometry: { kind: "line", closed: false, points: [[100, 100], [400, 100]] } };
    const stub: SourceFeature = { layer: "spar_laser", geometry: { kind: "line", closed: false, points: [[50, 50], [215, 50]] } };
    const inside: SourceFeature = { layer: "spar_laser", geometry: { kind: "line", closed: false, points: [[20, 20], [180, 20]] } };
    const out = tracksOffFields([field, across, stub, inside]);
    const tracks = out.filter(feature => feature.layer === "spar_laser");
    expect(tracks).toHaveLength(1);
    const xs = tracks[0]!.geometry.kind === "line" ? tracks[0]!.geometry.points.map(([x]) => x) : [];
    expect(Math.min(...xs)).toBeGreaterThan(199);
    expect(Math.max(...xs)).toBeCloseTo(400, 0);
    expect(out).toContain(field);
  });
  it("OpenStreetMaps odlade ytor räknas också, och utan åker lämnas fårorna orörda", () => {
    const farmland: SourceFeature = { layer: "OSM markanvändning (farmland)", geometry: { kind: "line", closed: true, points: [[0, 0], [200, 0], [200, 200], [0, 200]] } };
    const track: SourceFeature = { layer: "spar_laser", geometry: { kind: "line", closed: false, points: [[20, 20], [180, 20]] } };
    expect(tracksOffFields([track], [farmland])).toHaveLength(0);
    expect(tracksOffFields([track])).toEqual([track]);
  });
});
