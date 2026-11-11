import { arc, cross, dot, ellipse, fill, ring, stroke, triangle, type ColorDef, type SymbolDef, type SymbolSetDef } from "./symbol-def";

/**
 * ADR-0219 (K1): O-Tids symbolset efter ISOM 2017-2 (skogskartor), mått i mm vid 1:15 000. Vid 1:10 000 förstoras allt
 * 1,5 gånger (normens regel). Förenklingar mot normen: kantlinjer på ytor ritas som egna linjesymboler, några mönster är
 * ungefärliga. Ska kontrolleras mot normen före skarpt tryck.
 */
export const ISOM_COLORS: readonly ColorDef[] = [
  { key: "purple", name: "Violett (bana)", cmyk: [0.35, 0.85, 0, 0] },
  { key: "white-course", name: "Vit för bana", cmyk: [0, 0, 0, 0] },
  { key: "black", name: "Svart", cmyk: [0, 0, 0, 1] },
  { key: "blue", name: "Blå", cmyk: [1, 0, 0, 0] },
  { key: "brown", name: "Brun", cmyk: [0, 0.56, 1, 0.18] },
  { key: "brown50", name: "Brun 50 %", cmyk: [0, 0.28, 0.5, 0.09] },
  { key: "black65", name: "Svart 65 %", cmyk: [0, 0, 0, 0.65] },
  { key: "black20", name: "Svart 20 %", cmyk: [0, 0, 0, 0.2] },
  { key: "blue70", name: "Blå 70 %", cmyk: [0.7, 0, 0, 0] },
  { key: "blue30", name: "Blå 30 %", cmyk: [0.3, 0, 0, 0] },
  { key: "white", name: "Vit", cmyk: [0, 0, 0, 0] },
  // Ägaren 2026-11-11 («tomtmarken ska ta över och ligga ovanför tät skog»): olivgrönt (520) över grönskan.
  { key: "olive", name: "Olivgrön", cmyk: [0.35, 0, 1, 0.5] },
  { key: "green", name: "Grön", cmyk: [0.76, 0, 0.91, 0] },
  { key: "green60", name: "Grön 60 %", cmyk: [0.46, 0, 0.55, 0] },
  { key: "green30", name: "Grön 30 %", cmyk: [0.23, 0, 0.27, 0] },
  { key: "yellow", name: "Gul", cmyk: [0, 0.27, 0.79, 0] },
  { key: "yellow50", name: "Gul 50 %", cmyk: [0, 0.135, 0.395, 0] },
  { key: "white-bg", name: "Vit (skog)", cmyk: [0, 0, 0, 0] }
];

const tag = (color: string, width: number, length: number) => [stroke(color, width, [0, 0], [0, -length])];
const tick = (color: string, width: number, length: number) => [stroke(color, width, [0, length / 2], [0, -length / 2])];

export const ISOM_SYMBOLS: readonly SymbolDef[] = [
  // Landformer (brunt).
  { code: "101", name: "Höjdkurva", kind: "line", color: "brown", width: 0.14, cap: "round", join: "round" },
  { code: "102", name: "Stödkurva (index)", kind: "line", color: "brown", width: 0.25, cap: "round", join: "round" },
  { code: "103", name: "Hjälpkurva", kind: "line", color: "brown", width: 0.14, dash: [2.25, 0.25] },
  // Ägaren 2026-11-11 («många stenar men inga punkthöjder»): landformerna hade ISOM 2000:s nummer (110 kulle, 116 speciell
  // terrängform) medan resten av O-Tid räknar med ISOM 2017-2. Nu som normen: 109 liten kulle, 111 liten grop, 115 speciell.
  { code: "101.1", name: "Lutningsstreck", kind: "point", rotatable: true, elements: tag("brown", 0.14, 0.5) },
  { code: "102.1", name: "Kurvsiffra", kind: "text", color: "brown", size: 1.5 },
  { code: "104", name: "Jordbrant", kind: "line", color: "brown", width: 0.37, mid: { elements: tag("brown", 0.18, 0.6), spacing: 1.5 } },
  { code: "105", name: "Jordvall", kind: "line", color: "brown", width: 0.37, cap: "round" },
  { code: "106", name: "Raserad jordvall", kind: "line", color: "brown", width: 0.25, dash: [1.5, 0.25] },
  { code: "107", name: "Erosionsravin", kind: "line", color: "brown", width: 0.37, cap: "round" },
  { code: "108", name: "Liten erosionsravin", kind: "line", mid: { elements: [dot("brown", 0.37)], spacing: 0.6 } },
  { code: "109", name: "Liten kulle", kind: "point", elements: [dot("brown", 0.75)] },
  { code: "110", name: "Liten avlång kulle", kind: "point", rotatable: true, elements: [ellipse("brown", 1.2, 0.75)] },
  { code: "111", name: "Liten grop", kind: "point", rotatable: true, elements: [arc("brown", 0.9, 0.18, "up")] },
  { code: "112", name: "Grop", kind: "point", rotatable: true, elements: [stroke("brown", 0.18, [-0.4, 0.4], [0, -0.3], [0.4, 0.4])] },
  { code: "113", name: "Gropig mark", kind: "area", dots: { elements: [dot("brown", 0.25)], dx: 1.2, dy: 1.2, staggered: true } },
  { code: "114", name: "Mycket gropig mark", kind: "area", dots: { elements: [dot("brown", 0.25)], dx: 0.7, dy: 0.7, staggered: true } },
  { code: "115", name: "Speciell terrängform", kind: "point", elements: cross("brown", 0.8, 0.18) },

  // Berg och sten (svart).
  { code: "201", name: "Oöverstiglig brant", kind: "line", color: "black", width: 0.35, mid: { elements: tag("black", 0.35, 0.6), spacing: 1.0 } },
  { code: "202", name: "Brant", kind: "line", color: "black", width: 0.25 },
  { code: "202.1", name: "Brant med streck", kind: "line", color: "black", width: 0.25, mid: { elements: tag("black", 0.18, 0.4), spacing: 1.0 } },
  { code: "203", name: "Bergsgrop eller grotta", kind: "point", rotatable: true, elements: [stroke("black", 0.18, [-0.4, 0.4], [0, -0.3], [0.4, 0.4])] },
  { code: "204", name: "Sten", kind: "point", elements: [dot("black", 0.4)] },
  { code: "205", name: "Stor sten", kind: "point", elements: [dot("black", 0.6)] },
  { code: "206", name: "Jättesten", kind: "area", fill: "black" },
  { code: "207", name: "Stengrupp", kind: "point", rotatable: true, elements: [triangle("black", 0.8)] },
  { code: "208", name: "Blockterräng", kind: "area", dots: { elements: [triangle("black", 0.6)], dx: 2.0, dy: 2.0, staggered: true } },
  { code: "209", name: "Tät blockterräng", kind: "area", dots: { elements: [triangle("black", 0.6)], dx: 1.2, dy: 1.2, staggered: true } },
  { code: "210", name: "Stenig mark, löpbar", kind: "area", dots: { elements: [dot("black", 0.18)], dx: 1.5, dy: 1.5, staggered: true } },
  { code: "211", name: "Stenig mark, gångbar", kind: "area", dots: { elements: [dot("black", 0.18)], dx: 1.0, dy: 1.0, staggered: true } },
  { code: "212", name: "Stenig mark, svårframkomlig", kind: "area", dots: { elements: [dot("black", 0.18)], dx: 0.6, dy: 0.6, staggered: true } },
  { code: "213", name: "Sandmark", kind: "area", fill: "yellow50", dots: { elements: [dot("black", 0.18)], dx: 1.0, dy: 1.0, staggered: true } },
  { code: "214", name: "Kal berghäll", kind: "area", fill: "black20" },
  { code: "215", name: "Skyttegrav", kind: "line", color: "black", width: 0.25, mid: { elements: tick("black", 0.14, 0.5), spacing: 1.0 } },

  // Vatten och sankmark (blått).
  { code: "301", name: "Sjö, oöverkomlig", kind: "area", fill: "blue70" },
  { code: "301.1", name: "Strandlinje", kind: "line", color: "black", width: 0.18, join: "round" },
  { code: "302", name: "Grunt vatten", kind: "area", fill: "blue30" },
  { code: "302.1", name: "Strandlinje, grunt vatten", kind: "line", color: "blue", width: 0.1 },
  { code: "303", name: "Vattenhål", kind: "point", elements: [triangle("blue", 0.8)] },
  { code: "304", name: "Bäck, överkomlig", kind: "line", color: "blue", width: 0.3, cap: "round", join: "round" },
  { code: "305", name: "Liten bäck", kind: "line", color: "blue", width: 0.18, cap: "round", join: "round" },
  { code: "306", name: "Dike eller torr bäckfåra", kind: "line", color: "blue", width: 0.18, dash: [1.0, 0.25] },
  { code: "307", name: "Sankmark, oöverkomlig", kind: "area", hatches: [{ color: "blue", width: 0.15, spacing: 0.3 }] },
  { code: "308", name: "Sankmark", kind: "area", hatches: [{ color: "blue", width: 0.12, spacing: 0.5 }] },
  { code: "309", name: "Smal sankmark", kind: "line", color: "blue", width: 0.25, dash: [0.6, 0.25] },
  { code: "310", name: "Otydlig sankmark", kind: "area", hatches: [{ color: "blue", width: 0.12, spacing: 0.9 }] },
  { code: "311", name: "Brunn eller källa med kant", kind: "point", elements: [ring("blue", 0.9, 0.18)] },
  { code: "312", name: "Källa", kind: "point", rotatable: true, elements: [arc("blue", 0.9, 0.18, "down")] },
  { code: "313", name: "Speciellt vattenföremål", kind: "point", elements: cross("blue", 0.8, 0.18) },

  // Vegetation (gult och grönt).
  { code: "401", name: "Öppen mark", kind: "area", fill: "yellow" },
  { code: "402", name: "Öppen mark med spridda träd", kind: "area", fill: "yellow", dots: { elements: [dot("white", 0.55)], dx: 1.5, dy: 1.5, staggered: true } },
  { code: "403", name: "Ödemark (öppen mark, ej löpvänlig)", kind: "area", fill: "yellow50" },
  { code: "404", name: "Ödemark med spridda träd", kind: "area", fill: "yellow50", dots: { elements: [dot("white", 0.55)], dx: 1.5, dy: 1.5, staggered: true } },
  { code: "405", name: "Skog, lättlöpt", kind: "area", fill: "white-bg" },
  { code: "406", name: "Skog, löphindrande", kind: "area", fill: "green30" },
  { code: "407", name: "Undervegetation, löphindrande", kind: "area", hatches: [{ color: "green", width: 0.25, spacing: 0.75, angle: 90 }] },
  { code: "408", name: "Skog, svårlöpt", kind: "area", fill: "green60" },
  { code: "409", name: "Undervegetation, svårlöpt", kind: "area", hatches: [{ color: "green", width: 0.25, spacing: 0.45, angle: 90 }] },
  { code: "410", name: "Skog, mycket svårlöpt", kind: "area", fill: "green" },
  { code: "411", name: "Vegetation, oframkomlig", kind: "area", fill: "green", hatches: [{ color: "black", width: 0.1, spacing: 0.5, angle: 45 }] },
  { code: "412", name: "Odlad mark", kind: "area", fill: "yellow", dots: { elements: [dot("black", 0.2)], dx: 1.0, dy: 1.0 } },
  { code: "413", name: "Fruktodling", kind: "area", fill: "yellow", dots: { elements: [dot("green", 0.5)], dx: 1.5, dy: 1.5 } },
  { code: "414", name: "Vinodling", kind: "area", fill: "yellow", hatches: [{ color: "green", width: 0.3, spacing: 1.2, angle: 90 }] },
  { code: "415", name: "Tydlig odlingsgräns", kind: "line", color: "black", width: 0.14 },
  { code: "416", name: "Tydlig vegetationsgräns", kind: "line", color: "black", width: 0.14, dash: [0.2, 0.3], cap: "round" },
  { code: "417", name: "Speciellt stort träd", kind: "point", elements: [ring("green", 1.2, 0.3)] },
  { code: "418", name: "Speciell buske eller träd", kind: "point", elements: [dot("green", 0.6)] },
  { code: "419", name: "Speciellt vegetationsföremål", kind: "point", elements: cross("green", 0.8, 0.25) },

  // Anläggningar (svart, brunt, grått).
  { code: "501", name: "Hårdgjord yta", kind: "area", fill: "brown50" },
  { code: "501.1", name: "Kant, hårdgjord yta", kind: "line", color: "black", width: 0.14 },
  { code: "502", name: "Bred väg", kind: "line", color: "brown50", width: 0.4, border: { color: "black", width: 0.14 } },
  { code: "503", name: "Väg", kind: "line", color: "black", width: 0.35 },
  { code: "504", name: "Körväg", kind: "line", color: "black", width: 0.35, dash: [3.0, 0.25] },
  { code: "505", name: "Stig", kind: "line", color: "black", width: 0.25, dash: [2.0, 0.25] },
  { code: "506", name: "Liten stig", kind: "line", color: "black", width: 0.18, dash: [1.0, 0.25] },
  { code: "507", name: "Otydlig liten stig", kind: "line", color: "black", width: 0.18, dash: [1.0, 1.0] },
  { code: "508", name: "Smal rågång", kind: "line", color: "black", width: 0.14, dash: [1.5, 0.5] },
  { code: "509", name: "Järnväg", kind: "line", color: "black", width: 0.4, mid: { elements: tick("black", 0.14, 0.8), spacing: 3.0 } },
  { code: "510", name: "Kraftledning", kind: "line", color: "black", width: 0.14, mid: { elements: tick("black", 0.14, 0.8), spacing: 6.0 } },
  { code: "511", name: "Stor kraftledning", kind: "line", color: "black", width: 0.14, border: { color: "black", width: 0.14 },
    mid: { elements: tick("black", 0.14, 1.2), spacing: 6.0 } },
  { code: "512", name: "Bro eller tunnel", kind: "line", color: "black", width: 0.14, border: { color: "black", width: 0.14 } },
  { code: "513", name: "Stenmur", kind: "line", color: "black", width: 0.14, mid: { elements: [dot("black", 0.45)], spacing: 1.5 } },
  { code: "514", name: "Raserad stenmur", kind: "line", color: "black", width: 0.14, dash: [1.0, 0.5], mid: { elements: [dot("black", 0.45)], spacing: 3.0 } },
  { code: "515", name: "Oöverstiglig mur", kind: "line", color: "black", width: 0.5 },
  { code: "516", name: "Staket", kind: "line", color: "black", width: 0.14, mid: { elements: tag("black", 0.14, 0.4), spacing: 1.5 } },
  { code: "517", name: "Raserat staket", kind: "line", color: "black", width: 0.14, dash: [1.0, 0.5], mid: { elements: tag("black", 0.14, 0.4), spacing: 3.0 } },
  { code: "518", name: "Oöverstigligt staket", kind: "line", color: "black", width: 0.25, mid: { elements: tick("black", 0.14, 0.8), spacing: 1.5 } },
  { code: "519", name: "Passage", kind: "point", rotatable: true, elements: [stroke("black", 0.18, [-0.4, -0.5], [-0.4, 0.5]), stroke("black", 0.18, [0.4, -0.5], [0.4, 0.5])] },
  { code: "520", name: "Område som inte får beträdas", kind: "area", fill: "olive" },
  { code: "521", name: "Byggnad", kind: "area", fill: "black65" },
  { code: "521.1", name: "Kant, byggnad", kind: "line", color: "black", width: 0.14 },
  { code: "522", name: "Skärmtak", kind: "area", fill: "black20" },
  { code: "523", name: "Ruin", kind: "line", color: "black", width: 0.14, dash: [0.8, 0.3] },
  { code: "524", name: "Högt torn", kind: "point", elements: [ring("black", 1.4, 0.35), dot("black", 0.3)] },
  { code: "525", name: "Litet torn", kind: "point", elements: [fill("black", [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5])] },
  { code: "526", name: "Röse", kind: "point", elements: [ring("black", 0.7, 0.18)] },
  { code: "527", name: "Foderhäck", kind: "point", rotatable: true, elements: [stroke("black", 0.18, [-0.5, -0.3], [0, 0.4], [0.5, -0.3]), stroke("black", 0.18, [0, 0.4], [0, -0.5])] },
  { code: "528", name: "Speciellt linjeföremål", kind: "line", color: "black", width: 0.25 },
  { code: "529", name: "Speciellt oöverstigligt linjeföremål", kind: "line", color: "black", width: 0.5 },
  { code: "530", name: "Speciellt föremål, ring", kind: "point", elements: [ring("black", 0.8, 0.18)] },
  { code: "531", name: "Speciellt föremål, kryss", kind: "point", elements: cross("black", 0.8, 0.18) },

  // Tekniska symboler.
  { code: "601", name: "Nordlinje", kind: "line", color: "black", width: 0.1 },
  { code: "601.1", name: "Nordlinje (blå)", kind: "line", color: "blue", width: 0.18 },
  { code: "602", name: "Passmärke", kind: "point", elements: [ring("black", 1.5, 0.1), ...cross("black", 2.2, 0.1)] },
  { code: "603", name: "Höjdpunkt", kind: "point", elements: [dot("black", 0.3)] },
  { code: "603.1", name: "Höjdsiffra", kind: "text", color: "black", size: 1.5 },
  { code: "999", name: "Namn och text", kind: "text", color: "black", size: 2.0 }
];

export const ISOM_2017_2: SymbolSetDef = {
  id: "ISOM2017-2", name: "ISOM 2017-2", scales: [{ scale: 15000, factor: 1 }, { scale: 10000, factor: 1.5 }], colors: ISOM_COLORS, symbols: ISOM_SYMBOLS
};
