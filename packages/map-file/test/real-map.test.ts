/**
 * Kontroll mot ägarens riktiga kartfiler (Djurgården 2025, OCAD 2018.8 och samma karta i Mapper v9, plus Purple Pens
 * banfil för Natt-KM 2026). Filerna är klubbens och committas inte; testet körs bara när OTID_REAL_MAP_DIR pekar på
 * mappen. Med OTID_SBN_DIR (mappen med Högdalen 2026, OCAD 2018) provas kraftledningarna och färgerna där.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapPointToWgs84, readMapFile, type LineSymbol, type MapGeoreference, type MapSymbol, type ParsedMap } from "../src";

const directory = process.env.OTID_REAL_MAP_DIR;
const sbnDirectory = process.env.OTID_SBN_DIR;

function find(suffix: string, folder = directory): string {
  const name = readdirSync(folder!).find(file => file.normalize("NFC").toLowerCase().endsWith(suffix));
  if (!name) throw new Error(`Hittar ingen fil som slutar på ${suffix} i ${folder}`);
  return join(folder!, name);
}

function lineByCode(map: ParsedMap, code: string): LineSymbol {
  const symbol = [...map.symbols.values()].find((item: MapSymbol) => item.code.text === code && item.kind === "LINE");
  if (!symbol) throw new Error(`Ingen linjesymbol ${code}`);
  return symbol as LineSymbol;
}

const rgb255 = (map: ParsedMap, name: string) => {
  const color = map.colors.find(item => item.name === name);
  return color ? [color.rgb.r, color.rgb.g, color.rgb.b].map(value => Math.round(value * 255)) : undefined;
};

function timedRead(path: string): { map: ParsedMap; ms: number } {
  const bytes = new Uint8Array(readFileSync(path));
  const start = performance.now();
  const map = readMapFile(bytes, path);
  return { map, ms: performance.now() - start };
}

function countByCode(map: ParsedMap): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of map.objects) {
    const code = map.symbols.get(object.symbol)?.code.text ?? "?";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

interface Control { readonly id: string; readonly lat: number; readonly lng: number; readonly x: number; readonly y: number }

function readControls(path: string): Control[] {
  const xml = readFileSync(path, "utf8");
  const controls: Control[] = [];
  for (const match of xml.matchAll(/<Control\b[^>]*>([\s\S]*?)<\/Control>/g)) {
    const body = match[1]!;
    const id = /<Id>([^<]*)<\/Id>/.exec(body)?.[1];
    const position = /<Position lng="([^"]+)" lat="([^"]+)"/.exec(body);
    const mapPosition = /<MapPosition x="([^"]+)" y="([^"]+)"/.exec(body);
    if (id && position && mapPosition) {
      controls.push({ id, lng: Number(position[1]), lat: Number(position[2]), x: Number(mapPosition[1]), y: Number(mapPosition[2]) });
    }
  }
  return controls;
}

function maxDeviationMetres(georef: MapGeoreference, controls: readonly Control[]): number {
  let worst = 0;
  for (const control of controls) {
    const wgs = mapPointToWgs84(georef, { x: control.x, y: control.y });
    const dNorth = (wgs.latitude - control.lat) * 111_320;
    const dEast = (wgs.longitude - control.lng) * 111_320 * Math.cos(control.lat * Math.PI / 180);
    worst = Math.max(worst, Math.hypot(dNorth, dEast));
  }
  return worst;
}

describe.skipIf(!directory)("riktiga kartfiler (OTID_REAL_MAP_DIR)", () => {
  const ocd = directory ? timedRead(find(".ocd")) : null;
  const omap = directory ? timedRead(find(".omap")) : null;
  const controls = directory ? readControls(find(".xml")) : [];

  it("läser båda filerna på under 2 s", () => {
    console.info(`OCD ${ocd!.ms.toFixed(0)} ms, Mapper ${omap!.ms.toFixed(0)} ms`);
    expect(ocd!.ms).toBeLessThan(2000);
    expect(omap!.ms).toBeLessThan(2000);
  });

  it("har lika många objekt per symbol i OCAD och Mapper", () => {
    expect(ocd!.map.format).toBe("OCD");
    expect(ocd!.map.version).toBe("OCAD 2018.8");
    expect(omap!.map.version).toBe("Mapper v9");
    const fromOcd = countByCode(ocd!.map);
    const fromOmap = countByCode(omap!.map);
    const expected = { "101.0": 224, "102.0": 19, "103.0": 391, "406.0": 320, "408.0": 383, "410.0": 192, "521.0": 748 };
    for (const [code, count] of Object.entries(expected)) {
      expect(fromOcd.get(code), `OCD ${code}`).toBe(count);
      expect(fromOmap.get(code), `Mapper ${code}`).toBe(count);
    }
    for (const [code, count] of fromOcd) expect(fromOmap.get(code), `symbol ${code}`).toBe(count);
    console.info(`OCD ${ocd!.map.objects.length} objekt, Mapper ${omap!.map.objects.length} objekt`, ocd!.map.warnings, omap!.map.warnings);
  });

  it("räknar synliga objekt som filerna själva", () => {
    const withoutSymbol = (map: ParsedMap) => map.warnings.find(w => w.code === "OBJECT_WITHOUT_SYMBOL")?.count ?? 0;
    // OCAD: 10 975 synliga objekt, varav 98 utan symbol (96 grafikobjekt och 2 bilder).
    expect(ocd!.map.objects.length).toBe(10877);
    expect(withoutSymbol(ocd!.map)).toBe(98);
    // Mapper: 11 126 <object> i filen = 151 i symbolernas ritdata + 10 975 i kartdelen, varav 98 utan symbol.
    expect(omap!.map.objects.length).toBe(10877);
    expect(withoutSymbol(omap!.map)).toBe(98);
  });

  it("har samma georeferens i båda formaten", () => {
    for (const map of [ocd!.map, omap!.map]) {
      expect(map.scale).toBe(15000);
      const georef = map.georeference!;
      expect(georef.crs).toEqual({ kind: "EPSG", code: 3006 });
      expect(georef.refPoint).toEqual({ easting: 675000, northing: 6570000 });
      expect(georef.grivationDegrees).toBeCloseTo(4.9, 9);
    }
  });

  it("lägger banfilens kartlägen på Position via kartfilens georeferens", () => {
    expect(controls).toHaveLength(25);
    const fromOcd = maxDeviationMetres(ocd!.map.georeference!, controls);
    const fromOmap = maxDeviationMetres(omap!.map.georeference!, controls);
    console.info(`största avvikelse: OCD ${fromOcd.toFixed(3)} m, Mapper ${fromOmap.toFixed(3)} m`);
    expect(fromOcd).toBeLessThan(0.1);
    expect(fromOmap).toBeLessThan(0.5);
  });

  it("har objektens yta inom kartans ram och färgerna i filens ordning", () => {
    for (const map of [ocd!.map, omap!.map]) {
      expect(map.bounds).not.toBeNull();
      expect(map.colors.map(color => color.rank)).toEqual(map.colors.map((_, index) => index));
    }
    // Mapper har inte OCAD:s registerfärg men lägger dekorfärgerna som egna färger sist; i övrigt samma ordning.
    const spotNames = new Set(["Process Black", "PMS299_Blue", "PMS471_Brown", "PMS361_Green", "PMS136_Yellow", "Purple", "PMS428_Grey"]);
    expect(ocd!.map.colors.map(color => color.name).filter(name => name !== "Alla färgseparationer"))
      .toEqual(omap!.map.colors.map(color => color.name).filter(name => !spotNames.has(name)));
    for (const map of [ocd!.map, omap!.map]) {
      expect(map.colors.find(color => color.name === "Violett för banlayout")?.spot?.name).toBe("Purple");
      expect(map.colors.find(color => color.name === "Vit för banlayout")?.spot?.name).toBe("Purple 0 %");
    }
  });
});

describe.skipIf(!directory)("riktiga kartfiler: linjesymbolernas punktsymboler och skärmfärger (OTID_REAL_MAP_DIR)", () => {
  const ocd = directory ? readMapFile(new Uint8Array(readFileSync(find(".ocd")))) : null;
  const omap = directory ? readMapFile(new Uint8Array(readFileSync(find(".omap")))) : null;

  it("har brons vingar, stängslens streck och murarnas prickar i båda formaten", () => {
    for (const map of [ocd!, omap!]) {
      expect(lineByCode(map, "512.0").start?.elements.length, map.format).toBeGreaterThan(0);
      expect(lineByCode(map, "512.0").end?.elements.length, map.format).toBeGreaterThan(0);
      const fence = lineByCode(map, "516.0").repeated!;
      expect(fence.spacing, map.format).toBeCloseTo(2, 6);
      expect(fence.endLength, map.format).toBeCloseTo(1, 6);
      expect(lineByCode(map, "515.0").repeated, map.format).toMatchObject({ count: 2 });
    }
  });

  it("ger samma skärmfärg ur OCAD och Mapper (Mappers egen RGB är naiv och används inte)", () => {
    let compared = 0;
    for (const color of ocd!.colors) {
      const other = rgb255(omap!, color.name);
      if (!other) continue;
      expect(other, color.name).toEqual(rgb255(ocd!, color.name));
      compared += 1;
    }
    expect(compared).toBeGreaterThan(30);
    expect(rgb255(omap!, "Grön för ytsymboler")).toEqual([32, 180, 87]);
  });
});

describe.skipIf(!sbnDirectory)("Högdalen 2026 (OTID_SBN_DIR)", () => {
  const map = sbnDirectory ? readMapFile(new Uint8Array(readFileSync(find(".ocd", sbnDirectory)))) : null;

  it("har kraftledningarnas stolpar som hörnsymbol och hörnpunkterna i linjerna", () => {
    for (const code of ["510.0", "511.0", "511.1"]) expect(lineByCode(map!, code).corner?.elements.length, code).toBeGreaterThan(0);
    const id = lineByCode(map!, "510.0").id;
    const lines = map!.objects.filter(object => object.symbol === id);
    expect(lines).toHaveLength(8);
    const corners = lines.reduce((sum, object) => sum + (object.kind === "line" ? object.path.filter(command => command.corner).length : 0), 0);
    expect(corners).toBe(27);
    expect(lines.some(object => object.kind === "line" && object.path.some(command => command.gap))).toBe(true);
  });

  it("visar grönt och lila som Purple Pen", () => {
    expect(rgb255(map!, "Grön 100% - Ytobjekt")).toEqual([12, 177, 75]);
    expect(rgb255(map!, "Grön 50% - Ytobjekt")).toEqual([159, 209, 138]);
    expect(rgb255(map!, "Övre violett för banpåtryck")).toEqual([180, 29, 142]);
    expect(rgb255(map!, "Svart 100%")).toEqual([0, 0, 0]);
  });
});

/**
 * ADR-0196: klubbarkivets äldre OCAD-filer (version 8–11). Med OTID_OLD_OCD_DIR läses varje .ocd i mappen; ingen får kasta
 * och var och en ska ha objekt och färger. Filerna är klubbens och committas inte.
 */
const oldDirectory = process.env.OTID_OLD_OCD_DIR;
describe.skipIf(!oldDirectory)("Klubbarkivets OCAD 8–11", () => {
  it("läser alla filer i mappen", () => {
    const files = readdirSync(oldDirectory!).filter(name => name.toLowerCase().endsWith(".ocd"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const { map } = timedRead(join(oldDirectory!, name));
      expect(map.objects.length, name).toBeGreaterThan(0);
      expect(map.colors.length, name).toBeGreaterThan(0);
      expect(map.warnings.filter(warning => warning.code === "BROKEN_SYMBOL" || warning.code === "BROKEN_OBJECT"), name).toEqual([]);
    }
  });
});
