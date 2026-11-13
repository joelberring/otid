/**
 * Kartans norm (ägaren 2026-11-13: «sprintnormen blir en egen variant i kartritningen»). Grundkartans regler lager → symbol
 * är skrivna för skogskartor (ISOM 2017-2); en sprintkarta ritas med andra symboler (belagd yta med kantlinje, passerbart och
 * opasserbart staket, mur, trappa, tomtmark) och i den äldre sprintnormen också med andra nummer. Här avgörs normen ur kartans
 * skala och symboluppsättning. Ren funktion utan I/O.
 *
 * - `ISOM`: skogskarta (ISOM 2017-2, och äldre skogskartor med ISOM 2000-nummer). Reglerna är som förut.
 * - `ISSPROM`: sprintkarta efter ISSprOM 2019-2 (521 byggnad, 501 belagd yta, 520 tomtmark, 515/518 opasserbart).
 * - `ISSOM`: sprintkarta efter den äldre sprintnormen ISSOM 2007, som följer ISOM 2000:s nummer (526.1 byggnad, 529 belagd
 *   yta, 527/528 förbjudet område, 521.1 hög mur, 524 högt staket, 421 opasserbar vegetation).
 */
export type MapNorm = "ISOM" | "ISSPROM" | "ISSOM";

/** En symbol som reglerna ser den: nummer som i filen («521», «521.0», «501.100»), form och gärna namn. */
export interface NormSymbol { readonly code: string; readonly kind: string; readonly name?: string | undefined }

/** Sprintkartans största skalnämnare: 1:5 000 (ISSOM) och större, alltså också 1:4 000 och 1:3 000 (ISSprOM). */
export const SPRINT_MAX_SCALE = 5000;

/** Numret delat i huvud- och undernummer: «501.100» → 501 och 100, «521» och «521.0» → 521 och 0. */
export function codeParts(code: string): { main: number; sub: number } {
  const [main = "", sub = ""] = code.trim().split(".");
  return { main: Number.parseInt(main, 10) || 0, sub: Number.parseInt(sub, 10) || 0 };
}

/**
 * Normen ur skalan och symbolerna.
 *
 * 1. Uppsättningen har de äldre numren (yta 526 byggnad eller yta 529 belagd yta; i ISOM 2017-2 och ISSprOM 2019-2 är de
 *    punkter och linjer). Då är kartan en sprintkarta i den äldre normen om skalan är 1:5 000 eller större, eller om
 *    uppsättningen har sprintnormens egna symboler (421 opasserbar vegetation, 529.1 kant belagd yta som linje); annars en
 *    äldre skogskarta.
 * 2. Annars är kartan en sprintkarta om skalan är 1:5 000 eller större (O-Tids mall ISSPROM2019-2 finns bara i 1:4 000 och
 *    1:3 000 och ger därför alltid sprint), eller om uppsättningen ser ut som ISSprOM 2019-2 fast skalan är okänd eller
 *    förstorad: belagd yta 501, tomtmark 520 och byggnad 521 som ytor och ingen av skogsnormens vägar 502–504 (sprintnormen
 *    ritar vägar som belagda ytor). Numren 501, 515, 518, 520 och 521 räcker inte ensamma: ISOM 2017-2 har dem också.
 */
export function mapNorm(map: { readonly scale?: number | null | undefined; readonly symbols: Iterable<NormSymbol> }): MapNorm {
  const areas = new Set<number>(), lines = new Set<number>(), all = new Set<number>();
  let pavedEdge529 = false;
  for (const symbol of map.symbols) {
    const { main, sub } = codeParts(symbol.code), kind = symbol.kind.toLowerCase();
    all.add(main);
    if (kind === "area") areas.add(main);
    if (kind === "line" || kind === "combined") { lines.add(main); if (main === 529 && sub === 1) pavedEdge529 = true; }
  }
  const scale = map.scale ?? 0, sprintScale = scale > 0 && scale <= SPRINT_MAX_SCALE;
  if (areas.has(526) || areas.has(529)) return sprintScale || all.has(421) || pavedEdge529 ? "ISSOM" : "ISOM";
  if (sprintScale) return "ISSPROM";
  const sprintSet = areas.has(501) && areas.has(520) && areas.has(521) && ![502, 503, 504].some(main => lines.has(main));
  return sprintSet ? "ISSPROM" : "ISOM";
}

/** Är kartan en sprintkarta (någon av sprintnormerna)? */
export const isSprintNorm = (norm: MapNorm): boolean => norm !== "ISOM";
