/**
 * Steg 60 (ADR-0179 beslut 7): standardtabellen för löpbarhet per symbol, ISOM 2017-2 och ISSprOM 2019-2.
 *
 * Varifrån värdena kommer:
 * - Vegetationens farter följer ISOM 2017-2:s riktvärden för löpbarhet (avsnitt 4): 405 skog = 100 %, 406/407
 *   "långsam löpning" 60–80 %, 408/409 "gång" 20–60 %, 410 "svårframkomlig" 0–20 %. Vi tar ungefär mitten av spannet.
 * - 401/402 öppen lättlöpt mark och 403/404 öppen mark med sämre löpbarhet har inget procenttal i ISOM; att 401 är
 *   snabbare än skog och 403 ungefär som 406 är en egen tumregel (PLAN.md steg 60).
 * - Vägar och stigar (501–508) som snabba är en egen tumregel; ISOM anger bara att de är lättlöpta.
 * - Vad som är ej passerbart (201, 301, 307, 411, 515, 518, 520, 521, 529, 708, 709, 714) står i ISOM/ISSprOM:s
 *   definitioner ("impassable", "uncrossable", "shall not be entered", byggnader i sprint).
 * - Stigning, lutning och passerbara branter: se `CLIMB_FACTOR` och följande konstanter (Naismith/Langmuir, Tobler).
 * - Referensfarten 6:00/km är en egen tumregel.
 * Alla tal är startvärden att kalibrera (`calibrateSpeeds`) eller ändra per tävling.
 */
import type { RouteChoiceSettings, SpeedClass } from "./types";

export type RunnableClass = Exclude<SpeedClass, "IMPASSABLE" | "IGNORE">;

export const RUNNABLE_CLASSES: readonly RunnableClass[] = ["FAST", "NORMAL", "SLOW", "VERY_SLOW", "FIGHT"];

/** Fart relativt normal skog. FAST: vägar, stigar, öppen lättlöpt mark. */
export const DEFAULT_SPEED_BY_CLASS: Readonly<Record<RunnableClass, number>> = {
  FAST: 1.25,
  NORMAL: 1.0,
  SLOW: 0.7,
  VERY_SLOW: 0.4,
  FIGHT: 0.1
};

/**
 * Klass per symbolnummer. Ett huvudnummer ("406") gäller alla undernummer som inte står för sig. Höjdkurvorna
 * (101, 102, 103) är IGNORE här men används för stigningen. Nummer från 800 och uppåt är filens egna hjälpsymboler
 * (text, ram, teckenförklaring) och räknas som IGNORE utan att listas som okända.
 */
export const DEFAULT_CLASS_BY_SYMBOL: Readonly<Record<string, SpeedClass>> = {
  // Landformer: används bara för stigning (101–103) eller påverkar inte farten nämnvärt.
  "101": "IGNORE", "102": "IGNORE", "103": "IGNORE", "104": "IGNORE", "105": "IGNORE", "106": "IGNORE",
  "107": "IGNORE", "108": "IGNORE", "109": "IGNORE", "110": "IGNORE", "111": "IGNORE", "112": "IGNORE",
  "113": "IGNORE",
  /** ISOM 114 mycket småkuperad mark: egen tumregel. */
  "114": "SLOW",
  "115": "IGNORE",
  // Berg och sten. 201 opasserbar brant (även minimimått och taggar); passerbara branter och stenar ignoreras.
  "201": "IMPASSABLE", "202": "IGNORE", "203": "IGNORE", "204": "IGNORE", "205": "IGNORE", "206": "IGNORE",
  "207": "IGNORE", "208": "IGNORE",
  /** 209 tät blockterräng, 210 stenig mark löphindrande, 211 gång, 212 svårframkomlig (ISOM:s grader). */
  "209": "SLOW", "210": "SLOW", "211": "VERY_SLOW", "212": "FIGHT",
  /** 213 öppen sandmark: "slow running" i ISOM. */
  "213": "SLOW",
  "214": "IGNORE", "215": "IGNORE",
  // Vatten och sankmark. 301 och 307 spärrar men kan korsas av vägar och broar.
  "301": "IMPASSABLE",
  /** 302 grunt vatten: passerbart men långsamt (egen tumregel). */
  "302": "VERY_SLOW",
  "303": "IGNORE",
  /** 304 passerbart vattendrag: kostar lite att korsa. */
  "304": "SLOW",
  "305": "IGNORE", "306": "IGNORE",
  "307": "IMPASSABLE",
  "308": "SLOW", "309": "SLOW",
  "310": "NORMAL",
  "311": "IGNORE", "312": "IGNORE", "313": "IGNORE",
  // Vegetation (ISOM:s riktvärden, se ovan).
  "401": "FAST", "402": "FAST", "403": "SLOW", "404": "SLOW", "405": "NORMAL",
  "406": "SLOW", "407": "SLOW", "408": "VERY_SLOW", "409": "VERY_SLOW", "410": "FIGHT",
  "411": "IMPASSABLE",
  "412": "NORMAL", "413": "IGNORE", "414": "IGNORE", "415": "IGNORE", "416": "IGNORE", "417": "IGNORE",
  "418": "IGNORE", "419": "IGNORE",
  // Vägar och stigar (snabbt lager ovanpå vegetationen), byggnader och spärrar.
  "501": "FAST", "502": "FAST", "503": "FAST", "504": "FAST", "505": "FAST", "506": "FAST", "507": "FAST",
  "508": "NORMAL",
  "509": "IGNORE", "510": "IGNORE", "511": "IGNORE",
  /** 512 bro: snabb, och vägar får korsa vatten (se `cost-model.ts`). */
  "512": "FAST",
  "513": "IGNORE", "514": "IGNORE",
  "515": "IMPASSABLE",
  "516": "IGNORE", "517": "IGNORE",
  "518": "IMPASSABLE",
  /** 519 genomgång: öppnar ej passerbara linjer där den står (se `cost-model.ts`). */
  "519": "IGNORE",
  "520": "IMPASSABLE", "521": "IMPASSABLE",
  /** 522 skärmtak: passerbart, marken under gäller. */
  "522": "IGNORE",
  "523": "IGNORE", "524": "IGNORE", "525": "IGNORE", "526": "IGNORE", "527": "IGNORE", "528": "IGNORE",
  "529": "IMPASSABLE",
  "530": "IGNORE", "531": "IGNORE",
  /** 532 trappa: som stig men inte snabbare än skog (egen tumregel). */
  "532": "NORMAL",
  // Tekniska symboler och banpåtryck.
  "601": "IGNORE", "602": "IGNORE", "603": "IGNORE",
  "701": "IGNORE", "702": "IGNORE", "703": "IGNORE", "704": "IGNORE", "705": "IGNORE", "706": "IGNORE",
  /** 707 markerad sträcka: löparen följer den, analysen ignorerar den. */
  "707": "IGNORE",
  /** 708 gräns för förbjudet område, 709 förbjudet område (banpåtryck). */
  "708": "IMPASSABLE", "709": "IMPASSABLE",
  /** 710 passage (710.1 punkt, 710.2 sträcka i ISSprOM): öppnar ej passerbart där den står, som 519. */
  "710": "IGNORE",
  /** 711 förbjuden väg: får korsas men inte följas; analysen ignorerar den (förenkling). */
  "711": "IGNORE",
  "712": "IGNORE", "713": "IGNORE",
  "714": "IMPASSABLE"
};

/** Symboler som öppnar ej passerbart (staket, murar, byggnader) där de står: 519 genomgång, 710 passage. */
export const CROSSING_SYMBOLS: readonly number[] = [519, 710];
/** Vägar, stigar, belagd yta, broar och trappor: ett snabbt lager ovanpå vegetationen (en stig i tät skog är snabb). */
export function isTrackSymbol(main: number): boolean {
  return (main >= 501 && main <= 508) || main === 512 || main === 532;
}
/** Ej passerbart som vägar, stigar och broar får korsa: vatten (301) och sankmark (307). */
export const BRIDGEABLE_SYMBOLS: readonly number[] = [301, 307];
/** Höjdkurvor: hel ekvidistans (101 höjdkurva, 102 stödkurva) och halv (103 hjälpkurva). */
export const CONTOUR_SYMBOLS: readonly number[] = [101, 102];
export const FORM_LINE_SYMBOLS: readonly number[] = [103];
/** Från 800 och uppåt: filens egna hjälpsymboler. */
export const FIRST_CUSTOM_SYMBOL = 800;

/**
 * Stigningsmodellen (ADR-0179 beslut 10, ändrad 2026-11-01). Kartan har höjdkurvor men inga höjder, så vid en
 * kurvpassage vet vi inte om det går uppför eller nedför. Tre delar som inte överlappar:
 *
 * 1. **Kurvpassagerna** står för det vertikala arbetet, överallt (även på stigar och vägar: uppför är jobbigt och
 *    brant nedför går långsamt även på stig). En passage kostar i väntevärde ekvidistans × (`climbFactor` +
 *    `descentFactor`) / 2 meter plan väg. Mellan två givna kontroller är höjdskillnaden Δh = upp − ned densamma för
 *    alla vägar, så skillnaden mellan två vägar blir exakt (`climbFactor` + `descentFactor`) × skillnaden i stigning
 *    uppför: regeln rangordnar vägarna rätt utan att veta riktningen. En kurva som passeras två gånger är alltid ett upp
 *    och ett ned. Bara den uppskattade tiden kan bli fel, med högst (`climbFactor` − `descentFactor`) / 2 × |Δh|.
 *    - `climbFactor` 8: Naismith (1892), 1 timme per 600 m stigning mot 5 km/h plant = 8,3 m plan väg per höjdmeter;
 *      orienteringens tumregel 1 höjdmeter ≈ 8–10 m plan väg.
 *    - `descentFactor` 3: Langmuir (1984) lägger till 10 min per 300 m nedför i brant lutning (över 12°) = 2,8 m plan väg
 *      per höjdmeter (och drar av lika mycket i lätt lutning, 5–12°). Tobler (1993) ger 2,1 m per höjdmeter vid −20 %
 *      och 3,4 vid −30 %. Där kurvorna ligger tätt nog att påverka vägvalet är lutningen oftast över 12°, så den branta
 *      siffran gäller, avrundad till 3. En passerad kurva kostar då 5 × (8 + 3) / 2 = 27,5 m med 5 m ekvidistans.
 * 2. **Lutningsfaktorn** står för framkomligheten i brant terräng utan stig: uppför, nedför och skrå. Lutningen g
 *    skattas ur kurvbildens täthet (g ≈ ekvidistans × kurvlängd per ytenhet, se `raster.ts`), och tiden per meter i
 *    marken multipliceras med 1 + `slopeFactor` × (e^(3,5·(g − 0,10)) − 1) när g är över 10 %. Stigar och vägar
 *    påverkas inte: en stig som skrår längs en sluttning är lättlöpt. Formen är Toblers nedförsgren (farten är densamma
 *    som plant vid −10 % och faller med e^(−3,5·Δg) därefter), som speglar underlag och fotfäste och inte höjdarbetet.
 *    Styrkan 0,2 är vald så att upp + ned över en sluttning i skog (lutningsfaktorn åt båda hållen plus kurvpassagerna)
 *    hamnar mitt emellan Langmuir och Tobler vid 50 %: 8,7 m tid per meter fram och tillbaka (Langmuir 7,6, Tobler
 *    9,8); vid 30 % 5,7 (5,3 och 4,9). Skrå i skog längs 30 % blir 20 % långsammare, längs 50 % 60 % långsammare.
 *    Lutningen står bara för framkomligheten; höjdarbetet räknas inte en gång till.
 * 3. **Branter, vallar, staket och murar som går att passera** kostar en fast sträcka per passage (tabellen nedan).
 */
export const CLIMB_FACTOR = 8;
export const DESCENT_FACTOR = 3;
export const SLOPE_FACTOR = 0.2;
/** Lutning (höjd/längd) där lutningsfaktorn börjar verka: Toblers fart är lika med plant vid −10 %. */
export const SLOPE_FREE_GRADE = 0.1;
/** Toblers exponent: farten faller med e^(−3,5 × lutning). */
export const SLOPE_EXPONENT = 3.5;
/** Högsta lutning som räknas (35°); brantare än så ritas som brant (201/202) på kartan. */
export const SLOPE_MAX_GRADE = 0.7;
/**
 * Radien (m) som kurvlängden per ytenhet räknas över: mindre än en typisk sluttning, men så stor att rutan (41 m med
 * 2 m celler) nästan alltid rymmer en kurva där lutningen är över 10 % (kurvavstånd under 50 m med 5 m ekvidistans).
 * Annars blir skattningen taggig mellan glesa kurvor och lutningens tillägg för stort i snitt.
 */
export const SLOPE_RADIUS_METERS = 20;
/** Hjälpkurvor (103) är halv ekvidistans och räknas till hälften i lutningen, som i stigningen. */
export const FORM_LINE_WEIGHT = 0.5;

/** Lutningens tillägg på tiden per meter, utan styrkan: e^(3,5·(g − 0,10)) − 1 när g är över 10 %, annars 0. */
export function slopeExcess(grade: number): number {
  const g = Math.min(grade, SLOPE_MAX_GRADE);
  return g > SLOPE_FREE_GRADE ? Math.exp(SLOPE_EXPONENT * (g - SLOPE_FREE_GRADE)) - 1 : 0;
}

/**
 * Meter plan väg per passage av ett linjeobjekt som går att passera. Med 6:00/km är 1 m ≈ 0,36 s. Egna tumregler
 * utifrån definitionerna i ISOM 2017-2 och ISSprOM 2019-2 (omapwiki.orienteering.sport):
 * - 202 brant (ISSprOM: passable rock face), minst 1 m hög (0,6 m i sprint), "crossing a cliff will normally slow
 *   progress": 15 m ≈ 5 s.
 * - 104 jordbrant, minst 1 m, "may impact runnability": 8 m ≈ 3 s. 105 jordvall (105.1, 105.2): 5 m. 106 rasad
 *   jordvall: 2 m.
 * - 107 erosionsränna (ned och upp): 8 m. 108 liten erosionsränna: 3 m. 215 dike: 8 m.
 * - 513 mur (513.1, 513.2; i sprint passable wall): 8 m. 514 rasad mur: 2 m.
 * - 516 staket (klättra över): 15 m. 517 rasat staket: 3 m.
 * Ej passerbara varianter (201, 515, 518) spärrar. Där en väg eller stig korsar linjen kostar passagen inget (en stig
 * genom en brant eller ett staket betyder att det finns en väg igenom). Ändras per tävling med `crossingMetersBySymbol`.
 */
export const DEFAULT_CROSSING_METERS_BY_SYMBOL: Readonly<Record<string, number>> = {
  "104": 8, "105": 5, "106": 2, "107": 8, "108": 3,
  "202": 15, "215": 8,
  "513": 8, "514": 2, "516": 15, "517": 3
};

export interface ResolvedSettings {
  readonly version: 1;
  readonly classBySymbol: Readonly<Record<string, SpeedClass>>;
  readonly speedByClass: Readonly<Record<RunnableClass, number>>;
  readonly contourIntervalMeters: number;
  readonly climbFactor: number;
  readonly descentFactor: number;
  readonly slopeFactor: number;
  /** Tävlingens egna passagekostnader; slås upp före standardtabellen (`crossingForCode`). */
  readonly crossingMetersBySymbol: Readonly<Record<string, number>>;
  readonly referencePaceSecondsPerKm: number;
}

/** Kostnaden (meter plan väg) per stigningsenhet i rutnätet; en passerad kurva är 4 enheter (2 in och 2 ut). */
export function climbCostPerUnit(settings: Pick<ResolvedSettings, "contourIntervalMeters" | "climbFactor" | "descentFactor">): number {
  return settings.contourIntervalMeters * (settings.climbFactor + settings.descentFactor) / 2 / 4;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Inställningarna med standardvärden där något saknas. `classBySymbol` innehåller bara tävlingens egna rader (de
 * slås upp före standardtabellen, se `classForCode`). Ogiltiga tal ersätts med standardvärdet.
 */
export function resolveSettings(settings?: RouteChoiceSettings | null): ResolvedSettings {
  const speeds: Record<RunnableClass, number> = { ...DEFAULT_SPEED_BY_CLASS };
  for (const cls of RUNNABLE_CLASSES) speeds[cls] = positive(settings?.speedByClass?.[cls], DEFAULT_SPEED_BY_CLASS[cls]);
  return {
    version: 1,
    classBySymbol: { ...(settings?.classBySymbol ?? {}) },
    speedByClass: speeds,
    contourIntervalMeters: positive(settings?.contourIntervalMeters, 5),
    climbFactor: nonNegative(settings?.climbFactor, CLIMB_FACTOR),
    descentFactor: nonNegative(settings?.descentFactor, DESCENT_FACTOR),
    slopeFactor: nonNegative(settings?.slopeFactor, SLOPE_FACTOR),
    crossingMetersBySymbol: Object.fromEntries(Object.entries(settings?.crossingMetersBySymbol ?? {})
      .filter(([, value]) => Number.isFinite(value) && value >= 0)),
    referencePaceSecondsPerKm: positive(settings?.referencePaceSecondsPerKm, 360)
  };
}

function lookup<T>(table: Readonly<Record<string, T>>, text: string, main: number, sub: number): T | undefined {
  return table[text] ?? table[`${main}.${sub}`] ?? (sub === 0 ? table[String(main)] ?? table[`${main}.0`] : undefined) ??
    table[String(main)];
}

/**
 * Klassen för ett symbolnummer: tävlingens tabell först (exakt nummer, sedan huvudnummer), sedan standardtabellen.
 * `undefined` = okänd symbol.
 */
export function classForCode(settings: ResolvedSettings, code: { readonly text: string; readonly main: number; readonly sub: number }): SpeedClass | undefined {
  const own = lookup(settings.classBySymbol, code.text.trim(), code.main, code.sub);
  if (own) return own;
  const standard = lookup(DEFAULT_CLASS_BY_SYMBOL, code.text.trim(), code.main, code.sub);
  if (standard) return standard;
  if (code.main >= FIRST_CUSTOM_SYMBOL) return "IGNORE";
  return undefined;
}

/** Passagekostnaden (meter plan väg) för ett symbolnummer: tävlingens tabell först, sedan standardtabellen; 0 = ingen. */
export function crossingForCode(settings: ResolvedSettings, code: { readonly text: string; readonly main: number; readonly sub: number }): number {
  return lookup(settings.crossingMetersBySymbol, code.text.trim(), code.main, code.sub) ??
    lookup(DEFAULT_CROSSING_METERS_BY_SYMBOL, code.text.trim(), code.main, code.sub) ?? 0;
}
