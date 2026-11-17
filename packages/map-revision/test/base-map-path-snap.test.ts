import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { LASER_TRACK_LAYER, snapPathsToTracks } from "../src/base-map/path-snap";

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
