import type { SourceData } from "../src";
import { describe, expect, it } from "vitest";
import { baseMapOutputs, clipWgs84, mergeBaseMap } from "../src/base-map/merge";
import { joinStages } from "../src/base-map/stages";

const data = (...layers: string[]): SourceData => ({ skipped: 0, features: layers.map(layer => ({ layer, geometry: { kind: "point" as const, at: [664900, 6576600] as [number, number] } })) });

describe("grundkartan", () => {
  it("en opasserbar brant som är för kort för två taggar blir en brant", () => {
    const cliff = (length: number) => ({ layer: "brant_opasserbar", geometry: { kind: "line" as const, closed: false, points: [[0, 0], [length, 0]] as [number, number][] } });
    // 1:10 000: två taggar kräver 7,5 m, och normens kortaste brant är 6 m (kortare tas inte med alls).
    const merged = mergeBaseMap([{ name: "brantlinjer.dxf", data: { skipped: 0, features: [cliff(5), cliff(7), cliff(8)] } }], undefined, 10_000);
    expect(merged.features.map(feature => feature.layer)).toEqual(["brant_passerbar", "brant_opasserbar"]);
    // I 1:15 000 behövs 11,25 m för två taggar och 9 m för att alls tas med.
    expect(mergeBaseMap([{ name: "brantlinjer.dxf", data: { skipped: 0, features: [cliff(8), cliff(10)] } }], undefined, 15_000).features.map(feature => feature.layer)).toEqual(["brant_passerbar"]);
  });

  it("laserns små kullar ersätter Karttapullautins knollar, groparna finns kvar (ägaren 2026-11-11)", () => {
    const knolls = { name: "knollar.dxf", data: data("dotknoll", "udepression") };
    expect(mergeBaseMap([knolls]).features.map(feature => feature.layer)).toEqual(["dotknoll", "udepression"]);
    expect(mergeBaseMap([knolls, { name: "berg.dxf", data: data("dotknoll_laser") }]).features.map(feature => feature.layer)).toEqual(["udepression", "dotknoll_laser"]);
  });

  it("laserns stenar läggs inte i grundkartan (ägaren 2026-11-15: de låg nästan aldrig där kartritarna har stenar)", () => {
    const rock = { name: "berg.dxf", data: data("sten", "stort_block", "dotknoll_laser") };
    expect(mergeBaseMap([rock]).features.map(feature => feature.layer)).toEqual(["dotknoll_laser"]);
  });

  it("väljer delarna i ordning: brantlinjer före strecken, marktäckets sankmark före den uträknade fuktigheten", () => {
    const all = ["karta.png", "karta.pgw", "kurvor.dxf", "formlinjer.dxf", "branter.dxf", "stup.dxf", "knollar.dxf", "fukt.png", "fukt.dxf", "vegetation.dxf",
      "brantlinjer.dxf", "vatten.geojson"];
    expect(baseMapOutputs(all)).toEqual(["kurvor.dxf", "formlinjer.dxf", "brantlinjer.dxf", "knollar.dxf", "vatten.geojson", "fukt.dxf", "vegetation.dxf"]);
    expect(baseMapOutputs([...all, "marktacke.geojson", "byggnader.geojson"]))
      .toEqual(["kurvor.dxf", "formlinjer.dxf", "brantlinjer.dxf", "knollar.dxf", "vatten.geojson", "marktacke.geojson", "byggnader.geojson", "fukt.dxf", "vegetation.dxf"]);
    expect(baseMapOutputs(all.filter(name => name !== "brantlinjer.dxf" && name !== "vatten.geojson")))
      .toEqual(["kurvor.dxf", "formlinjer.dxf", "knollar.dxf", "fukt.dxf", "vegetation.dxf", "branter.dxf", "stup.dxf"]);
    expect(baseMapOutputs(["karta.png"])).toEqual([]);
  });

  it("slår ihop med OpenStreetMap i SWEREF 99 TM utan det som redan finns", () => {
    const osm: SourceData = { crs: 4326, skipped: 1, features: [
      { layer: "OSM stig", geometry: { kind: "line", closed: false, points: [[17.87, 59.29], [17.88, 59.29]] } },
      { layer: "OSM byggnad", geometry: { kind: "area", rings: [[[17.87, 59.29], [17.871, 59.29], [17.871, 59.291]]] } },
      { layer: "OSM vatten", geometry: { kind: "area", rings: [[[17.87, 59.29], [17.871, 59.29], [17.871, 59.291]]] } },
      { layer: "OSM brant (cliff)", geometry: { kind: "line", closed: false, points: [[17.87, 59.29], [17.88, 59.29]] } },
      { layer: "OSM markanvändning (residential)", geometry: { kind: "area", rings: [[[17.87, 59.29], [17.872, 59.29], [17.872, 59.292]]] } },
      { layer: "OSM markanvändning (forest)", geometry: { kind: "area", rings: [[[17.87, 59.29], [17.872, 59.29], [17.872, 59.292]]] } }] };
    const laser = [{ name: "kurvor.dxf", data: data("contour") }, { name: "vegetation.dxf", data: data("oppen_mark", "gron_lattlopt") }];
    const merged = mergeBaseMap(laser, osm);
    expect(merged.crs).toBe(3006);
    expect(merged.skipped).toBe(1);
    expect(merged.features.map(feature => feature.layer)).toEqual(["contour", "oppen_mark", "gron_lattlopt", "OSM stig", "OSM byggnad", "tomtmark_osm"]);
    const path = merged.features[3]!.geometry;
    // Kungshatt ligger kring 664 000 öst, 6 576 000 nord.
    const [east, north] = path.kind === "line" ? path.points[0]! : [0, 0];
    expect(east).toBeGreaterThan(660_000); expect(east).toBeLessThan(668_000);
    expect(north).toBeGreaterThan(6_572_000); expect(north).toBeLessThan(6_580_000);
    // Med Lantmäteriets marktäcke och byggnader: laserns öppna mark byter namn, och husen tas därifrån.
    // Marktäckets låga bebyggelse och OpenStreetMaps bostadsområden blir tomtmark.
    const withLand = mergeBaseMap([...laser, { name: "marktacke.geojson", data: data("oppen_mark", "aker", "bebyggelse_lag") }, { name: "byggnader.geojson", data: data("byggnad") }], osm);
    expect(withLand.features.map(feature => feature.layer)).toEqual(["contour", "oppen_mark_laser", "gron_lattlopt", "oppen_mark", "aker", "tomtmark_marktacke", "byggnad", "OSM stig", "tomtmark_osm"]);
  });

  it("räknar klipprutan till latitud och longitud", () => {
    const box = clipWgs84({ minX: 664780, minY: 6576500, maxX: 665080, maxY: 6576800 })!;
    expect(box.south).toBeGreaterThan(59.28); expect(box.north).toBeLessThan(59.31);
    expect(box.west).toBeGreaterThan(17.85); expect(box.east).toBeLessThan(17.92);
    expect(box.north).toBeGreaterThan(box.south);
  });
});

describe("lutningsstreck på sänkor", () => {
  it("sätter ett streck mitt på den längsta sträckan, mot sänkans mitt", async () => {
    const { depressionTick } = await import("../src/base-map/merge");
    const [tick] = depressionTick({ layer: "depression", geometry: { kind: "line", closed: true, points: [[0, 0], [40, 0], [40, 10], [0, 10]] } });
    expect(tick?.layer).toBe("lutningsstreck");
    expect(tick?.geometry).toEqual({ kind: "point", at: [20, 0], toward: [20, 5] });
    expect(depressionTick({ layer: "contour", geometry: { kind: "line", closed: true, points: [[0, 0], [40, 0], [40, 10], [0, 10]] } })).toEqual([]);
  });
});

describe("strandlinjen", () => {
  it("ger en sluten linje för stranden och en för varje ö", async () => {
    const { shoreLines } = await import("../src/base-map/merge");
    const lake = { layer: "vatten", geometry: { kind: "area" as const, rings: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], [[40, 40], [60, 40], [60, 60], [40, 40]]] as [number, number][][] } };
    const around = [{ layer: "kurvor", geometry: { kind: "line" as const, closed: false, points: [[-50, -50], [200, 200]] as [number, number][] } }];
    const lines = shoreLines([lake, { layer: "aker", geometry: lake.geometry }, ...around]);
    expect(lines.map(line => line.layer)).toEqual(["strandlinje", "strandlinje"]);
    expect(lines[0]!.geometry.kind === "line" && lines[0]!.geometry.closed).toBe(true);
  });
  it("körningens kant är ingen strand: vatten som skärs av kanten får en öppen linje", async () => {
    const { shoreLines } = await import("../src/base-map/merge");
    // Underlaget når från x = 0 till 300; sjön är avskuren längs x = 0.
    const lake = { layer: "vatten", geometry: { kind: "area" as const, rings: [[[0, 0], [100, 0], [120, 50], [100, 100], [0, 100], [0, 0]]] as [number, number][][] } };
    const around = [{ layer: "kurvor", geometry: { kind: "line" as const, closed: false, points: [[0, -80], [300, 250]] as [number, number][] } }];
    const lines = shoreLines([lake, ...around]);
    expect(lines).toHaveLength(1);
    const geometry = lines[0]!.geometry;
    expect(geometry.kind === "line" && !geometry.closed && geometry.points).toEqual([[0, 0], [100, 0], [120, 50], [100, 100], [0, 100]]);
  });
});

describe("skarvfri sammanslagning av terränglinjer i mergeBaseMap", () => {
  it("fogar brantlinjer över skarv före längdkravet med bevarad riktning och vänder inte motriktade branter", () => {
    // Två 7 m halvor av en 14 m opasserbar brant över skarv vid x = 100 (1:15 000 kräver 9 m minCliff och 11,25 m för två taggar).
    const merged = mergeBaseMap([{
      name: "brantlinjer.dxf",
      data: {
        skipped: 0,
        features: [
          { layer: "brant_opasserbar", geometry: { kind: "line", closed: false, points: [[93, 0], [100, 0]] } },
          { layer: "brant_opasserbar", geometry: { kind: "line", closed: false, points: [[100, 0], [107, 0]] } },
          // Motriktade 10 m passerbara branter (huvud-mot-huvud vid x = 100) får INTE vändas ihop.
          { layer: "brant_passerbar", geometry: { kind: "line", closed: false, points: [[90, 20], [100, 20]] } },
          { layer: "brant_passerbar", geometry: { kind: "line", closed: false, points: [[110, 20], [100, 20]] } }
        ]
      }
    }], undefined, 15_000);
    const impassable = merged.features.filter(feature => feature.layer === "brant_opasserbar");
    expect(impassable).toHaveLength(1);
    expect(impassable[0]!.geometry).toEqual({ kind: "line", closed: false, points: [[93, 0], [100, 0], [107, 0]] });
    const passable = merged.features.filter(feature => feature.layer === "brant_passerbar");
    expect(passable).toHaveLength(2);
    expect(passable.map(feature => feature.geometry.kind === "line" ? feature.geometry.points : [])).toEqual([[[90, 20], [100, 20]], [[110, 20], [100, 20]]]);
  });

  it("fogar diken, fuktstråk och spår över skarv (så 20 + 20 m spår överlever minRun = 30 m)", () => {
    const merged = mergeBaseMap([
      { name: "diken.dxf", data: { skipped: 0, features: [
        { layer: "dike", geometry: { kind: "line", closed: false, points: [[80, 10], [100, 10]] } },
        { layer: "dike", geometry: { kind: "line", closed: false, points: [[120, 10], [100, 10]] } },
        { layer: "fuktstrak_terrang", geometry: { kind: "line", closed: false, points: [[80, 30], [100, 30]] } },
        { layer: "fuktstrak_terrang", geometry: { kind: "line", closed: false, points: [[100, 30], [120, 30]] } }
      ] } },
      { name: "fukt.dxf", data: { skipped: 0, features: [
        { layer: "fuktstrak", geometry: { kind: "line", closed: false, points: [[80, 50], [100, 50]] } },
        { layer: "fuktstrak", geometry: { kind: "line", closed: false, points: [[100, 50], [120, 50]] } }
      ] } },
      { name: "spar.dxf", data: { skipped: 0, features: [
        { layer: "spar_laser", geometry: { kind: "line", closed: false, points: [[80, 70], [100, 70]] } },
        { layer: "spar_laser", geometry: { kind: "line", closed: false, points: [[100, 70], [120, 70]] } }
      ] } }
    ]);
    expect(merged.features.filter(feature => feature.layer === "dike")).toHaveLength(1);
    expect(merged.features.filter(feature => feature.layer === "fuktstrak_terrang")).toHaveLength(1);
    expect(merged.features.filter(feature => feature.layer === "fuktstrak")).toHaveLength(1);
    const tracks = merged.features.filter(feature => feature.layer === "spar_laser");
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.geometry.kind === "line" && tracks[0]!.geometry.points[0]![0]).toBeCloseTo(80, 1);
    expect(tracks[0]!.geometry.kind === "line" && tracks[0]!.geometry.points.at(-1)![0]).toBeCloseTo(120, 1);
  });

  it("joinStages + mergeBaseMap levererar skarvfritt resultat för branter, diken, spår, vegetation, fukt, berg och belagt", () => {
    const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const parts = [
      { name: "brantlinjer.dxf", data: { skipped: 0, features: [{ layer: "brant_opasserbar", geometry: { kind: "line" as const, closed: false, points: [[93, 10], [107, 10]] as [number, number][] } }] } },
      { name: "diken.dxf", data: { skipped: 0, features: [{ layer: "dike", geometry: { kind: "line" as const, closed: false, points: [[80, 20], [120, 20]] as [number, number][] } }] } },
      { name: "spar.dxf", data: { skipped: 0, features: [{ layer: "spar_laser", geometry: { kind: "line" as const, closed: false, points: [[75, 30], [125, 30]] as [number, number][] } }] } },
      { name: "vegetation.dxf", data: { skipped: 0, features: [
        { layer: "gron_lattlopt", geometry: { kind: "line" as const, closed: true, points: rect(60, 40, 140, 80) } },
        { layer: "gron_lattlopt", geometry: { kind: "line" as const, closed: true, points: rect(90, 50, 110, 70) } }
      ] } },
      { name: "fukt.dxf", data: { skipped: 0, features: [
        { layer: "blott", geometry: { kind: "line" as const, closed: true, points: rect(60, 85, 140, 98) } },
        { layer: "fuktstrak", geometry: { kind: "line" as const, closed: false, points: [[60, 91], [140, 91]] as [number, number][] } }
      ] } },
      { name: "berg.dxf", data: { skipped: 0, features: [{ layer: "berg_i_dagen", geometry: { kind: "line" as const, closed: true, points: rect(70, 5, 130, 15) } }] } },
      { name: "belagt.dxf", data: { skipped: 0, features: [
        { layer: "belagd_yta_laser", geometry: { kind: "line" as const, closed: true, points: rect(60, 110, 140, 150) } },
        { layer: "belagd_yta_laser", geometry: { kind: "line" as const, closed: true, points: [[85, 120], [85, 140], [115, 140], [115, 120]] as [number, number][] } }
      ] } }
    ];
    const staged = joinStages([
      { box: { minX: 0, minY: 0, maxX: 100, maxY: 200 }, parts },
      { box: { minX: 100, minY: 0, maxX: 200, maxY: 200 }, parts }
    ]);
    const merged = mergeBaseMap(staged, undefined, 15_000, undefined, "ISSPROM");
    expect(merged.features.filter(feature => feature.layer === "brant_opasserbar")).toHaveLength(1);
    expect(merged.features.filter(feature => feature.layer === "dike")).toHaveLength(1);
    expect(merged.features.filter(feature => feature.layer === "spar_laser")).toHaveLength(1);
    expect(merged.features.filter(feature => feature.layer === "fuktstrak")).toHaveLength(1);
    expect(merged.features.filter(feature => feature.layer === "blott")).toHaveLength(1);
    expect(merged.features.filter(feature => feature.layer === "berg_i_dagen")).toHaveLength(1);
    const veg = merged.features.filter(feature => feature.layer === "gron_lattlopt");
    expect(veg).toHaveLength(1);
    expect(veg[0]!.geometry.kind === "area" && veg[0]!.geometry.rings).toHaveLength(2);
    const paved = merged.features.filter(feature => feature.layer === "belagd_yta_laser");
    expect(paved).toHaveLength(1);
    expect(paved[0]!.geometry.kind === "area" && paved[0]!.geometry.rings).toHaveLength(2);
  });
});
