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
 * - Stigningen (1 m stigning = 8 m plan väg, ekvidistans 5 m) och referensfarten 6:00/km är egna tumregler.
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

export interface ResolvedSettings {
  readonly version: 1;
  readonly classBySymbol: Readonly<Record<string, SpeedClass>>;
  readonly speedByClass: Readonly<Record<RunnableClass, number>>;
  readonly contourIntervalMeters: number;
  readonly climbFactor: number;
  readonly referencePaceSecondsPerKm: number;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
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
    climbFactor: settings?.climbFactor !== undefined && Number.isFinite(settings.climbFactor) && settings.climbFactor >= 0
      ? settings.climbFactor : 8,
    referencePaceSecondsPerKm: positive(settings?.referencePaceSecondsPerKm, 360)
  };
}

function lookup(table: Readonly<Record<string, SpeedClass>>, text: string, main: number, sub: number): SpeedClass | undefined {
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
