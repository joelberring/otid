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
/** Trappans band, en egen färg (matchas bara på namnet, aldrig på CMYK som den vanliga bruna 30 %). */
export const STAIR_BROWN: ColorDef = { key: "brown30-stair", name: "Brun 30 % (trappa)", cmyk: [0, 0.168, 0.3, 0.054], distinct: true };
/** Skogsnormens färger med sprintnormens mörkgröna: linjen över brunt, ytan mellan olivgrönt (520) och grönt. */
const COLORS: readonly ColorDef[] = ISOM_COLORS.flatMap((color): ColorDef[] =>
  // Trappans band (ägaren 2026-11-23: «brunt 30 i trappa ska ligga över andra ytor»): en egen brun 30 % direkt under de bruna,
  // blå och svarta linjerna och ovanför alla ytfärger (också belagd yta i brunt 50 %, husens grå och olivgrönt). Mappers ISSprOM
  // 2019-2 ritar bandet i «Lower brown 30%» (under brunt 50 % och husen); där försvinner trappan på en belagd yta i brunt 50 %.
  color.key === "brown" ? [{ key: "darkgreen-line", name: "Mörkgrön (linje)", cmyk: DARK_GREEN }, color, STAIR_BROWN]
    : color.key === "green" ? [{ key: "darkgreen", name: "Mörkgrön", cmyk: DARK_GREEN }, color]
    // Byggnadens grå (svart 50 %, ISSprOM 2019-2 sedan 2022-01-02) under de svarta linjerna, ovanför belagd yta och grönt.
    : color.key === "black65" ? [{ key: "black50", name: "Svart 50 %", cmyk: [0, 0, 0, 0.5] }, color]
    // 214 Kal berghäll är svart 35 % i sprintnormen (O-Map Wiki, ändrat 2024-02-01 från 30 %).
    : color.key === "black20" ? [{ key: "black35", name: "Svart 35 %", cmyk: [0, 0, 0, 0.35] }, color]
    // Järnvägens vita band under de svarta strecken och över allt annat (Mappers «White for railway»).
    : color.key === "black" ? [color, { key: "white-rail", name: "Vit (järnväg)", cmyk: [0, 0, 0, 0] }]
    // Brun 30 % (lätt trafik, trappornas band och 501.3) och vita prickar ovanpå den (Mappers «Lower brown 30%», «White over light brown»).
    : color.key === "brown50" ? [{ key: "white-brown", name: "Vit över ljusbrunt", cmyk: [0, 0, 0, 0] }, color,
      { key: "brown30", name: "Brun 30 %", cmyk: [0, 0.168, 0.3, 0.054] }] : [color]);

const tick = (width: number, length: number) => [stroke("black", width, [0, length / 2], [0, -length / 2])];
/**
 * 532 Trappa (ägaren 2026-11-23: «trapporna har ingen avgränsning på sidorna och har inte färg? kolla norm»). Måtten som i
 * OpenOrienteering Mappers ISSprOM 2019-2 (`symbol sets/src/ISSprOM 2019_4000.xmap`, 532.6–532.9 «Stairway, footprint»; se
 * `symbol-norm.ts` i map-revision): ett band i brunt 30 % lika brett som trappan, svarta kantlinjer 0,1 mm på båda sidor och
 * svarta steg 0,1 mm tvärs linjen var 0,5 mm (0,05 mm från ändarna, minst tre steg). Bredden går inte att ändra per objekt, så
 * trappan finns i fyra bredder (1,6, 2, 3 och 4 m); importen väljer den som ligger närmast trappans bredd (`stairs.ts`).
 * Den smalaste har kantlinjerna utanför bandet, de andra mitt på bandets kant; stegen är 0,5, 0,6, 0,8 och 1,1 mm (som Mapper).
 */
const stairway = (code: string, name: string, metres: number, step: number): SymbolDef => ({ code, name, kind: "line", color: STAIR_BROWN.key, width: metres / 4,
  border: { color: "black", width: 0.1, shift: metres <= 1.6 ? 0.05 : 0 }, mid: { elements: tick(0.1, step), spacing: 0.5, end: 0.05, minimum: 3 } });

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
  stairway("532", "Trappa, 1,6 m", 1.6, 0.5),
  // Måtten nedan ur Mappers ISSprOM 2019-2 (wikin anger dem inte): smal rågång streckad 0,21 mm (4,5 + 0,75), skärmtak grått
  // 20 % med svart kant 0,1 mm.
  { code: "508", name: "Smal rågång", kind: "line", color: "black", width: 0.21, dash: [4.5, 0.75] },
  { code: "522", name: "Skärmtak", kind: "area", fill: "black20", border: { color: "black", width: 0.1 } }
];

/**
 * Sprintnormens egna symboler (ägaren 2026-11-23: «kolla att du har med hela symboluppsättningen från sprintnormen i valen»).
 * Numren och färgerna ur O-Map Wiki (ISSprOM 2019-2, listan och tabellen i `symbol-norm.ts` i map-revision). Måtten som wikin
 * inte anger är jämförda med OpenOrienteering Mappers ISSprOM 2019-2 (ägaren ritar i Mapper; markerade «som Mapper»); där
 * wikin har en senare rättelse än Mappers fil gäller wikin (521 grå 50 %, 501.1 0,18 mm, 214 svart 35 %). Symbolerna som
 * Mappers uppsättning saknar (105.2, 321, 501.2 som kant, 512.3, 533, 541–545) är O-Tids tolkning («tolkning»).
 */
const ADDITIONS: readonly SymbolDef[] = [
  // 105.1 som Mappers 105 «Small earth wall»: brun 0,21 mm med prickar 0,6 mm var 3,75 mm. 105.2 (inte i Mapper) tolkning:
  // samma linje med korta streck åt ena sidan.
  { code: "105.1", name: "Liten jordvall", kind: "line", color: "brown", width: 0.21, mid: { elements: [dot("brown", 0.6)], spacing: 3.75 } },
  { code: "105.2", name: "Stödjande jordvall, synlig från en sida", kind: "line", color: "brown", width: 0.21,
    mid: { elements: [stroke("brown", 0.14, [0, 0], [0, -0.35])], spacing: 0.6 } },
  // 321 Brandpost (skolkartornas tillägg, O-Map Wiki: blå punkt; storleken tolkning).
  { code: "321", name: "Brandpost", kind: "point", elements: [dot("blue", 0.5)] },
  { code: "411.1", name: "Opasserbar vegetation, häck (linje, minsta bredd)", kind: "line", color: "darkgreen-line", width: 0.4, cap: "butt", join: "miter" },
  // Tolkning: kanten mot en lägre nivå streckad.
  { code: "501.2", name: "Kant, belagd yta på lägre nivå", kind: "line", color: "black", width: 0.12, dash: [0.6, 0.25] },
  // Som Mapper: brunt 30 % med vita prickar 0,6 mm i ett rutnät 0,75 mm vridet 45°.
  { code: "501.3", name: "Belagd yta med spridda träd", kind: "area", fill: "brown30", dots: { elements: [dot("white-brown", 0.6)], dx: 0.75, dy: 0.75, angle: 45 } },
  { code: "512.1", name: "Bro eller tunnelmynning", kind: "line", color: "black", width: 0.14, border: { color: "black", width: 0.14 } },
  // Som Mapper: ett vitt band 0,35 mm med svarta streck 1 mm var 2 mm och svarta kantlinjer 0,1 mm mitt på bandets kant.
  { code: "509.1", name: "Järnväg", kind: "line", color: "white-rail", width: 0.35, border: { color: "black", width: 0.1, shift: 0 },
    mid: { elements: [{ kind: "area", color: "black", points: [[-0.5, -0.175], [0.5, -0.175], [0.5, 0.175], [-0.5, 0.175]] }], spacing: 2, end: 0.5 } },
  // Som Mapper: två grå linjer (svart 50 %) 0,1 mm, 0,3 mm isär.
  { code: "509.2", name: "Spårväg", kind: "line", width: 0.3, border: { color: "black50", width: 0.1, shift: 0 } },
  // 512.2 (O-Map Wiki, 2022-01-02): streck 0,25 × 0,2 mm med 0,2 mm mellanrum.
  { code: "512.2", name: "Undergång eller tunnel", kind: "line", color: "black", width: 0.2, dash: [0.25, 0.2] },
  // 512.3 (O-Map Wiki): vit yta.
  { code: "512.3", name: "Löpbar yta på lägre nivå", kind: "area", fill: "white" },
  // Som Mapper: svart 0,21 mm med prickar 0,6 mm var 3,75 mm.
  { code: "513.1", name: "Passerbar mur", kind: "line", color: "black", width: 0.21, mid: { elements: [dot("black", 0.6)], spacing: 3.75 } },
  // Som Mapper: svart 0,21 mm med halvcirklar (radie 0,3 mm) åt höger i linjens riktning var 1,9 mm.
  { code: "513.2", name: "Passerbar stödmur", kind: "line", color: "black", width: 0.21,
    mid: { elements: [{ kind: "area", color: "black", points: [[-0.3, 0], [-0.3, -0.166], [-0.166, -0.3], [0, -0.3], [0.166, -0.3], [0.3, -0.166], [0.3, 0]] }], spacing: 1.9, end: 0.85 } },
  // Som Mapper: pelaren en svart fyrkant, 0,5 mm.
  { code: "522.1", name: "Pelare", kind: "point", elements: [{ kind: "area", color: "black", points: [[-0.25, -0.25], [0.25, -0.25], [0.25, 0.25], [-0.25, 0.25]] }] },
  stairway("532.1", "Trappa, 2 m", 2, 0.6),
  stairway("532.2", "Trappa, 3 m", 3, 0.8),
  stairway("532.3", "Trappa, 4 m", 4, 1.1),
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
