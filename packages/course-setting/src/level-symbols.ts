/**
 * Nivåstödet (ADR-0212): vad kartans symboler betyder för svårigheten. Två tabeller, båda egna tolkningar av ISOM 2017-2
 * (numren som i `suggest-symbols.ts`, kontrollerade mot omapwiki) och SOFT:s nivåbeskrivningar (2022):
 *
 * - **Ledstänger** per ISOM-huvudnummer. STRONG är det Grön och Vit bygger på ("vägar, stigar, staket, stenmurar,
 *   vattendrag, öppen mark"), WEAK det som Vit och uppåt kan följa ("diken, bäckar, stenmurar och beståndsgränser",
 *   SOFT banläggarträff 2025). Ytor räknas med sin kant (sjöns strand, den öppna markens kant).
 * - **Föremålens storlek** per kolumn D (IOF 2018, Purple Pens id) och per ISOM-nummer där kartan säger mer (204 sten,
 *   205 stor sten, 206 jättesten). BIG = stort och tydligt (byggnad, stor sten, tydlig höjd), MEDIUM = tydligt men inte
 *   stort (sten, brant, sänka), SMALL = liten detalj (liten grop, liten höjd, myrstack, stubbe).
 *
 * Kartor med klubbens egna nummer går via förslagens namnregler (`featureRuleFor`): kolumn D ger då ledstången.
 */

import type { FeatureSize, HandrailKind } from "./level-types";

/** ISOM 2017-2: linjer och ytkanter som är ledstänger. */
export const HANDRAIL_BY_SYMBOL: Readonly<Record<number, HandrailKind>> = {
  301: "STRONG", // Uncrossable body of water (stranden)
  304: "STRONG", // Crossable watercourse
  305: "STRONG", // Small crossable watercourse
  401: "STRONG", // Open land (kanten)
  402: "STRONG", // Open land with scattered trees (kanten)
  502: "STRONG", 503: "STRONG", 504: "STRONG", // Wide road, Road, Vehicle track
  505: "STRONG", 506: "STRONG", // Footpath, Small footpath
  509: "STRONG", // Railway
  510: "STRONG", 511: "STRONG", // Power line, Major power line
  513: "STRONG", 515: "STRONG", // Wall, Impassable wall
  516: "STRONG", 518: "STRONG", // Fence, Impassable fence
  105: "WEAK", 106: "WEAK", // Earth wall, Ruined earth wall
  107: "WEAK", // Erosion gully
  201: "WEAK", // Impassable cliff (höjdkant)
  306: "WEAK", // Minor/seasonal water channel (dike)
  308: "WEAK", // Marsh (kanten)
  309: "WEAK", // Narrow marsh
  403: "WEAK", 404: "WEAK", // Rough open land (kanten)
  415: "WEAK", 416: "WEAK", // Distinct cultivation/vegetation boundary
  501: "WEAK", // Paved area (kanten)
  507: "WEAK", // Less distinct small footpath
  508: "WEAK", // Narrow ride or linear trace
  514: "WEAK", 517: "WEAK", // Ruined wall, Ruined fence
  521: "WEAK" // Building (husväggen)
};

/** Reserv för kartor med egna nummer: kolumn D (Purple Pens id) → ledstång. */
export const HANDRAIL_BY_DESCRIPTION: Readonly<Record<string, HandrailKind>> = {
  "5.1": "STRONG", "5.2": "STRONG", "5.26": "STRONG", "5.5": "STRONG", "5.8": "STRONG", "5.9": "STRONG", "3.4": "STRONG", "3.1": "STRONG",
  "4.1": "STRONG", "3.5": "WEAK", "3.6": "WEAK", "5.3": "WEAK", "4.7": "WEAK", "1.6": "WEAK", "1.7": "WEAK", "3.7": "WEAK", "5.12": "WEAK"
};

/** Öppen mark: en väg genom den räknas som längs en ledstång ("öppen mark" i SOFT:s Grön). */
export const OPEN_LAND_SYMBOLS: readonly number[] = [401, 402, 403, 404];

/** Kolumn D (IOF Control Descriptions 2018, Purple Pens id) → föremålets storlek. */
export const SIZE_BY_DESCRIPTION: Readonly<Record<string, FeatureSize>> = {
  // Landformer: höjd och stenbrott är stora, sänkor, näsor och terrasser medel, små detaljer små.
  "1.1": "MEDIUM", "1.2": "MEDIUM", "1.3": "MEDIUM", "1.4": "LINE", "1.5": "BIG", "1.6": "LINE", "1.7": "LINE", "1.8": "SMALL",
  "1.9": "BIG", "1.10": "SMALL", "1.11": "MEDIUM", "1.12": "MEDIUM", "1.13": "SMALL", "1.14": "SMALL", "1.15": "SMALL", "1.16": "SMALL",
  // Berg och sten: en sten är tydlig (SOFT:s Vit: "till exempel en sten"); stor sten avgörs av kartan eller måttet.
  "2.1": "MEDIUM", "2.2": "BIG", "2.3": "MEDIUM", "2.4": "MEDIUM", "2.5": "MEDIUM", "2.6": "MEDIUM", "2.7": "SMALL", "2.8": "MEDIUM",
  "2.9": "MEDIUM", "2.10": "LINE",
  // Vatten och sankmark.
  "3.1": "BIG", "3.2": "BIG", "3.3": "SMALL", "3.4": "LINE", "3.5": "LINE", "3.6": "LINE", "3.7": "MEDIUM", "3.8": "MEDIUM",
  "3.9": "MEDIUM", "3.10": "SMALL", "3.11": "MEDIUM",
  // Vegetation.
  "4.1": "BIG", "4.2": "MEDIUM", "4.3": "MEDIUM", "4.4": "BIG", "4.5": "MEDIUM", "4.6": "LINE", "4.7": "LINE", "4.8": "MEDIUM",
  "4.9": "MEDIUM", "4.10": "SMALL",
  // Anläggningar.
  "5.1": "LINE", "5.2": "LINE", "5.3": "LINE", "5.4": "BIG", "5.5": "LINE", "5.6": "MEDIUM", "5.7": "BIG", "5.8": "LINE", "5.9": "LINE",
  "5.10": "MEDIUM", "5.11": "BIG", "5.12": "BIG", "5.13": "BIG", "5.14": "LINE", "5.15": "BIG", "5.16": "MEDIUM", "5.17": "MEDIUM",
  "5.18": "MEDIUM", "5.19": "SMALL", "5.20": "MEDIUM", "5.23": "MEDIUM", "5.24": "LINE", "5.25": "BIG", "5.26": "LINE",
  "6.1": "SMALL", "6.2": "SMALL"
};

/** Där kartans nummer säger mer än kolumn D (ISOM 2017-2). */
export const SIZE_BY_SYMBOL: Readonly<Record<number, FeatureSize>> = {
  109: "SMALL", 110: "SMALL", 111: "SMALL", 112: "SMALL", // Small knoll, Small elongated knoll, Small depression, Pit
  204: "MEDIUM", // Boulder
  205: "BIG", 206: "BIG", // Large boulder, Gigantic boulder or rock pillar
  207: "MEDIUM", // Boulder cluster
  418: "SMALL", 419: "SMALL", // Prominent bush or tree, Prominent vegetation feature
  521: "BIG", 523: "BIG", 524: "BIG", // Building, Ruin, High tower
  530: "SMALL", 531: "SMALL"
};

/** En sten med höjd i kolumn F på minst så här mycket (m) är stor ("ett större block"). */
export const BIG_BOULDER_METERS = 1.5;
/** En sluten höjdkurva med minst så här stor utsträckning (m) är en tydlig höjd; mindre är en liten höjd. */
export const DISTINCT_HILL_METERS = 30;
