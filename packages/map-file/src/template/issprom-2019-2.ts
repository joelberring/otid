import { ISOM_COLORS, ISOM_SYMBOLS } from "./isom-2017-2";
import { dot, stroke, type ColorDef, type SymbolDef, type SymbolSetDef } from "./symbol-def";

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
    // Byggnadens grå (svart 50 %, ISSprOM 2019-2 sedan 2022-01-02) under de svarta linjerna, ovanför belagd yta och grönt.
    : color.key === "black65" ? [{ key: "black50", name: "Svart 50 %", cmyk: [0, 0, 0, 0.5] }, color]
    // 214 Kal berghäll är svart 35 % i sprintnormen (O-Map Wiki, ändrat 2024-02-01 från 30 %).
    : color.key === "black20" ? [{ key: "black35", name: "Svart 35 %", cmyk: [0, 0, 0, 0.35] }, color] : [color]);

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
  { code: "515", name: "Oöverstiglig mur", kind: "line", color: "black", width: 0.6 },
  { code: "518", name: "Oöverstigligt staket", kind: "line", color: "black", width: 0.6 },
  { code: "529", name: "Speciellt oöverstigligt linjeföremål", kind: "line", color: "black", width: 0.6 },
  // ISSprOM 2019-2: byggnaden är grå (svart 50 %, O-Map Wiki: ändrat 2022-01-02 från 60 %) med svart kantlinje (bredden anges
  // inte i wikin; 0,14 mm som skogsnormens tunna linjer). Normtabellen: `symbol-norm.ts` i map-revision.
  { code: "521", name: "Byggnad", kind: "area", fill: "black50", border: { color: "black", width: 0.14 } },
  { code: "214", name: "Kal berghäll", kind: "area", fill: "black35" },
  // 501.1 Kant, belagd yta: 0,18 mm (O-Map Wiki, ändrat 2023-02-01 från 0,12 mm).
  { code: "501.1", name: "Kant, hårdgjord yta", kind: "line", color: "black", width: 0.18 },
  stairway("532", "Trappa, 1,6 m", 1.6)
];

/**
 * Sprintnormens egna symboler (ägaren 2026-11-23: «kolla att du har med hela symboluppsättningen från sprintnormen i valen»).
 * Numren och färgerna ur O-Map Wiki (ISSprOM 2019-2, listan och tabellen i `symbol-norm.ts` i map-revision). Wikin anger sällan
 * mått: de som saknas där (markerade «tolkning») är O-Tids tolkning av normens bilder och ska kontrolleras före skarpt tryck.
 */
const ADDITIONS: readonly SymbolDef[] = [
  // Tolkning: 105.1 brun linje 0,25 mm; 105.2 samma med korta streck åt ena sidan.
  { code: "105.1", name: "Liten jordvall", kind: "line", color: "brown", width: 0.25 },
  { code: "105.2", name: "Stödjande jordvall, synlig från en sida", kind: "line", color: "brown", width: 0.25,
    mid: { elements: [stroke("brown", 0.14, [0, 0], [0, -0.35])], spacing: 0.6 } },
  // 321 Brandpost (skolkartornas tillägg, O-Map Wiki: blå punkt; storleken tolkning).
  { code: "321", name: "Brandpost", kind: "point", elements: [dot("blue", 0.5)] },
  { code: "411.1", name: "Opasserbar vegetation, häck (linje, minsta bredd)", kind: "line", color: "darkgreen-line", width: 0.4, cap: "butt", join: "miter" },
  // Tolkning: kanten mot en lägre nivå streckad.
  { code: "501.2", name: "Kant, belagd yta på lägre nivå", kind: "line", color: "black", width: 0.12, dash: [0.6, 0.25] },
  // Tolkning: belagd yta (brun 50 %) med gröna prickar för träden.
  { code: "501.3", name: "Belagd yta med spridda träd", kind: "area", fill: "brown50", dots: { elements: [dot("green", 0.6)], dx: 1.5, dy: 1.5, staggered: true } },
  { code: "512.1", name: "Bro eller tunnelmynning", kind: "line", color: "black", width: 0.14, border: { color: "black", width: 0.14 } },
  { code: "509.1", name: "Järnväg", kind: "line", color: "black", width: 0.4, mid: { elements: [stroke("black", 0.14, [0, 0.4], [0, -0.4])], spacing: 3.0 } },
  // Tolkning: spårväg som en tunnare svart linje.
  { code: "509.2", name: "Spårväg", kind: "line", color: "black", width: 0.25 },
  // 512.2 (O-Map Wiki, 2022-01-02): streck 0,25 × 0,2 mm med 0,2 mm mellanrum.
  { code: "512.2", name: "Undergång eller tunnel", kind: "line", color: "black", width: 0.2, dash: [0.25, 0.2] },
  // 512.3 (O-Map Wiki): vit yta.
  { code: "512.3", name: "Löpbar yta på lägre nivå", kind: "area", fill: "white" },
  { code: "513.1", name: "Passerbar mur", kind: "line", color: "black", width: 0.25 },
  // Tolkning: muren med korta streck åt den lägre sidan.
  { code: "513.2", name: "Passerbar stödmur", kind: "line", color: "black", width: 0.25,
    mid: { elements: [stroke("black", 0.14, [0, 0], [0, -0.3])], spacing: 0.6 } },
  // Tolkning: pelaren som en svart fyrkant, 0,4 mm.
  { code: "522.1", name: "Pelare", kind: "point", elements: [{ kind: "area", color: "black", points: [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]] }] },
  stairway("532.1", "Trappa, 2,8 m", 2.8),
  // 533 (O-Map Wiki, ISSprOM 2019-2 rev. 6, 2024): svart yta; mönstret tolkning (glest svart raster).
  { code: "533", name: "Område med hinder", kind: "area", hatches: [{ color: "black", width: 0.1, spacing: 0.5, angle: 45 }] },
  // 541–545 skolkartornas tillägg (O-Map Wiki: svarta; måtten tolkning utom bordets minsta bredd 1,5 mm).
  { code: "541", name: "Lekredskap", kind: "line", color: "black", width: 0.25 },
  { code: "542", name: "Bord", kind: "point", elements: [stroke("black", 0.15, [-0.75, -0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, 0.75], [-0.75, -0.75])] },
  { code: "543", name: "Bänk", kind: "point", rotatable: true, elements: [stroke("black", 0.3, [-0.6, 0], [0.6, 0])] },
  { code: "544", name: "Stolpe, liten mast", kind: "point", elements: [dot("black", 0.4)] },
  { code: "545", name: "Lyktstolpe", kind: "point", elements: [dot("black", 0.4), { kind: "ring", color: "black", diameter: 0.9, width: 0.1 }] }
];

/** Skogssymboler som inte finns i sprintnormen (411 finns, men som mörkgrön yta: se ovan). */
const NOT_IN_SPRINT = new Set(["202.1", "509", "512", "513", "601.1"]);

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
