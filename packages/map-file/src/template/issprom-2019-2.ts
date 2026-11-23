import { ISOM_COLORS, ISOM_SYMBOLS } from "./isom-2017-2";
import { stroke, type ColorDef, type SymbolDef, type SymbolSetDef } from "./symbol-def";

/**
 * ADR-0219 (K1): O-Tids symbolset efter ISSprOM 2019-2 (sprintkartor), mått i mm vid 1:4 000; 1:3 000 använder samma mått
 * (normens regel). Bygger på skogsnormens symboler med sprintnormens skillnader: grövre murar och oöverstigliga linjer,
 * byggnad med kantlinje (grå yta och svart kant i samma symbol), trappor och broar. Ska kontrolleras mot normen före skarpt tryck.
 *
 * 411 Opasserbar vegetation (ägaren 2026-11-13, sprintkartans häckar). Källor: ISSprOM 2019-2 i Svenska Orienteringsförbundets
 * översättning (version 5, 2022-10-01: «Opasserbar vegetation är ett område (exempelvis en häck) som inte skall korsas eller
 * passeras», färg mörkgrön, minsta bredd 0,4 mm, minsta yta 0,3 mm² = 5 m²), O-Map Wiki
 * (omapwiki.orienteering.sport/symbols/411-uncrossable-vegetation, samma mått) och IOF:s «Map specifications – printing and
 * colour definitions» (februari 2022: Dark green CMYK 100/0/80/30; mörkgröna ytor ligger under 520 och över grönt 100 %,
 * mörkgröna linjer över brunt). Normen har 411 bara som yta. Linjen 411.1 är O-Tids ritform för en häck: ytan i sin minsta
 * bredd, 0,4 mm (som OCAD:s uppsättningar har «Uncrossable vegetation, hedge»); en bredare häck ritas som yta.
 */
const DARK_GREEN = [1, 0, 0.8, 0.3] as const;
/** Skogsnormens färger med sprintnormens mörkgröna: linjen över brunt, ytan mellan olivgrönt (520) och grönt. */
const COLORS: readonly ColorDef[] = ISOM_COLORS.flatMap((color): ColorDef[] =>
  color.key === "brown" ? [{ key: "darkgreen-line", name: "Mörkgrön (linje)", cmyk: DARK_GREEN }, color]
    : color.key === "green" ? [{ key: "darkgreen", name: "Mörkgrön", cmyk: DARK_GREEN }, color]
    // Byggnadens grå (svart 60 %) under de svarta linjerna, ovanför belagd yta och grönt.
    : color.key === "black65" ? [{ key: "black60", name: "Svart 60 %", cmyk: [0, 0, 0, 0.6] }, color] : [color]);

const tick = (width: number, length: number) => [stroke("black", width, [0, length / 2], [0, -length / 2])];
/**
 * 532 Trappa (ägaren 2026-11-23): stegen generaliserade, tvärs linjen i gångriktningen, utan mittlinje. Normen anger minsta
 * bredd 0,4 mm och minst tre grafiska steg; bredden går inte att ändra per objekt, så trappan finns i två bredder som i
 * OCAD:s uppsättning («Stairway, 1.6 m», «2.8 m»). Importen väljer den som ligger närmast trappans bredd (`stairs.ts`).
 */
const stairway = (code: string, name: string, metres: number): SymbolDef =>
  ({ code, name, kind: "line", mid: { elements: tick(0.1, metres / 4), spacing: 0.4 } });

const OVERRIDES: readonly SymbolDef[] = [
  { code: "103", name: "Hjälpkurva", kind: "line", color: "brown", width: 0.14, dash: [2.5, 0.25] },
  { code: "411", name: "Opasserbar vegetation", kind: "area", fill: "darkgreen" },
  { code: "513", name: "Mur", kind: "line", color: "black", width: 0.25 },
  { code: "515", name: "Oöverstiglig mur", kind: "line", color: "black", width: 0.6 },
  { code: "518", name: "Oöverstigligt staket", kind: "line", color: "black", width: 0.6 },
  { code: "529", name: "Speciellt oöverstigligt linjeföremål", kind: "line", color: "black", width: 0.6 },
  // ISSprOM 2019-2: byggnaden är grå (svart 60 %) med svart kantlinje 0,14 mm.
  { code: "521", name: "Byggnad", kind: "area", fill: "black60", border: { color: "black", width: 0.14 } },
  stairway("532", "Trappa, 1,6 m", 1.6)
];

const ADDITIONS: readonly SymbolDef[] = [
  { code: "411.1", name: "Opasserbar vegetation, häck (linje, minsta bredd)", kind: "line", color: "darkgreen-line", width: 0.4, cap: "butt", join: "miter" },
  { code: "512.1", name: "Bro", kind: "line", color: "black", width: 0.14, border: { color: "black", width: 0.14 } },
  { code: "512.2", name: "Gångbro", kind: "line", color: "black", width: 0.25 },
  stairway("532.1", "Trappa, 2,8 m", 2.8)
];

/** Skogssymboler som inte finns i sprintnormen (411 finns, men som mörkgrön yta: se ovan). */
const NOT_IN_SPRINT = new Set(["202.1", "508", "601.1"]);

export const ISSPROM_2019_2: SymbolSetDef = {
  id: "ISSPROM2019-2",
  name: "ISSprOM 2019-2",
  scales: [{ scale: 4000, factor: 1 }, { scale: 3000, factor: 1 }],
  colors: COLORS,
  symbols: [
    ...ISOM_SYMBOLS.filter(symbol => !NOT_IN_SPRINT.has(symbol.code))
      .map(symbol => OVERRIDES.find(override => override.code === symbol.code) ?? symbol),
    ...ADDITIONS
  ].sort((a, b) => Number(a.code) - Number(b.code))
};
