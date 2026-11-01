/**
 * Ringklipp över viktiga detaljer (ADR-0180 beslut 10): standardtabellen över kartsymboler som en kontrollring ska
 * klippas för, ISOM 2017-2 och ISSprOM 2019-2. Numren är kontrollerade mot omapwiki.orienteering.sport
 * (specifications/isom och specifications/issprom, 2026-11-01).
 *
 * Varifrån reglerna kommer:
 * - ISOM 2017-2 och ISSprOM 2019-2, symbol 703 kontrollring: "Sections of the circle should be omitted to leave
 *   important detail showing." Vilka detaljer som är viktiga anger standarden inte; tabellen är en egen tumregel.
 * - HIGH: linjer man följer eller inte får/kan korsa (vägar, stigar, branter, staket, murar, bäckar, järnväg, broar,
 *   trappor, genomgångar). MEDIUM: små punktobjekt och små landformer (stenar, kullar, gropar, specialobjekt), diken.
 *   LOW: sådant som sällan avgör vägvalet (buskar, ruinerade staket, smala sankmarker).
 * - Bara linje- och punktobjekt klipps. Ytor (byggnader, vegetation, berg i dagen) klipps aldrig: de syns ändå runt ringen.
 * - Kraftledningar (510, 511) och höjdkurvor (101–103) klipps inte: ringen döljer inget man behöver.
 * Tabellen kan ändras per anrop (`DetailGapOptions.symbols`), med samma uppslag som vägvalens tabell.
 */

export type DetailPriority = "HIGH" | "MEDIUM" | "LOW";
export type DetailClass = DetailPriority | "IGNORE";

/** Vikten när ringens budget inte räcker till allt (högre först; vinkelrätt korsande går före vid lika vikt). */
export const DETAIL_PRIORITY_WEIGHT: Readonly<Record<DetailPriority, number>> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** ISOM 2017-2 (gäller också sprint, där numret finns i båda). Ett huvudnummer gäller alla undernummer. */
export const DEFAULT_DETAIL_SYMBOLS: Readonly<Record<string, DetailClass>> = {
  // Landformer: 104 jordbrant, 105 jordvall, 106 rest av jordvall, 107/108 erosionsrännor, 109–112 små kullar och gropar,
  // 115 speciellt terrängföremål.
  "104": "MEDIUM", "105": "MEDIUM", "106": "LOW", "107": "MEDIUM", "108": "MEDIUM",
  "109": "MEDIUM", "110": "MEDIUM", "111": "MEDIUM", "112": "MEDIUM", "115": "MEDIUM",
  // Berg och sten: 201 opasserbar brant, 202 brant, 203 grotta/stenig grop, 204/205 sten, 207 stengrupp, 215 skyttegrav.
  "201": "HIGH", "202": "HIGH", "203": "MEDIUM", "204": "MEDIUM", "205": "MEDIUM", "207": "MEDIUM", "215": "MEDIUM",
  // Vatten: 303 vattenhål, 304/305 bäckar, 306 dike, 309 smal sankmark, 311 brunn, 312 källa, 313 speciellt vattenföremål.
  "303": "MEDIUM", "304": "HIGH", "305": "HIGH", "306": "MEDIUM", "309": "LOW", "311": "MEDIUM", "312": "MEDIUM", "313": "MEDIUM",
  // Vegetation: 417 stort träd, 418 buske eller träd, 419 speciellt vegetationsföremål.
  "417": "MEDIUM", "418": "LOW", "419": "LOW",
  // Vägar och stigar 502–508, järnväg 509, bro 512, trappa 532.
  "502": "HIGH", "503": "HIGH", "504": "HIGH", "505": "HIGH", "506": "HIGH", "507": "HIGH", "508": "MEDIUM",
  "509": "HIGH", "510": "IGNORE", "511": "IGNORE", "512": "HIGH", "532": "HIGH",
  // Murar och staket 513–518, genomgång 519.
  "513": "HIGH", "514": "MEDIUM", "515": "HIGH", "516": "HIGH", "517": "LOW", "518": "HIGH", "519": "HIGH",
  // Byggnadsdetaljer: 523 ruin (minimimått som punkt), 524/525 torn, 526 röse, 527 foderhäck, 528/529 linjeföremål,
  // 530/531 speciella föremål.
  "523": "MEDIUM", "524": "MEDIUM", "525": "MEDIUM", "526": "MEDIUM", "527": "MEDIUM", "528": "MEDIUM", "529": "HIGH",
  "530": "MEDIUM", "531": "MEDIUM"
};

/**
 * ISSprOM 2019-2: det som skiljer sig från ISOM (läggs ovanpå `DEFAULT_DETAIL_SYMBOLS` när händelsen har ISSprOM).
 * 501.1/501.2 trappsteg och kant på belagd yta (linjer; ytan 501 klipps inte), 509.1 järnväg, 509.2 spårväg, 512.1 bro
 * eller tunnelmynning, 512.2 undergång, 411 oframkomlig vegetation, 321 brandpost, 522.1 pelare, 541–545 lekredskap,
 * bord, bänk, stolpe och lyktstolpe.
 */
export const SPRINT_DETAIL_SYMBOLS: Readonly<Record<string, DetailClass>> = {
  "501.1": "MEDIUM", "501.2": "MEDIUM", "509.1": "HIGH", "509.2": "MEDIUM", "512.1": "HIGH", "512.2": "HIGH",
  "411": "HIGH", "321": "LOW", "522.1": "MEDIUM",
  "541": "LOW", "542": "LOW", "543": "LOW", "544": "LOW", "545": "LOW"
};

/** Gränsvärdena för klippen. Mått i kartans mm. */
export const DETAIL_GAP_LIMITS = {
  /**
   * Högst så stor del av ringen klipps för detaljer: ägarens krav ("högst ungefär en fjärdedel"), så att ringen
   * fortfarande läses som en ring.
   */
  maxFraction: 0.25,
  /**
   * Fritt avstånd mellan ringens ände och objektet, på varje sida (egen tumregel: ungefär en halv linjebredd 0,35 mm,
   * så att ringens ände inte nuddar objektet men gapet inte blir större än objektet).
   */
  marginMm: 0.15,
  /**
   * En bit av ringen mellan två gap som är kortare än så här många linjebredder tas också bort (egen tumregel: en bit
   * kortare än ungefär 1 mm läses som en prick).
   */
  minPieceLineWidths: 3,
  /**
   * Ett objekt som går längs ringen klipps inte: gapet får vara högst så här många gånger längre än om objektet korsat
   * ringen vinkelrätt (1 / sin 20°, egen tumregel). Annars skulle en stig längs ringen ta en stor båge.
   */
  maxObliqueness: 1 / Math.sin(20 * Math.PI / 180),
  /** Provtagning runt ringen (grader). 1° är ungefär 0,04 mm på en ring med 2,5 mm radie. */
  sampleDegrees: 1,
  /** Rutnätets ruta för den rumsliga indexeringen (ungefär en ringdiameter). */
  cellMm: 6
} as const;

type Table = Readonly<Record<string, DetailClass>>;

function lookup(table: Table, text: string, main: number, sub: number): DetailClass | undefined {
  return table[text] ?? table[`${main}.${sub}`] ?? (sub === 0 ? table[String(main)] ?? table[`${main}.0`] : undefined) ??
    table[String(main)];
}

/**
 * Klassen för ett symbolnummer: anroparens tabell först, sedan sprinttabellen (vid ISSprOM), sedan standardtabellen.
 * `undefined` = klipps inte.
 */
export function detailClassFor(code: { readonly text: string; readonly main: number; readonly sub: number }, own: Table | undefined,
  sprint: boolean): DetailClass | undefined {
  const text = code.text.trim();
  return (own ? lookup(own, text, code.main, code.sub) : undefined)
    ?? (sprint ? lookup(SPRINT_DETAIL_SYMBOLS, text, code.main, code.sub) : undefined)
    ?? lookup(DEFAULT_DETAIL_SYMBOLS, text, code.main, code.sub);
}
