import type { SourceData } from "@o-tid/map-revision";
import { describe, expect, it } from "vitest";
import { baseMapOutputs, clipWgs84, mergeBaseMap } from "./map-project-base-map";

const data = (...layers: string[]): SourceData => ({ skipped: 0, features: layers.map(layer => ({ layer, geometry: { kind: "point" as const, at: [664900, 6576600] as [number, number] } })) });

describe("grundkartan", () => {
  it("en opasserbar brant som är för kort för två taggar blir en brant", () => {
    const cliff = (length: number) => ({ layer: "brant_opasserbar", geometry: { kind: "line" as const, closed: false, points: [[0, 0], [length, 0]] as [number, number][] } });
    const merged = mergeBaseMap([{ name: "brantlinjer.dxf", data: { skipped: 0, features: [cliff(14), cliff(16)] } }], undefined, 10_000);
    expect(merged.features.map(feature => feature.layer)).toEqual(["brant_passerbar", "brant_opasserbar"]);
    // I 1:15 000 behövs 22,5 m.
    expect(mergeBaseMap([{ name: "brantlinjer.dxf", data: { skipped: 0, features: [cliff(20)] } }], undefined, 15_000).features[0]!.layer).toBe("brant_passerbar");
  });

  it("laserns små kullar ersätter Karttapullautins knollar, groparna finns kvar (ägaren 2026-11-11)", () => {
    const knolls = { name: "knollar.dxf", data: data("dotknoll", "udepression") };
    expect(mergeBaseMap([knolls]).features.map(feature => feature.layer)).toEqual(["dotknoll", "udepression"]);
    expect(mergeBaseMap([knolls, { name: "berg.dxf", data: data("dotknoll_laser") }]).features.map(feature => feature.layer)).toEqual(["udepression", "dotknoll_laser"]);
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
    const { depressionTick } = await import("./map-project-base-map");
    const [tick] = depressionTick({ layer: "depression", geometry: { kind: "line", closed: true, points: [[0, 0], [40, 0], [40, 10], [0, 10]] } });
    expect(tick?.layer).toBe("lutningsstreck");
    expect(tick?.geometry).toEqual({ kind: "point", at: [20, 0], toward: [20, 5] });
    expect(depressionTick({ layer: "contour", geometry: { kind: "line", closed: true, points: [[0, 0], [40, 0], [40, 10], [0, 10]] } })).toEqual([]);
  });
});
