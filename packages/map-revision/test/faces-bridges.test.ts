import { describe, expect, it } from "vitest";
import { faceAt, faceStages, withinBridgeShare, type FaceLine } from "../src/faces/index";

const line = (id: string, ...flat: number[]): FaceLine => ({ id, points: Array.from({ length: flat.length / 2 }, (_, at) => ({ x: flat[at * 2]!, y: flat[at * 2 + 1]! })) });
const ring = (id: string, ...flat: number[]): FaceLine => ({ ...line(id, ...flat), closed: true });
const options = { gapTolerance: 2 };
const lengths = (pieces: readonly { length: number }[]) => pieces.map(piece => Math.round(piece.length * 10) / 10);

describe("ytor ur linjer, steg 2: större glapp", () => {
  it("hörn som inte möts: förlängningarna sluts till skärningspunkten med två bitar", () => {
    // Kvarteret 20 × 20 där överkanten slutar 3 före hörnet och högerkanten 2 före.
    const stages = faceStages([line("kant", 17, 20, 0, 20, 0, 0, 20, 0, 20, 18)], options);
    expect(faceAt(stages.faces, { x: 10, y: 10 })).toBeUndefined();
    const wider = stages.bridged(4)!;
    expect(wider.bridges).toHaveLength(1);
    expect(wider.bridges[0]!.kind).toBe("corner");
    expect(lengths(wider.bridges[0]!.pieces)).toEqual([3, 2]);
    const face = faceAt(wider.faces, { x: 10, y: 10 })!;
    expect(face.area).toBeCloseTo(400, 6);
    expect(face.bridges).toEqual([0]);
    expect(face.bridgeLength).toBeCloseTo(5, 6);
    expect(face.closures).toEqual([]);
    expect(withinBridgeShare(face)).toBe(true);
    // Längre än glappet från någon av ändarna: inte sluten.
    expect(faceAt(stages.bridged(2.5)!.faces, { x: 10, y: 10 })).toBeUndefined();
  });

  it("hörnet kräver en rimlig vinkel: två ändar som nästan pekar åt samma håll sluts inte som hörn", () => {
    // Två kanter som löper nästan parallellt (under 30° emellan) mot en spets långt bort.
    const stages = faceStages([line("a", 0, 0, 10, 0), line("b", 0, 3, 10, 2)], options);
    expect(stages.bridged(4)!.bridges.filter(bridge => bridge.kind === "corner")).toEqual([]);
  });

  it("rak förlängning: en mellanvägg som slutar 3,5 före kanten förlängs och delar kvarteret", () => {
    const stages = faceStages([ring("kant", 0, 0, 20, 0, 20, 20, 0, 20), line("vägg", 10, 0, 10, 16.5)], options);
    // Vid grundtoleransen är kvarteret en ruta (väggen hänger).
    expect(faceAt(stages.faces, { x: 5, y: 10 })!.area).toBeCloseTo(400, 6);
    const wider = stages.bridged(4)!;
    expect(wider.bridges.map(bridge => [bridge.kind, lengths(bridge.pieces)])).toEqual([["extend", [3.5]]]);
    expect(faceAt(wider.faces, { x: 5, y: 10 })!.area).toBeCloseTo(200, 6);
    expect(faceAt(wider.faces, { x: 15, y: 10 })!.area).toBeCloseTo(200, 6);
  });

  it("brygga mellan två ändar som pekar mot varandra", () => {
    // Överkanten har en öppning på 3,5 mellan x = 8 och x = 11,5.
    const stages = faceStages([line("kant", 8, 20, 0, 20, 0, 0, 20, 0, 20, 20, 11.5, 20)], options);
    expect(faceAt(stages.faces, { x: 10, y: 10 })).toBeUndefined();
    const wider = stages.bridged(4)!;
    expect(wider.bridges.map(bridge => [bridge.kind, lengths(bridge.pieces)])).toEqual([["bridge", [3.5]]]);
    expect(faceAt(wider.faces, { x: 10, y: 10 })!.area).toBeCloseTo(400, 6);
    // Steg 1 sparas och steg 2 räknas en gång per glapp.
    expect(stages.bridged(4)).toBe(wider);
    expect(stages.bridged(2)!.faces).toBe(stages.faces);
  });

  it("ändar som pekar bort från varandra överbryggas inte", () => {
    // Två parallella kanter vars ändar ligger drygt 3 isär men pekar åt var sitt håll, förbi varandra.
    const stages = faceStages([line("a", 0, 0, 0, 10), line("b", 3, 21, 3, 11)], options);
    expect(stages.bridged(4)!.bridges).toEqual([]);
  });

  it("20 %-regeln: en liten ruta som bara blir sluten med långa bryggor räknas inte som sluten", () => {
    // Rutan 6 × 6 med en öppning på 3,5 i överkanten: bryggan är 15 % av omkretsen och duger.
    const one = faceStages([line("kant", 1, 6, 0, 6, 0, 0, 6, 0, 6, 6, 4.5, 6)], options).bridged(4)!;
    expect(withinBridgeShare(faceAt(one.faces, { x: 3, y: 3 })!)).toBe(true);
    // Samma ruta med en öppning också i underkanten: 7 av 24 (29 %), rutan rinner ut.
    const two = faceStages([line("vänster", 1, 6, 0, 6, 0, 0, 1, 0), line("höger", 4.5, 0, 6, 0, 6, 6, 4.5, 6)], options).bridged(4)!;
    const face = faceAt(two.faces, { x: 3, y: 3 })!;
    expect(face.bridges).toHaveLength(2);
    expect(withinBridgeShare(face)).toBe(false);
  });

  it("en öppning bredare än glappet förblir öppen", () => {
    const stages = faceStages([line("kant", 7, 20, 0, 20, 0, 0, 20, 0, 20, 20, 12, 20)], options);
    expect(faceAt(stages.bridged(4)!.faces, { x: 10, y: 10 })).toBeUndefined();
    expect(faceAt(stages.bridged(8)!.faces, { x: 10, y: 10 })!.area).toBeCloseTo(400, 6);
  });

  it("ger upp efter tidsgränsen", () => {
    const stages = faceStages([line("kant", 8, 20, 0, 20, 0, 0, 20, 0, 20, 20, 11.5, 20)], options);
    expect(stages.bridged(4, performance.now() - 1)).toBeUndefined();
    // Utan tidsgräns räknas det som vanligt efteråt.
    expect(stages.bridged(4)!.bridges).toHaveLength(1);
  });
});
