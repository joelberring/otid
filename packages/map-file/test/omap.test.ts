import { describe, expect, it } from "vitest";
import { MapFileError, readMapFile, type ParsedMap } from "../src";
import { seededRandom } from "./ocd-builder";

const encode = (text: string) => new TextEncoder().encode(text);

/** Handskriven, minimal Mapper-fil med de delar läsaren använder. */
const OMAP = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000" auxiliary_scale_factor="0.9999" grivation="2.5">
  <ref_point x="1000" y="-2000"/>
  <projected_crs id="EPSG"><spec language="PROJ.4">+init=epsg:3011</spec><parameter>3011</parameter><ref_point x="150000" y="6580000"/></projected_crs>
</georeferencing>
<colors count="4">
<color priority="0" name="Lila" c="0.35" m="0.85" y="0" k="0" opacity="1"><spotcolors knockout="true"><component factor="1" spotcolor="3"/></spotcolors><cmyk method="spotcolor"/><rgb method="cmyk" r="0.65" g="0.15" b="1"/></color>
<color priority="1" name="Svart" c="0" m="0" y="0" k="1" opacity="1"><cmyk method="custom"/><rgb method="cmyk" r="0" g="0" b="0"/></color>
<color priority="2" name="Gul &amp; grön" c="0" m="0.27" y="0.79" k="0" opacity="0.5"><cmyk method="custom"/><rgb method="cmyk" r="1" g="0.73" b="0.21"/></color>
<color priority="3" name="Purple" c="0.35" m="0.85" y="0" k="0" opacity="1"><spotcolors><namedcolor>Purple</namedcolor></spotcolors><cmyk method="custom"/><rgb method="cmyk" r="0.65" g="0.15" b="1"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="6" id="test">
<symbol type="2" id="0" code="101" name="Höjdkurva"><line_symbol color="1" line_width="140" join_style="2" cap_style="1"/><icon src="data:image/png;base64,AAAA"/></symbol>
<symbol type="1" id="1" code="105.100" name="Punkt"><point_symbol inner_radius="250" inner_color="1" outer_width="0" outer_color="-1" elements="0"/></symbol>
<symbol type="4" id="2" code="406.0" name="Skog"><area_symbol inner_color="2" patterns="1"><pattern type="1" angle="1.5708" line_spacing="1500" color="1" line_width="400"/></area_symbol></symbol>
<symbol type="8" id="3" code="902.0" name="Text"><text_symbol><font family="Arial" size="4000" bold="true"/><text color="1"/></text_symbol></symbol>
<symbol type="16" id="4" code="301.0" name="Sjö"><combined_symbol parts="2"><part private="true"><symbol type="4" code="301.0" name="Sjö yta"><area_symbol inner_color="2" patterns="0"/></symbol></part><part symbol="0"/></combined_symbol></symbol>
<symbol type="32" id="5" code="999.0" name="Okänd"/>
</symbols>
<parts count="1" current="0"><part name="del"><objects count="7">
<object type="1" symbol="0"><coords count="5">0 0 1;1000 0;2000 -1000;2000 -2000;3000 -2000;</coords></object>
<object type="0" symbol="1" rotation="1.5707963"><coords count="1">5000 -6000;</coords></object>
<object type="1" symbol="2"><coords count="9">0 0;10000 0;10000 -10000;0 -10000;0 0 18;2000 -2000;4000 -2000;4000 -4000;2000 -2000 18;</coords><pattern rotation="0.5"><coord x="0" y="0"/></pattern></object>
<object type="4" symbol="3" h_align="0" v_align="0"><coords count="1">100 -200;</coords><text>Djurgårds&amp;brunn</text></object>
<object type="1" symbol="4"><coords count="4">0 0;1000 0;1000 -1000;0 0 18;</coords></object>
<object type="1" symbol="-3"><coords count="2">0 0;1 1;</coords></object>
<object type="7" symbol="0"><coords count="1">0 0;</coords></object>
<object type="1" symbol="77"><coords count="2">0 0;1 1;</coords></object>
</objects></part></parts>
</barrier>
</map>
`;

function read(text = OMAP): ParsedMap {
  return readMapFile(encode(text), "test.omap");
}

describe("Mapper-läsaren", () => {
  it("känner igen formatet och versionen", () => {
    const map = read();
    expect(map.format).toBe("OMAP");
    expect(map.version).toBe("Mapper v9");
  });

  it("läser färger med rank, CMYK, RGB, opacitet och dekorfärg", () => {
    const { colors } = read();
    expect(colors.map(color => [color.id, color.rank, color.name])).toEqual([[0, 0, "Lila"], [1, 1, "Svart"], [2, 2, "Gul & grön"], [3, 3, "Purple"]]);
    expect(colors[0]!.cmyk).toEqual({ c: 0.35, m: 0.85, y: 0, k: 0 });
    expect(colors[0]!.rgb).toEqual({ r: 0.65, g: 0.15, b: 1 });
    expect(colors[0]!.spot).toEqual({ name: "Purple", overprint: false });
    expect(colors[1]!.spot).toBeUndefined();
    expect(colors[2]!.opacity).toBe(0.5);
    expect(colors[3]!.spot).toEqual({ name: "Purple", overprint: true });
  });

  it("läser symboler med nummer och hoppar över okända typer", () => {
    const map = read();
    expect(map.symbols.get("0")).toMatchObject({ kind: "LINE", code: { text: "101", main: 101, sub: 0 } });
    expect(map.symbols.get("1")).toMatchObject({ kind: "POINT", code: { text: "105.100", main: 105, sub: 100 } });
    expect(map.symbols.get("0")).toMatchObject({ strokes: [{ color: 1, width: 0.14, cap: "round", join: "round" }] });
    expect(map.symbols.get("1")).toMatchObject({ elements: [{ kind: "dot", color: 1, diameter: 0.5 }] });
    const area = map.symbols.get("2");
    expect(area).toMatchObject({ kind: "AREA", fill: 2 });
    if (area?.kind === "AREA") {
      expect(area.hatches).toHaveLength(1);
      expect(area.hatches[0]!.angle).toBeCloseTo(90, 3);
      expect(area.hatches[0]!.spacing).toBeCloseTo(1.5, 9);
    }
    expect(map.symbols.get("3")).toMatchObject({ kind: "TEXT", size: 4, bold: true, fontFamily: "Arial", color: 1 });
    expect(map.symbols.get("4")).toMatchObject({ kind: "COMBINED", parts: ["4.0", "0"] });
    expect(map.symbols.get("4.0")).toMatchObject({ kind: "AREA", fill: 2 });
    expect(map.symbols.has("5")).toBe(false);
    expect(map.warnings.find(w => w.code === "UNKNOWN_SYMBOL_TYPE")?.count).toBe(1);
  });

  it("vänder y och läser bézierkurvor", () => {
    const line = read().objects[0]!;
    expect(line).toEqual({
      kind: "line", symbol: "0",
      path: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 1, y1: 0, x2: 2, y2: 1, x: 2, y: 2 }, { type: "L", x: 3, y: 2 }]
    });
  });

  it("läser punkter med vinkel i grader och texter med entiteter", () => {
    const [, point, , text] = read().objects;
    expect(point).toMatchObject({ kind: "point", symbol: "1", at: { x: 5, y: 6 } });
    expect(point!.kind === "point" && point!.angle).toBeCloseTo(90, 4);
    expect(text).toEqual({ kind: "text", symbol: "3", at: { x: 0.1, y: 0.2 }, angle: 0, text: "Djurgårds&brunn" });
  });

  it("delar ytor i ytterkant och hål, och kombinerade symboler med yta ger ytor", () => {
    const objects = read().objects;
    const area = objects[2]!;
    expect(area.kind).toBe("area");
    if (area.kind !== "area") return;
    expect(area.rings).toHaveLength(2);
    expect(area.rings[0]).toEqual([
      { type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }, { type: "L", x: 0, y: 10 }
    ]);
    expect(area.rings[1]![0]).toEqual({ type: "M", x: 2, y: 2 });
    expect(area.angle).toBeCloseTo(0.5 * 180 / Math.PI, 4);
    expect(objects[4]).toMatchObject({ kind: "area", symbol: "4" });
  });

  it("räknar objekt utan symbol, okända objekttyper och okända symboler", () => {
    const map = read();
    expect(map.objects).toHaveLength(5);
    const count = (code: string) => map.warnings.find(w => w.code === code)?.count;
    expect(count("OBJECT_WITHOUT_SYMBOL")).toBe(1);
    expect(count("UNKNOWN_OBJECT_TYPE")).toBe(1);
    expect(count("UNKNOWN_SYMBOL")).toBe(1);
    for (const warning of map.warnings) expect(warning.text).toMatch(/^\d/);
  });

  it("läser georeferensen med kartans referenspunkt", () => {
    const map = read();
    expect(map.scale).toBe(10000);
    expect(map.georeference).toEqual({
      scale: 10000,
      crs: { kind: "EPSG", code: 3011 },
      refPoint: { easting: 150000, northing: 6580000 },
      mapRefPoint: { x: 1, y: 2 },
      grivationDegrees: 2.5,
      combinedScaleFactor: 0.9999
    });
  });

  it("ger bounds ur objekten", () => {
    expect(read().bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it("ger okänt koordinatsystem och varning för projektioner som inte stöds", () => {
    const map = read(OMAP.replace("<parameter>3011</parameter>", "<parameter>32633</parameter>").replace("epsg:3011", "epsg:32633"));
    expect(map.georeference?.crs.kind).toBe("UNKNOWN");
    expect(map.warnings.some(w => w.code === "CRS_UNKNOWN")).toBe(true);
  });

  it("klarar en karta utan georeferens och utan objekt", () => {
    const map = read(`<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="7"><colors/><barrier><symbols/><parts><part><objects/></part></parts></barrier></map>`);
    expect(map.objects).toEqual([]);
    expect(map.bounds).toBeNull();
    expect(map.georeference).toBeNull();
    expect(map.scale).toBe(10000);
    expect(map.warnings.some(w => w.code === "SCALE_MISSING")).toBe(true);
  });

  it("kastar TRUNCATED för en avkortad fil och INVALID för trasig XML", () => {
    const cut = OMAP.slice(0, OMAP.indexOf("<object type=\"4\"") + 20);
    expect(() => read(cut)).toThrow(expect.objectContaining({ code: "TRUNCATED" }) as Error);
    const broken = OMAP.replace("<colors count=\"4\">", "<colors count=\"4\"><<");
    expect(() => read(broken)).toThrow(MapFileError);
  });
});

describe("Mapper-läsaren på trasiga filer", () => {
  it("hänger aldrig och kastar bara MapFileError på 200 avkortade eller ändrade filer", () => {
    const random = seededRandom(5959);
    const bytes = encode(OMAP);
    const start = OMAP.indexOf("<map");
    for (let round = 0; round < 200; round++) {
      let candidate: Uint8Array;
      if (round % 2 === 0) {
        candidate = bytes.slice(0, start + 120 + Math.floor(random() * (bytes.length - start - 120)));
      } else {
        candidate = bytes.slice();
        const flips = 1 + Math.floor(random() * 20);
        for (let i = 0; i < flips; i++) {
          const at = start + 120 + Math.floor(random() * (bytes.length - start - 120));
          candidate[at] = "<>/\"=;-0 1&x".charCodeAt(Math.floor(random() * 12));
        }
      }
      const begun = performance.now();
      try {
        readMapFile(candidate);
      } catch (error) {
        expect(error, `runda ${round}`).toBeInstanceOf(MapFileError);
      }
      expect(performance.now() - begun, `runda ${round}`).toBeLessThan(1000);
    }
  });
});

describe("formatigenkänning", () => {
  it("kastar NOT_A_MAP_FILE för annat innehåll oavsett filnamn", () => {
    expect(() => readMapFile(encode("<html></html>"), "karta.omap")).toThrow(expect.objectContaining({ code: "NOT_A_MAP_FILE" }) as Error);
    expect(() => readMapFile(new Uint8Array([0x1f, 0x8b, 8, 0]), "karta.omap")).toThrow(/gzip/);
    expect(() => readMapFile(new Uint8Array(), "tom.ocd")).toThrow(expect.objectContaining({ code: "NOT_A_MAP_FILE" }) as Error);
  });
});
