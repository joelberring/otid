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
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { colorComponents, normalizeColorName } from "./color-match";
import { BUILT_IN_PRINT_PROFILES, type Cmyk100, type MapColorAdjust, type PrintProfile, type SourceMapColor } from "./print-profile";
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

/** Ett sammanhängande band av färger i `OVER` (ritordning): bläck som kan blandas/övertrycka, eller vitt som alltid slår ut. */
export interface OverColorBand {
  readonly kind: "INK" | "WHITE";
  readonly ids: readonly number[];
}

/** ISSprOM 2019-2-symboler som inte finns i ISOM 2017-2 (för att känna igen en sprintkarta). */
const SPRINT_ONLY_CODES = ["501.2", "509.1", "509.2", "512.1", "512.2", "520.1", "520.2", "522.1", "528.1", "541", "542", "543", "544", "545"];

/**
 * Normen för en karta: sprint (ISSprOM) om kartan är i 1:3 000, 1:4 000 eller 1:5 000 eller har minst två av sprintnormens egna
 * symbolnummer, annars skog (ISOM).
 */
export function detectPressNorm(map: { readonly scale?: number | undefined; readonly codes?: Iterable<string> | undefined }): PressNorm {
  if (map.scale === 3000 || map.scale === 4000 || map.scale === 5000) return "ISSPROM";
  if (map.scale !== undefined && map.scale >= 15000) return "ISOM";
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
const hasAnyMain = (usage: ColorUsage | undefined, mains: readonly number[]) => usage !== undefined && usage.mains.some(main => mains.includes(main));

/** Färgens grundslag ur CMYK (procent): full styrka eller skärm. */
function inkOf(cmyk: Cmyk100): "WHITE" | "BLACK" | "BLUE" | "BROWN" | "GREEN" | "MAGENTA" | "SCREEN" {
  const { c, m, y, k } = cmyk;
  if (Math.max(c, m, y, k) <= 2) return "WHITE";
  if (k >= 90 && c <= 15 && m <= 15 && y <= 15) return "BLACK";
  if (c >= 85 && m <= 35 && y <= 15 && k <= 15) return "BLUE";
  // Ren röd (t.ex. 0/100/100/0 förbjudet / röd linje) ligger över banan i båda normerna, inte som brunt.
  if (m >= 85 && y >= 85 && c <= 15 && k <= 15) return "MAGENTA";
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
    case "BLUE":
      return only(usage, "AREA") || AREA_WORDS.test(name) || (usage?.kinds.includes("AREA") && allMains(usage, [301, 302, 307, 308, 310]))
        ? "BLUE_AREA" : "BLUE_LINE";
    case "BROWN": return "BROWN";
    case "GREEN":
      return only(usage, "POINT")
        || (usage !== undefined && !usage.kinds.includes("AREA") && hasAnyMain(usage, [417, 418, 419]))
        || (!usage && POINT_WORDS.test(name))
        ? "GREEN_POINT" : "GREEN";
    case "MAGENTA": return "MAGENTA";
    default: return "SCREEN";
  }
}

/** Färgslagen över banans (undre) lila per norm. */
const OVER_KINDS: Readonly<Record<PressNorm, ReadonlySet<PressColorKind>>> = {
  ISOM: new Set(["BLACK", "BLUE_LINE", "BROWN", "MAGENTA"]),
  ISSPROM: new Set(["BLACK", "BLACK_BUILDING", "BLACK_ROAD_EDGE", "GREEN_POINT", "MAGENTA"])
};

/**
 * Kartans färger över och under banan enligt normen med en enda monoton snittpunkt i kartfilens ritordning (`drawOrder`).
 * Snittpunkten ligger vid den lägsta använda färgen bland normens övre färger; alla färger från och med snittpunkten hamnar
 * `OVER` i exakt ursprunglig `rank`-ordning så att ingen symbol tappar sin inbördes ritordning (t.ex. vägfyllning över
 * vägkanter eller gröna träd över sin vita gloria). Enda undantaget är solida svarta byggnadsytor (`BLACK_BUILDING`, K ≥ 90)
 * i ISOM som hålls `UNDER` så att 100 % svarta byggnader inte döljer lila.
 */
export function pressOrder(colors: readonly SourceMapColor[], norm: PressNorm): { readonly over: ReadonlySet<number>; readonly classes: readonly PressColorClass[] } {
  const kinds = colors.map(color => ({ color, kind: pressColorKind(color) }));
  const hasUsage = colors.some(color => color.usage !== undefined);
  const isUsed = (color: SourceMapColor) => !hasUsage || (color.usage !== undefined && color.usage.objects > 0);
  const anchors = kinds.filter(item => OVER_KINDS[norm].has(item.kind) && isUsed(item.color));
  const cutpoint = anchors.length > 0 ? Math.min(...anchors.map(item => item.color.drawOrder)) : Infinity;
  const classes = kinds.map((item): PressColorClass => {
    const solidIsomBuilding = norm === "ISOM" && item.kind === "BLACK_BUILDING" && item.color.cmyk.k >= 90;
    const over = item.color.drawOrder >= cutpoint && !solidIsomBuilding;
    return { ocadId: item.color.ocadId, name: item.color.name, kind: item.kind, side: over ? "OVER" : "UNDER" };
  });
  return { over: new Set(classes.filter(item => item.side === "OVER").map(item => item.ocadId)), classes };
}

/**
 * `OVER`-färgerna i kartfilens ritordning (högst `rank` först → `rank 0` sist, utan `hidden`), uppdelade i sammanhängande
 * `INK`- och `WHITE`-band (vit = efterjusterad CMYK med maxkanal ≤ 0,02).
 */
export function overColorBands(
  colors: readonly Pick<MapColor, "id" | "rank" | "cmyk">[],
  over: ReadonlySet<number>,
  adjust?: Readonly<Record<number, MapColorAdjust>>
): OverColorBand[] {
  const ordered = [...colors].sort((left, right) => right.rank - left.rank || left.id - right.id);
  const bands: { kind: OverColorBand["kind"]; ids: number[] }[] = [];
  for (const color of ordered) {
    if (!over.has(color.id)) continue;
    const setting = adjust?.[color.id];
    if (setting?.hidden) continue;
    const source = setting?.cmyk ?? color.cmyk;
    const amount = Math.max(-1, Math.min(1, Number.isFinite(setting?.lighten) ? setting!.lighten! : 0));
    const ink = (value: number) => Math.max(0, Math.min(1, value * (1 - amount)));
    const kind: OverColorBand["kind"] = Math.max(ink(source.c), ink(source.m), ink(source.y), ink(source.k)) <= 0.02 ? "WHITE" : "INK";
    const last = bands.at(-1);
    if (last && last.kind === kind) last.ids.push(color.id);
    else bands.push({ kind, ids: [color.id] });
  }
  return bands;
}

/**
 * Banans figurer i undre lila: 701 start, 703 ring, 705 linje, 706 mål, 708 snitslad väg och 710.1 passage (ISSprOM:s
 * lista; ISOM delar på samma sätt), samt alla figurer uttryckligen märkta med `COURSE_LOWER`. Allt annat (nummer,
 * markeringar, texter) är övre lila och ritas över kartans färger. I ISOM ligger numren enligt bilagan i undre lila (förval),
 * så att svart, brunt och blått 100 % korsar dem; `numbersOnTop` lägger dem i övre lila som i sprint.
 */
export function lowerPurple(figure: OverprintPrimitive, norm: PressNorm, numbersOnTop = false): boolean {
  if (figure.kind === "image" || figure.kind === "description") return false;
  if (figure.color === "COURSE_LOWER") return true;
  if (figure.color !== "COURSE") return false;
  switch (figure.role) {
    case "START": case "CONTROL": case "FINISH": case "CROSSING_POINT": case "MAP_EXCHANGE": case "LEG": case "FLAGGING": case "OVERLAP": case "TRAINING":
      return figure.kind !== "text" || (norm === "ISOM" && !numbersOnTop);
    case "NUMBER": return norm === "ISOM" && !numbersOnTop;
    default: return false;
  }
}

/**
 * Specialobjekt under banans lila (städrundan 2026-11-07, ändrar ADR-0211 beslut 3): vita ytor (white-out, en karträttelse)
 * och bilder (illustrationer). De ritas över hela kartan och under banan, som i Purple Pen där banan och dess vita och bilder
 * ligger över kartan i den ordningen: kartans färger över banan ritas inte i dem, och ringar, sträckor och nummer står över.
 * I övre lila raderade vitt sträck och ringar och bilderna täckte banan.
 */
export function beneathCourse(figure: OverprintPrimitive): boolean {
  return figure.role === "SPECIAL" && (figure.kind === "image" || figure.color === "WHITE");
}

/** Figurens lager i normens färgordning: under banan (`beneathCourse`), undre lila (`lowerPurple`) eller övre lila. */
export function courseLayerOf(figure: OverprintPrimitive, norm: PressNorm, numbersOnTop = false): "BENEATH" | "LOWER" | "UPPER" {
  return beneathCourse(figure) ? "BENEATH" : lowerPurple(figure, norm, numbersOnTop) ? "LOWER" : "UPPER";
}

/**
 * Profilen för "Skapa PDF för kontorsskrivare": bevarar hela tävlingsprofilen (banfärg, BL-beslut, egna färgjusteringar,
 * norm, lagerordning och `reference`) men rensar tryckerikrav (`requirements`) och gamla regelblockeringar (`rules`).
 * När `options?.lighten === true` läggs den skärpta kontorsljusningen för gröna/gula ytor till som fallback efter egna rader.
 */
export function officePrintProfile(from: PrintProfile, options?: { readonly lighten?: boolean | undefined }): PrintProfile {
  const base: PrintProfile = {
    ...from,
    rules: [],
    requirements: { pdfX: false, icc: false, trueOverprint: false }
  };
  if (options?.lighten !== true) return base;
  const office = BUILT_IN_PRINT_PROFILES.find(item => item.id === "office")!;
  const existingPatterns = new Set(from.mapColors.map(item => item.match.namePattern).filter((pattern): pattern is string => pattern !== undefined));
  const fallback = office.mapColors.filter(item => item.match.namePattern === undefined || !existingPatterns.has(item.match.namePattern));
  return fallback.length === 0 ? base : { ...base, mapColors: [...from.mapColors, ...fallback] };
}
