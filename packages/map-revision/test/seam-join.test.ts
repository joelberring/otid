import { describe, expect, it } from "vitest";
import { joinSeams, parseDxf, type SourceFeature } from "../src";

const line = (points: [number, number][], elevation?: number, layer = "contour"): SourceFeature =>
  ({ layer, ...(elevation !== undefined ? { elevation } : {}), geometry: { kind: "line", points, closed: false } });

describe("kurvorna fogas över rutornas skarvar", () => {
  it("fogar linjer på samma höjd vars ändar möts, åt båda hållen", () => {
    const joined = joinSeams([line([[0, 0], [10, 0]], 5), line([[20, 5], [10.2, 0.1]], 5), line([[-8, 3], [0, 0]], 5)]);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.geometry).toEqual({ kind: "line", closed: false, points: [[-8, 3], [0, 0], [10, 0], [20, 5]] });
    expect(joined[0]!.elevation).toBe(5);
  });
  it("sluter en kedja som möter sig själv och rör inte andra höjder eller icke-terränglager", () => {
    const ring = joinSeams([line([[0, 0], [10, 0], [10, 10]], 2.5), line([[10, 10], [0, 10], [0, 0.2]], 2.5)]);
    expect(ring).toHaveLength(1);
    expect(ring[0]!.geometry.kind === "line" && ring[0]!.geometry.closed).toBe(true);
    expect(joinSeams([line([[0, 0], [10, 0]], 5), line([[10, 0], [20, 0]], 7.5)])).toHaveLength(2);
    expect(joinSeams([line([[0, 0], [10, 0]], undefined, "staket"), line([[10, 0], [20, 0]], undefined, "staket")])).toHaveLength(2);
    expect(joinSeams([line([[0, 0], [10, 0]], undefined, "OSM spårväg"), line([[10, 0], [20, 0]], undefined, "OSM spårväg")])).toHaveLength(2);
    expect(joinSeams([line([[0, 0], [10, 0]], undefined, "small_depression"), line([[10, 0], [20, 0]], undefined, "small_depression")])).toHaveLength(2);
  });
  it("läser höjden ur DXF", () => {
    const dxf = ["0", "SECTION", "2", "ENTITIES", "0", "POLYLINE", "8", "contour", "38", "12.5", "0", "VERTEX", "8", "contour", "10", "1", "20", "2", "30", "12.5",
      "0", "VERTEX", "8", "contour", "10", "3", "20", "4", "30", "12.5", "0", "SEQEND", "0", "LWPOLYLINE", "8", "x", "10", "0", "20", "0", "10", "1", "20", "1",
      "0", "ENDSEC", "0", "EOF"].join("\n");
    const data = parseDxf(dxf);
    expect(data.features.map(feature => feature.elevation)).toEqual([12.5, undefined]);
  });
  it("fogar en lång kedja om 1 000 kurvbitar i båda riktningar utan O(N^2)-kopiering", () => {
    const pieces: SourceFeature[] = [];
    // Blanda framåt- och bakåtbitar så både framåt- och bakåtpasset växer stort.
    for (let i = 0; i < 1000; i += 1) {
      const seg: [number, number][] = i % 2 === 0 ? [[i * 10, 0], [(i + 1) * 10, 0]] : [[(i + 1) * 10, 0], [i * 10, 0]];
      pieces.push(line(seg, 15));
    }
    const ordered = [pieces[500]!, ...pieces.slice(501), ...pieces.slice(0, 500).reverse()];
    const started = performance.now();
    const joined = joinSeams(ordered);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.geometry.kind === "line" && joined[0]!.geometry.points).toHaveLength(1001);
  });

  it("fogar brantlinjer (201/202) huvud-mot-svans med exakt bevarad riktning, även i omvänd indataordning", () => {
    for (const layer of ["brant_opasserbar", "brant_passerbar", "brant_passerbar_taggar", "cliff", "201", "202"]) {
      // Samma riktning (väst -> öst), men levererade i omvänd ordning så bakåtpasset prövas.
      const joined = joinSeams([
        line([[20, 0], [30, 0]], undefined, layer),
        line([[10, 0], [20.1, 0]], undefined, layer),
        line([[0, 0], [10, 0]], undefined, layer)
      ]);
      expect(joined).toHaveLength(1);
      expect(joined[0]!.layer).toBe(layer);
      expect(joined[0]!.geometry).toEqual({ kind: "line", closed: false, points: [[0, 0], [10, 0], [20, 0], [30, 0]] });
    }
    // Sluten brantring över skarv sluts med bevarad riktning.
    const closedCliff = joinSeams([
      line([[0, 0], [10, 0], [10, 10]], undefined, "brant_opasserbar"),
      line([[10, 10], [0, 10], [0, 0.1]], undefined, "brant_opasserbar")
    ]);
    expect(closedCliff).toHaveLength(1);
    expect(closedCliff[0]!.geometry).toEqual({ kind: "line", closed: true, points: [[0, 0], [10, 0], [10, 10], [0, 10]] });
  });

  it("vänder ALDRIG motriktade brantlinjer (huvud-mot-huvud eller svans-mot-svans) och blandar inte brantklasser", () => {
    // Huvud-mot-huvud: A slutar vid (10, 0), B slutar också vid (10, 0).
    const headToHead = joinSeams([
      line([[0, 0], [10, 0]], undefined, "brant_opasserbar"),
      line([[20, 0], [10, 0]], undefined, "brant_opasserbar")
    ]);
    expect(headToHead).toHaveLength(2);
    expect(headToHead[0]!.geometry).toEqual({ kind: "line", closed: false, points: [[0, 0], [10, 0]] });
    expect(headToHead[1]!.geometry).toEqual({ kind: "line", closed: false, points: [[20, 0], [10, 0]] });

    // Svans-mot-svans: båda börjar vid (10, 0).
    const tailToTail = joinSeams([
      line([[10, 0], [0, 0]], undefined, "brant_passerbar"),
      line([[10, 0], [20, 0]], undefined, "brant_passerbar")
    ]);
    expect(tailToTail).toHaveLength(2);
    expect(tailToTail[0]!.geometry).toEqual({ kind: "line", closed: false, points: [[10, 0], [0, 0]] });
    expect(tailToTail[1]!.geometry).toEqual({ kind: "line", closed: false, points: [[10, 0], [20, 0]] });

    // Olika brantlager (201 vs 202) fogas inte ihop.
    const mixed = joinSeams([
      line([[0, 0], [10, 0]], undefined, "brant_opasserbar"),
      line([[10, 0], [20, 0]], undefined, "brant_passerbar")
    ]);
    expect(mixed).toHaveLength(2);
  });

  it("fogar diken (306), bäckar/fuktstråk (305) och stigar/spår (505–507) över skarvar åt båda hållen", () => {
    for (const layer of ["dike", "306", "fuktstrak", "fuktstrak_terrang", "bäck", "305", "spar_laser", "spar", "OSM stig", "505", "506", "507"]) {
      // Andra biten har vänd riktning (oriktade terränglinjer får vändas för att foga snyggt över skarven).
      const joined = joinSeams([
        line([[0, 0], [10, 0]], undefined, layer),
        line([[20, 2], [10.1, 0]], undefined, layer)
      ]);
      expect(joined).toHaveLength(1);
      expect(joined[0]!.layer).toBe(layer);
      expect(joined[0]!.geometry).toEqual({ kind: "line", closed: false, points: [[0, 0], [10, 0], [20, 2]] });
    }
  });
});
