import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { readVectorFiles } from "./map-project-vector-files";

/** ADR-0219 K4b: filerna som väljs i importen (en .zip med Shapefile, en DXF, en GeoJSON, inget av det). */
function emptyShp(): Uint8Array {
  const bytes = new Uint8Array(100), view = new DataView(bytes.buffer);
  view.setInt32(0, 9994, false); view.setInt32(24, 50, false); view.setInt32(28, 1000, true);
  return bytes;
}

describe("importens filer", () => {
  it("läser en Shapefile ur en zip med .prj bredvid", async () => {
    const zip = zipSync({ "data/hus.shp": emptyShp(), "data/hus.prj": new TextEncoder().encode('PROJCS["SWEREF99_18_00",GEOGCS["X"]]'),
      "__MACOSX/._hus.shp": new Uint8Array(4) });
    const read = await readVectorFiles([new File([zip], "baskarta.zip")]);
    expect(read).toMatchObject({ name: "hus.shp", data: { crs: 3011, features: [] } });
  });

  it("DXF, GeoJSON och annat", async () => {
    const dxf = ["0", "SECTION", "2", "ENTITIES", "0", "POINT", "8", "TRAD", "10", "1", "20", "2", "0", "ENDSEC", "0", "EOF"].join("\n");
    expect((await readVectorFiles([new File([dxf], "a.dxf")]))?.data.features).toHaveLength(1);
    expect((await readVectorFiles([new File(['{"type":"Point","coordinates":[18,59]}'], "a.geojson")]))?.data.crs).toBe(4326);
    expect(await readVectorFiles([new File(["x"], "a.txt")])).toBeUndefined();
  });
});
