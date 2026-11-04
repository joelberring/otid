/**
 * Färgordningen i trycket enligt normen (ADR-0211 beslut 3): IOF:s bilaga till ISOM 2017 "CMYK printing and colour
 * definitions (includes ISSprOM)", avsnitt 4 (ISOM) och 7 (ISSprOM), och avsnitt 5 om laserskrivare (övertrycket simuleras
 * genom att banans lila läggs under 100 % svart, brunt och blått).
 *
 * - **ISOM (skog), överst först:** övre lila, vitt (övre), svart (utom 100 % svart för stora byggnader), blått 100 % för
 *   punkt- och linjesymboler, brunt 100 %, banans lila; under banan vägfyllning (brunt 50 %), vägkanter (svart 100 %), blått
 *   100 % för vatten och sankmark och alla rastrerade färger, grönt och gult.
 * - **ISSprOM (sprint), överst först:** övre lila (alla bansymboler utom 701, 703, 705, 706, 708 och 710.1), vitt, svart
 *   100 %, grönt 100 % (punktsymboler), undre lila (701, 703, 705, 706, 708, 710.1); under banan magenta 50 %, blått 100 %,
 *   brunt 100 %, byggnader (svart 60 %) och alla rastrerade färger.
 *
 * Kartfärgerna sorteras här i två grupper, över och under banans (undre) lila. BL:s tabell är fortfarande källan till CMYK
 * (`colorDecisions`), men platsen går efter normen: BL:s regel "under brunt, svart och 100 % blå" sade inget om skärmar,
 * så asfalt (brunt 50 %) och stora byggnaders svarta fyllning kunde hamna över banan och dölja ringar och nummer.
 */
import type { ColorUsage } from "@o-tid/map-file";
import { colorComponents, normalizeColorName } from "./color-match";
import { BUILT_IN_PRINT_PROFILES, type Cmyk100, type PrintProfile, type SourceMapColor } from "./print-profile";
import type { OverprintPrimitive } from "./types";

export type PressNorm = "ISOM" | "ISSPROM";

/** Vad en kartfärg är i normens lista. */
export type PressColorKind =
  | "WHITE" | "BLACK" | "BLACK_BUILDING" | "BLACK_ROAD_EDGE" | "BLACK_PATTERN" | "BLUE_LINE" | "BLUE_AREA" | "BROWN" | "GREEN_POINT" | "GREEN"
  | "MAGENTA" | "SCREEN";

export interface PressColorClass {
  readonly ocadId: number;
  readonly name: string;
  readonly kind: PressColorKind;
  /** Över eller under banans (undre) lila. */
  readonly side: "OVER" | "UNDER";
}

/** ISSprOM 2019-2-symboler som inte finns i ISOM 2017-2 (för att känna igen en sprintkarta). */
const SPRINT_ONLY_CODES = ["501.1", "501.2", "509.1", "509.2", "512.1", "512.2", "520.1", "520.2", "521.1", "522.1", "528.1", "541", "542", "543", "544", "545"];

/**
 * Normen för en karta: sprint (ISSprOM) om kartan är i 1:4 000 eller 1:5 000 eller har minst två av sprintnormens egna
 * symbolnummer, annars skog (ISOM).
 */
export function detectPressNorm(map: { readonly scale?: number | undefined; readonly codes?: Iterable<string> | undefined }): PressNorm {
  if (map.scale === 4000 || map.scale === 5000) return "ISSPROM";
  const codes = new Set(map.codes ?? []);
  const sprint = SPRINT_ONLY_CODES.filter(code => codes.has(code) || [...codes].some(item => item.startsWith(`${code}.`)));
  return sprint.length >= 2 ? "ISSPROM" : "ISOM";
}

/** Symbolnumren som kartans färger används av (`colorUsage`), för `detectPressNorm`. */
export function usageCodes(usage: Iterable<ColorUsage | undefined>): string[] {
  const out = new Set<string>();
  for (const item of usage) for (const code of item?.codes ?? []) out.add(code.replace(/\.0+$/, ""));
  return [...out];
}

const SCREEN_WORDS = /\b(asfalt|hårdgjord|belagd|vägfyllning|fyllning|fill|paved|tomt|tomtmark|privat|bebyggelse|settlement|olive|oliv|tak|roof|takt|raster|screen)/;
const BUILDING_WORDS = /\b(byggnad|building|hus|house)/;
const ROAD_EDGE_WORDS = /\b(vägkant|väg sidlinje|sidlinje|road edge|kant)/;
const AREA_WORDS = /\b(yta|area|ytobjekt|sjö|lake|vatten yta|sank)/;
const POINT_WORDS = /\b(punkt|point)/;
/** Svart som mönster i ytor (ISOM 412 odlad mark): normen har ingen rad för det; det ligger bland skärmarna i kartfilen. */
const PATTERN_WORDS = /\b(odlad|odlade|åker|cultivated|cultivation|mönster|pattern)/;

const only = (usage: ColorUsage | undefined, kind: ColorUsage["kinds"][number]) => usage !== undefined && usage.kinds.length > 0 && usage.kinds.every(item => item === kind);
const allMains = (usage: ColorUsage | undefined, mains: readonly number[]) => usage !== undefined && usage.mains.length > 0 && usage.mains.every(main => mains.includes(main));

/** Färgens grundslag ur CMYK (procent): full styrka eller skärm. */
function inkOf(cmyk: Cmyk100): "WHITE" | "BLACK" | "BLUE" | "BROWN" | "GREEN" | "MAGENTA" | "SCREEN" {
  const { c, m, y, k } = cmyk;
  if (Math.max(c, m, y, k) <= 2) return "WHITE";
  if (k >= 90 && c <= 15 && m <= 15 && y <= 15) return "BLACK";
  if (c >= 90 && m <= 35 && y <= 15 && k <= 15) return "BLUE";
  if (m >= 40 && y >= 90 && c <= 30) return "BROWN";
  if (c >= 60 && y >= 80 && m <= 15 && k <= 15) return "GREEN";
  if (m >= 85 && y <= 15 && k <= 15) return "MAGENTA";
  return "SCREEN";
}

/** Vad kartfärgen är (namn, CMYK och användning). En andel under 90 % i namnet eller ett ord som "asfalt" gör den till skärm. */
export function pressColorKind(color: Pick<SourceMapColor, "name" | "cmyk" | "usage">): PressColorKind {
  const name = normalizeColorName(color.name);
  const ink = inkOf(color.cmyk);
  if (ink === "WHITE") return "WHITE";
  const parts = colorComponents(color.name);
  if (SCREEN_WORDS.test(name) || parts.some(part => part.hue !== "white" && part.percent < 90)) return "SCREEN";
  const usage = color.usage;
  switch (ink) {
    case "BLACK":
      // ISOM 521 byggnad (och 521.x) som yta = stora byggnaders svarta fyllning.
      if ((only(usage, "AREA") && allMains(usage, [521])) || (BUILDING_WORDS.test(name) && (!usage || only(usage, "AREA")))) return "BLACK_BUILDING";
      if (ROAD_EDGE_WORDS.test(name)) return "BLACK_ROAD_EDGE";
      // ISOM 412 odlad mark (och 413, 414): svarta prickar i en yta, ett raster som ritas med skärmarna.
      if (PATTERN_WORDS.test(name) || (only(usage, "AREA") && allMains(usage, [412, 413, 414]))) return "BLACK_PATTERN";
      return "BLACK";
    case "BLUE": return only(usage, "AREA") || (!usage && AREA_WORDS.test(name)) ? "BLUE_AREA" : "BLUE_LINE";
    case "BROWN": return "BROWN";
    case "GREEN": return only(usage, "POINT") || (!usage && POINT_WORDS.test(name)) ? "GREEN_POINT" : "GREEN";
    case "MAGENTA": return "MAGENTA";
    default: return "SCREEN";
  }
}

/** Färgslagen över banans (undre) lila per norm; vitt bestäms av sin plats i kartans ordning. */
const OVER_KINDS: Readonly<Record<PressNorm, ReadonlySet<PressColorKind>>> = {
  ISOM: new Set(["BLACK", "BLUE_LINE", "BROWN", "MAGENTA"]),
  ISSPROM: new Set(["BLACK", "BLACK_BUILDING", "BLACK_ROAD_EDGE", "GREEN_POINT", "MAGENTA"])
};

/**
 * Kartans färger över och under banan enligt normen. Normen bestämmer bara *sidan*; inom varje sida ritas färgerna i
 * kartfilens egen ordning (PDF:en och förhandsvisningen ritar varje sida med `onlyColors`).
 *
 * Vitt har ingen egen plats i normen utom "vitt (övre)". Ett vitt i kartfilen är nästan alltid en gloria eller en
 * grundlinje under en annan färg i samma symbol (vitt under ett grönt träd, vit linje under järnvägens svarta streck,
 * vit vägfyllning mellan svarta kanter). Det ligger därför över banan bara när kartfilen ritar det över all svart (den
 * översta svarta färgen över banan) och ingen färg under banan ritas över det i kartfilen (äkta övre vitt, masker).
 * Annars under banan: allt som kartfilen ritar över vitet ritas då fortfarande efter det, oavsett sida.
 */
export function pressOrder(colors: readonly SourceMapColor[], norm: PressNorm): { readonly over: ReadonlySet<number>; readonly classes: readonly PressColorClass[] } {
  const kinds = colors.map(color => ({ color, kind: pressColorKind(color) }));
  const isOver = (kind: PressColorKind) => OVER_KINDS[norm].has(kind);
  const overOrders = kinds.filter(item => isOver(item.kind)).map(item => item.color.drawOrder);
  const blackOrders = kinds.filter(item => item.kind === "BLACK" && isOver(item.kind)).map(item => item.color.drawOrder);
  // Vitt över banan måste ligga över den översta svarta (finns ingen: över den översta färgen över banan).
  const upperFrom = Math.max(...(blackOrders.length > 0 ? blackOrders : overOrders));
  const underOrders = kinds.filter(item => item.kind !== "WHITE" && !isOver(item.kind)).map(item => item.color.drawOrder);
  const highestUnder = Math.max(-Infinity, ...underOrders);
  const classes = kinds.map(({ color, kind }): PressColorClass => {
    const over = kind === "WHITE" ? overOrders.length > 0 && color.drawOrder > upperFrom && color.drawOrder > highestUnder : isOver(kind);
    return { ocadId: color.ocadId, name: color.name, kind, side: over ? "OVER" : "UNDER" };
  });
  return { over: new Set(classes.filter(item => item.side === "OVER").map(item => item.ocadId)), classes };
}

/**
 * Banans figurer i undre lila: 701 start, 703 ring, 705 linje, 706 mål, 708 snitslad väg och 710.1 passage (ISSprOM:s
 * lista; ISOM delar på samma sätt). Allt annat (nummer, markeringar, texter) är övre lila och ritas över kartans färger.
 * I ISOM ligger numren enligt bilagan i undre lila (förval), så att svart, brunt och blått 100 % korsar dem och de ser lite
 * genomsiktliga ut; `numbersOnTop` lägger dem i övre lila som i sprint. ISSprOM har alltid numren i övre lila (704 finns
 * inte i listan för undre lila).
 */
export function lowerPurple(figure: OverprintPrimitive, norm: PressNorm, numbersOnTop = false): boolean {
  if (figure.kind === "image" || figure.kind === "description") return false;
  if (figure.color !== "COURSE" && figure.color !== "COURSE_LOWER") return false;
  switch (figure.role) {
    case "START": case "CONTROL": case "FINISH": case "CROSSING_POINT": case "MAP_EXCHANGE": case "LEG": case "FLAGGING": case "OVERLAP": case "TRAINING":
      return figure.kind !== "text" || (norm === "ISOM" && !numbersOnTop);
    case "NUMBER": return norm === "ISOM" && !numbersOnTop;
    default: return false;
  }
}

/**
 * Profilen för "Skapa PDF för kontorsskrivare": kontorsskrivarens färger (ljusare grönt och gult) med tävlingsprofilens
 * färgordning (normen, banan i färgordningen och numren), så att kontors-PDF:en har samma lager som förhandsvisningen och
 * trycket. Övertrycket blir multiplicering i PDF:en (ADR-0211 beslut 11).
 */
export function officePrintProfile(from: Pick<PrintProfile, "courseLayer" | "pressNorm" | "numbersOnTop">): PrintProfile {
  const office = BUILT_IN_PRINT_PROFILES.find(item => item.id === "office")!;
  return { ...office, ...(from.courseLayer ? { courseLayer: from.courseLayer } : {}), ...(from.pressNorm ? { pressNorm: from.pressNorm } : {}),
    ...(from.numbersOnTop !== undefined ? { numbersOnTop: from.numbersOnTop } : {}) };
}
