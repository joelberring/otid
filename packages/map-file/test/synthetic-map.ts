/**
 * ADR-0218: en syntetisk stor skogskarta (OCAD 2018) för prestandatester och mätningar. Påhittad terräng, ingen riktig
 * klubbkarta: höjdkurvor med kurvor, vegetationsytor med hål och raster, stenar och gropar som punkter, stigar med streck,
 * staket med upprepade tecken, kraftledningar med stolpar i hörnen och ortnamn. Deterministisk (fröet ger samma fil).
 */
import { buildOcd, concat, element, ocdCoord, seededRandom, symbolBody, type OcdCoord, type OcdObjectSpec } from "./ocd-builder";

const COLORS = [
  "Svart\tn1\tc0\tm0\ty0\tk100",
  "Brun\tn2\tc0\tm56\ty100\tk18",
  "Blå\tn3\tc100\tm0\ty0\tk0",
  "Grön 100%\tn4\tc76\tm0\ty91\tk0",
  "Grön 60%\tn5\tc46\tm0\ty55\tk0",
  "Grön 30%\tn6\tc23\tm0\ty27\tk0",
  "Gul 100%\tn7\tc0\tm27\ty79\tk0",
  "Gul 50%\tn8\tc0\tm14\ty40\tk0",
  "Vit\tn9\tc0\tm0\ty0\tk0"
].map(value => ({ type: 9, value }));

const GEOREF = { type: 1039, value: "\tm10000.000000\tg50.0000\tr1\tx150000\ty6580000\ta0.00000000\td0.00\te3006\ti13002" };

/** Linjesymbolens kropp: färg, bredd, stil och valfria streck. */
const lineSymbol = (number: number, color: number, width: number, dash?: { main: number; gap: number }) => ({
  number, type: 2, body: symbolBody(80, { 796: color, 798: width, 800: 0, ...(dash ? { 806: dash.main, 810: dash.gap } : {}) })
});
/** Ytsymbolens kropp: fyllning och valfritt raster. */
const areaSymbol = (number: number, fill: number, hatch?: { color: number; width: number; distance: number; angle: number }) => ({
  number, type: 3,
  body: symbolBody(40, { 800: fill, ...(hatch ? { 802: 1, 804: hatch.color, 806: hatch.width, 808: hatch.distance, 810: hatch.angle } : {}) },
    view => view.setUint8(814 - 796, 1))
});
const pointSymbol = (number: number, parts: Uint8Array[]) => {
  const elements = concat(...parts);
  return { number, type: 1, body: concat(symbolBody(4, { 796: elements.length / 8 }), elements) };
};

/** Linje med punktsymboler (stolpar i hörnen eller upprepade tecken), samma layout som `line-symbols.test.ts`. */
function decoratedLine(number: number, color: number, width: number, flags: number, fields: Readonly<Record<number, number>>, primary?: Uint8Array,
  corner?: Uint8Array) {
  const sizes = { 860: (primary?.length ?? 0) / 8, 864: (corner?.length ?? 0) / 8 };
  const head = symbolBody(872 - 796, { 796: color, 798: width, ...fields, ...sizes }, view => view.setUint8(870 - 796, flags));
  return { number, type: 2, body: concat(head, ...[primary, corner].filter((part): part is Uint8Array => !!part)) };
}

const SYMBOLS = [
  lineSymbol(101000, 2, 14),
  lineSymbol(102000, 2, 25),
  lineSymbol(103000, 2, 10, { main: 250, gap: 25 }),
  lineSymbol(505000, 1, 35, { main: 200, gap: 50 }),
  lineSymbol(306000, 3, 18),
  decoratedLine(516000, 1, 14, 0, { 806: 300, 808: 150, 818: 1 }, element(1, 1, 14, 0, [ocdCoord(0, 0), ocdCoord(0, -40)])),
  decoratedLine(510000, 1, 14, 4, {}, undefined, element(1, 1, 14, 0, [ocdCoord(0, -40), ocdCoord(0, 40)])),
  areaSymbol(401000, 7),
  areaSymbol(403000, 8),
  areaSymbol(406000, 6),
  areaSymbol(408000, 5),
  areaSymbol(410000, 4),
  areaSymbol(308000, 9, { color: 3, width: 10, distance: 50, angle: 0 }),
  areaSymbol(301000, 3),
  pointSymbol(206000, [element(4, 1, 0, 40, [ocdCoord(0, 0)])]),
  pointSymbol(204000, [element(3, 1, 14, 75, [ocdCoord(0, 0)])]),
  pointSymbol(112000, [element(4, 2, 0, 55, [ocdCoord(0, 0)])]),
  pointSymbol(115000, [element(1, 2, 14, 0, [ocdCoord(-40, 25), ocdCoord(0, -30), ocdCoord(40, 25)])]),
  {
    number: 902000, type: 4,
    body: symbolBody(60, { 828: 1, 830: 80, 832: 400 }, view => { view.setUint8(0, 5); "Arial".split("").forEach((c, i) => view.setUint8(1 + i, c.charCodeAt(0))); })
  }
];

export interface SyntheticMapOptions {
  /** Ungefärligt antal objekt (förval 50 000). */
  readonly objects?: number;
  /** Kartans bredd och höjd i mm (förval 400 × 300, 4 × 3 km i 1:10 000). */
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly seed?: number;
}

/** Den syntetiska kartan som OCAD-bytes och antalet objekt i filen. */
export function syntheticForestMap(options: SyntheticMapOptions = {}): { bytes: Uint8Array; objects: number } {
  const total = options.objects ?? 50_000;
  const width = (options.widthMm ?? 400) * 100, height = (options.heightMm ?? 300) * 100;
  const random = seededRandom(options.seed ?? 20261107);
  const rx = () => Math.round((random() - 0.5) * width), ry = () => Math.round((random() - 0.5) * height);
  const objects: OcdObjectSpec[] = [];

  /** En slingrande linje från (x, y) med `count` punkter; var tredje sträcka är en kurva. */
  const wander = (count: number, step: number, x0 = rx(), y0 = ry()): OcdCoord[] => {
    const coords: OcdCoord[] = [];
    let x = x0, y = y0, heading = random() * Math.PI * 2;
    for (let k = 0; k < count; k += 1) {
      heading += (random() - 0.5) * 0.6;
      x += Math.cos(heading) * step; y += Math.sin(heading) * step;
      if (k % 3 === 1 && k + 2 < count) {
        coords.push(ocdCoord(x, y, 1));
        x += Math.cos(heading) * step; y += Math.sin(heading) * step;
        coords.push(ocdCoord(x, y, 2));
        k += 1;
      } else coords.push(ocdCoord(x, y));
    }
    return coords;
  };
  /** En oregelbunden ring runt (cx, cy) med radie r (0,01 mm). */
  const blob = (cx: number, cy: number, r: number, count: number, flags = 0): OcdCoord[] =>
    Array.from({ length: count }, (_, k) => {
      const angle = (k / count) * Math.PI * 2, reach = r * (0.7 + 0.6 * random());
      return ocdCoord(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach, 0, k === 0 ? flags : 0);
    });

  const share = (part: number) => Math.max(1, Math.round(total * part));
  for (let k = 0; k < share(0.06); k += 1) {
    objects.push({ symbol: k % 5 === 0 ? 102000 : 101000, type: 2, coords: wander(60 + Math.floor(random() * 120), 150) });
  }
  for (let k = 0; k < share(0.02); k += 1) objects.push({ symbol: 103000, type: 2, coords: wander(20 + Math.floor(random() * 30), 120) });
  for (let k = 0; k < share(0.03); k += 1) objects.push({ symbol: k % 3 === 0 ? 306000 : 505000, type: 2, coords: wander(30 + Math.floor(random() * 60), 300) });
  for (let k = 0; k < share(0.004); k += 1) objects.push({ symbol: 516000, type: 2, coords: wander(20, 400) });
  for (let k = 0; k < share(0.0006); k += 1) objects.push({ symbol: 510000, type: 2, coords: Array.from({ length: 12 }, (_, i) => ocdCoord(-width / 2 + i * width / 11, ry())) });
  const areas = [401000, 403000, 406000, 406000, 408000, 410000, 308000, 301000];
  for (let k = 0; k < share(0.16); k += 1) {
    const cx = rx(), cy = ry(), r = 300 + random() * 2500;
    const outer = blob(cx, cy, r, 16 + Math.floor(random() * 30));
    // Var femte yta har ett hål.
    const hole = k % 5 === 0 ? blob(cx, cy, r * 0.3, 8, 2) : [];
    objects.push({ symbol: areas[k % areas.length]!, type: 3, coords: [...outer, ...hole] });
  }
  const points = [206000, 206000, 204000, 112000, 115000];
  while (objects.length < total - share(0.004)) {
    objects.push({ symbol: points[objects.length % points.length]!, type: 1, angle: Math.round(random() * 3600), coords: [ocdCoord(rx(), ry())] });
  }
  for (let k = 0; objects.length < total; k += 1) objects.push({ symbol: 902000, type: 4, coords: [ocdCoord(rx(), ry())], text: `Namn ${k}` });
  return { bytes: buildOcd({ strings: [...COLORS, GEOREF], symbols: SYMBOLS, objects }), objects: objects.length };
}
