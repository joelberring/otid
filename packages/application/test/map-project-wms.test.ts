import { describe, expect, it } from "vitest";
import { wmsTilePlan } from "../src/map-project-wms";
import { epsgOf, parseWmsCapabilities } from "../src/wms-capabilities";

const V130 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE WMS_Capabilities [ <!ENTITY x "y"> ]>
<wms:WMS_Capabilities xmlns:wms="http://www.opengis.net/wms" version="1.3.0">
  <wms:Service><wms:Name>WMS</wms:Name><wms:Title>Ortofoto &amp; flyg</wms:Title><wms:MaxWidth>2048</wms:MaxWidth><wms:MaxHeight>4096</wms:MaxHeight></wms:Service>
  <wms:Capability>
    <wms:Request><wms:GetMap><wms:Format>image/png</wms:Format><wms:Format>image/jpeg</wms:Format></wms:GetMap></wms:Request>
    <wms:Layer>
      <wms:Title>Alla</wms:Title>
      <wms:CRS>EPSG:4326</wms:CRS><wms:CRS>EPSG:3006</wms:CRS>
      <wms:Layer queryable="1"><wms:Name>ortofoto_2023</wms:Name><wms:Title>Ortofoto 2023</wms:Title></wms:Layer>
      <wms:Layer><wms:Title>Grupp utan namn</wms:Title>
        <wms:Layer><wms:Name>ortofoto_2020</wms:Name><wms:Title>Ortofoto 2020</wms:Title><wms:CRS>EPSG:3010</wms:CRS></wms:Layer>
      </wms:Layer>
      <wms:Layer><wms:Name>utan_titel</wms:Name></wms:Layer>
    </wms:Layer>
  </wms:Capability>
</wms:WMS_Capabilities>`;

const V111 = `<?xml version="1.0"?>
<WMT_MS_Capabilities version="1.1.1"><Service><Name>OGC:WMS</Name><Title><![CDATA[Äldre tjänst]]></Title></Service>
<Capability><Request><GetMap><Format>image/jpeg</Format></GetMap></Request>
<Layer><Title>Rot</Title><SRS>EPSG:4326 EPSG:3010</SRS>
  <Layer><Name>flyg</Name><Title>Flygbild</Title><SRS>EPSG:3006</SRS></Layer>
  <Layer><Name>annat</Name><Title>Annat</Title></Layer>
</Layer></Capability></WMT_MS_Capabilities>`;

describe("GetCapabilities", () => {
  it("1.3.0 med namnrymdsprefix: titel, format, storlek och lagren med namn (grupper utan namn hoppas över)", () => {
    const parsed = parseWmsCapabilities(V130)!;
    expect(parsed).toMatchObject({ title: "Ortofoto & flyg", version: "1.3.0", formats: ["image/png", "image/jpeg"], maxSide: 2048 });
    expect(parsed.layers.map(layer => [layer.name, layer.title])).toEqual([["ortofoto_2023", "Ortofoto 2023"], ["ortofoto_2020", "Ortofoto 2020"], ["utan_titel", "utan_titel"]]);
  });

  it("CRS ärvs från förälderlagret och läggs till i underlagret", () => {
    const [first, second, third] = parseWmsCapabilities(V130)!.layers;
    expect([...first!.epsgCodes].sort()).toEqual([3006, 4326]);
    expect([...second!.epsgCodes].sort()).toEqual([3006, 3010, 4326]);
    expect(third!.epsgCodes.has(3006)).toBe(true);
  });

  it("1.1.1 utan prefix: SRS med flera koder i en rad, ärvt SRS och lager utan SWEREF 99 TM", () => {
    const parsed = parseWmsCapabilities(V111)!;
    expect(parsed).toMatchObject({ title: "Äldre tjänst", version: "1.1.1", formats: ["image/jpeg"], maxSide: undefined });
    const [flyg, annat] = parsed.layers;
    expect([...flyg!.epsgCodes].sort()).toEqual([3006, 3010, 4326]);
    expect([...annat!.epsgCodes].sort()).toEqual([3010, 4326]);
  });

  it("andra svar än en lagerlista ger undefined (felmeddelande, HTML, tomt, skräp)", () => {
    for (const text of ["", "<html><body>404</body></html>", "<ServiceExceptionReport><ServiceException>fel</ServiceException></ServiceExceptionReport>", "inte xml <<", "<WMS_Capabilities version=\"1.3.0\"></WMS_Capabilities>"]) {
      expect(parseWmsCapabilities(text), text).toBeUndefined();
    }
  });

  it("EPSG-koder i olika skrivsätt", () => {
    expect(epsgOf("EPSG:3006")).toBe(3006);
    expect(epsgOf("epsg:3006")).toBe(3006);
    expect(epsgOf("urn:ogc:def:crs:EPSG::3006")).toBe(3006);
    expect(epsgOf("urn:ogc:def:crs:EPSG:6.18:3:3006")).toBe(3006);
    expect(epsgOf("http://www.opengis.net/def/crs/EPSG/0/3006")).toBe(3006);
    expect(epsgOf("CRS:84")).toBeUndefined();
  });
});

describe("bildrutor och världsfiler", () => {
  // Ungefär 2 × 1,3 km i SWEREF 99 TM (Älvsjö).
  const BOX = { south: 59.29, west: 18.0, north: 59.30, east: 18.04 };

  it("en bildruta med världsfil som pekar på mitten av första pixeln", () => {
    const tiles = wmsTilePlan(BOX, 3006, 2)!;
    expect(tiles).toHaveLength(1);
    const [tile] = tiles;
    expect(tile!.minE).toBeGreaterThan(600_000);
    expect(tile!.minN).toBeGreaterThan(6_500_000);
    expect(tile!.width).toBe(Math.ceil((tile!.maxE - tile!.minE) / 2));
    expect(tile!.world.split("\n").map(Number)).toEqual([2, 0, 0, -2, tile!.minE + 1, tile!.maxN - 1, 0]);
  });

  it("stora områden delas i rutor på högst 4 000 pixlar som ligger kant i kant och täcker rutan", () => {
    const tiles = wmsTilePlan(BOX, 3006, 0.25)!;
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.length).toBeLessThanOrEqual(16);
    for (const tile of tiles) {
      expect(Math.max(tile.width, tile.height)).toBeLessThanOrEqual(4000);
      expect((tile.maxE - tile.minE) / tile.width).toBeCloseTo(0.25, 6);
      expect((tile.maxN - tile.minN) / tile.height).toBeCloseTo(0.25, 6);
    }
    const columns = new Set(tiles.map(tile => tile.minE)).size, rows = new Set(tiles.map(tile => tile.minN)).size;
    expect(columns * rows).toBe(tiles.length);
    // Rutnätet: första raden överst (högsta nord), kolumnerna västerifrån; grannar möts exakt.
    expect(tiles[0]!.index).toBe(0);
    expect(tiles[1]!.minE).toBeCloseTo(tiles[0]!.maxE, 6);
    expect(tiles[columns]!.maxN).toBeCloseTo(tiles[0]!.minN, 6);
    const first = tiles[0]!, whole = wmsTilePlan(BOX, 3006, 2)![0]!;
    expect(first.minE).toBe(whole.minE);
    expect(first.maxN).toBe(whole.maxN);
    expect(Math.max(...tiles.map(tile => tile.maxE))).toBeGreaterThanOrEqual(whole.maxE - 2);
    expect(Math.min(...tiles.map(tile => tile.minN))).toBeLessThanOrEqual(whole.minN + 2);
    // Världsfilen för varje ruta pekar på mitten av dess första pixel.
    for (const tile of tiles) expect(tile.world.split("\n").map(Number).slice(4, 6)).toEqual([tile.minE + 0.125, tile.maxN - 0.125]);
  });

  it("tjänstens egen största bildstorlek ger fler, mindre rutor", () => {
    const normal = wmsTilePlan(BOX, 3006, 1)!, small = wmsTilePlan(BOX, 3006, 1, 512)!;
    expect(small.length).toBeGreaterThan(normal.length);
    expect(Math.max(...small.map(tile => Math.max(tile.width, tile.height)))).toBeLessThanOrEqual(512);
  });

  it("fler än 16 rutor ger undefined (välj grövre upplösning eller en etapp)", () => {
    const large = { south: 59.2, west: 17.9, north: 59.4, east: 18.3 };
    expect(wmsTilePlan(large, 3006, 0.25)).toBeUndefined();
    expect(wmsTilePlan(large, 3006, 2)).toBeDefined();
  });

  it("kartans eget system används när det ges", () => {
    const local = wmsTilePlan(BOX, 3011, 2)![0]!, national = wmsTilePlan(BOX, 3006, 2)![0]!;
    expect(local.minE).not.toBe(national.minE);
  });
});
