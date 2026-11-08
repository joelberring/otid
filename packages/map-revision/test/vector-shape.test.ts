import { describe, expect, it } from "vitest";
import { crsFromPrj, importLayers, parseShapefile, VectorParseError } from "../src";

/** ADR-0219 K4b: Shapefile med .dbf och .prj. Filerna byggs här (samma format som ArcGIS och QGIS skriver). */
type Ring = [number, number][];
function shp(records: ({ type: 1; at: [number, number] } | { type: 3 | 5; parts: Ring[] })[]): ArrayBuffer {
  const bodies = records.map(record => {
    if (record.type === 1) {
      const body = new DataView(new ArrayBuffer(20));
      body.setInt32(0, 1, true); body.setFloat64(4, record.at[0], true); body.setFloat64(12, record.at[1], true);
      return body.buffer;
    }
    const points = record.parts.flat();
    const body = new DataView(new ArrayBuffer(44 + record.parts.length * 4 + points.length * 16));
    body.setInt32(0, record.type, true);
    body.setInt32(36, record.parts.length, true); body.setInt32(40, points.length, true);
    let at = 0;
    record.parts.forEach((part, index) => { body.setInt32(44 + index * 4, at, true); at += part.length; });
    points.forEach(([x, y], index) => { const o = 44 + record.parts.length * 4 + index * 16; body.setFloat64(o, x, true); body.setFloat64(o + 8, y, true); });
    return body.buffer;
  });
  const total = 100 + bodies.reduce((sum, body) => sum + 8 + body.byteLength, 0);
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setInt32(0, 9994, false); view.setInt32(24, total / 2, false); view.setInt32(28, 1000, true);
  let offset = 100;
  bodies.forEach((body, index) => {
    view.setInt32(offset, index + 1, false); view.setInt32(offset + 4, body.byteLength / 2, false);
    out.set(new Uint8Array(body), offset + 8);
    offset += 8 + body.byteLength;
  });
  return out.buffer;
}
function dbf(field: string, values: string[]): ArrayBuffer {
  const length = 20, header = 32 + 32 + 1, record = 1 + length;
  const out = new Uint8Array(header + record * values.length + 1), view = new DataView(out.buffer);
  view.setUint8(0, 3); view.setUint32(4, values.length, true); view.setUint16(8, header, true); view.setUint16(10, record, true);
  out.set(new TextEncoder().encode(field), 32); out[43] = 67; out[48] = length;
  out[64] = 0x0d;
  values.forEach((value, index) => {
    const at = header + index * record;
    out[at] = 0x20;
    // Windows-1252: ä = 0xe4.
    const bytes = [...value].map(char => char === "ä" ? 0xe4 : char.charCodeAt(0));
    out.set(bytes.concat(Array(length - bytes.length).fill(0x20)), at + 1);
  });
  out[out.length - 1] = 0x1a;
  return out.buffer;
}

describe("Shapefile (K4b)", () => {
  it("läser punkter, linjer och ytor med hål, lagret ur .dbf och systemet ur .prj", () => {
    const outer: Ring = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
    const hole: Ring = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    const data = parseShapefile({ name: "baskarta.shp", shp: shp([
      { type: 5, parts: [outer, hole] },
      { type: 3, parts: [[[0, 20], [10, 20]], [[0, 30], [5, 30]]] },
      { type: 1, at: [5, 40] }
    ]), dbf: dbf("LAGER", ["Byggnad", "Stängsel", ""]), prj: 'PROJCS["SWEREF99_TM",GEOGCS["GCS_SWEREF99"],PROJECTION["Transverse_Mercator"]]' });
    expect(data.crs).toBe(3006);
    expect(data.features[0]).toEqual({ layer: "Byggnad", geometry: { kind: "area", rings: [outer.slice(0, -1), hole.slice(0, -1)] } });
    expect(importLayers(data).map(layer => [layer.name, layer.count])).toEqual([["Byggnad", 1], ["Stängsel", 2], ["baskarta", 1]]);
    expect(() => parseShapefile({ name: "x.shp", shp: new ArrayBuffer(10) })).toThrow(VectorParseError);
  });

  it("känner igen koordinatsystemen i .prj", () => {
    expect(crsFromPrj('PROJCS["SWEREF99 18 00",GEOGCS["SWEREF99"],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","3011"]]')).toBe(3011);
    expect(crsFromPrj('PROJCS["SWEREF99_18_00",GEOGCS["GCS_SWEREF99"]]')).toBe(3011);
    expect(crsFromPrj('PROJCS["RT90_2.5_gon_V",GEOGCS["GCS_RT_1990"]]')).toBe(3021);
    expect(crsFromPrj('PROJCS["WGS_1984_UTM_Zone_33N",GEOGCS["GCS_WGS_1984"]]')).toBe(32633);
    expect(crsFromPrj('PROJCS["ETRS_1989_UTM_Zone_32N",GEOGCS["GCS_ETRS_1989"]]')).toBe(25832);
    expect(crsFromPrj('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]')).toBe(4326);
    expect(crsFromPrj('PROJCS["Lokalt",GEOGCS["X"]]')).toBeUndefined();
  });
});
