/**
 * Steg 59 (ADR-0179): gemensam modell för en orienteringskarta som lästs ur OCAD (.ocd) eller OpenOrienteering Mapper
 * (.omap/.xmap). Modellen finns bara i minnet för att visa och räkna; originalfilen sparas orörd och skrivs aldrig om.
 *
 * Koordinater är kartans millimeter med y uppåt, samma som IOF `MapPosition` och OCAD. Mapper lagrar 0,001 mm med y
 * nedåt och räknas om vid läsningen.
 */
import type { ObjectSource } from "./revision/change-set";

export type MapFileFormat = "OCD" | "OMAP";

/** Färg i kartans ritordning. `rank` 0 ligger överst (ritas sist), som OCAD:s färgtabell och Mappers prioritet. */
export interface MapColor {
  readonly id: number;
  readonly name: string;
  readonly rank: number;
  /** CMYK 0–1. */
  readonly cmyk: { readonly c: number; readonly m: number; readonly y: number; readonly k: number };
  /** RGB 0–1 för skärmen. */
  readonly rgb: { readonly r: number; readonly g: number; readonly b: number };
  /** 0–1. */
  readonly opacity: number;
  /**
   * Färgen är (eller bygger på) en dekorfärg. Används inte för skärm. Steg 65: `separations` är dekorfärgerna som färgen
   * består av med andel (0–1, även 0 %: färgen slår då ut den plåten) och dekorfärgens egen CMYK ur filen (OCAD:s
   * dekorfärgstabell, Mappers dekorfärg), som PDF:en skriver som `/Separation` eller `/DeviceN` med CMYK-alternativ.
   * `overprint` är filens övertryck (OCAD "o1", Mapper utan knockout).
   */
  readonly spot?: { readonly name: string; readonly overprint: boolean; readonly separations?: readonly SpotSeparation[] | undefined } | undefined;
}

/** En dekorfärg i en kartfärg: namnet, andelen 0–1 och dekorfärgens CMYK (0–1) när filen anger den. */
export interface SpotSeparation {
  readonly name: string;
  readonly factor: number;
  readonly cmyk?: { readonly c: number; readonly m: number; readonly y: number; readonly k: number } | undefined;
}

/** Symbolnummer som i filen, t.ex. "406", "406.0", "105.100", och delat i huvud- och undernummer. */
export interface SymbolCode {
  readonly text: string;
  /** ISOM/ISSprOM-nummer (406, 520 …). */
  readonly main: number;
  /** Undernummer (0 för "406" och "406.0"). */
  readonly sub: number;
}

/** Ett streck: en linje som ritas längs objektets väg (huvudlinje, kantlinje, ram …). Mått i mm. */
export interface StrokeStyle {
  readonly color: number;
  readonly width: number;
  /** Förskjutning åt vänster (+) eller höger (−) från vägen, för dubbellinjer. */
  readonly offset?: number | undefined;
  readonly cap?: "butt" | "round" | "square" | undefined;
  readonly join?: "miter" | "round" | "bevel" | undefined;
  /** Streck och mellanrum i mm, upprepas. Saknas = heldragen. */
  readonly dash?: readonly number[] | undefined;
}

/** Del av en punktsymbol. Koordinaterna är relativa symbolens mittpunkt, i mm med y uppåt. */
export type PointElement =
  | { readonly kind: "circle"; readonly color: number; readonly center: Point; readonly diameter: number; readonly lineWidth: number }
  | { readonly kind: "dot"; readonly color: number; readonly center: Point; readonly diameter: number }
  | { readonly kind: "line"; readonly color: number; readonly width: number; readonly path: Path }
  | { readonly kind: "area"; readonly color: number; readonly rings: readonly Path[] };

export interface Point { readonly x: number; readonly y: number }

/**
 * Punktens och sträckans flaggor ur filen (sätts bara när de gäller):
 * - `corner`: hörnpunkt i OCAD eller streckpunkt i Mapper. Linjens hörnsymbol (t.ex. kraftledningens stolpe) ritas här
 *   och mönstret längs linjen börjar om.
 * - `dash`: OCAD:s streckpunkt. Mönstret börjar om men ingen hörnsymbol ritas.
 * - `gap`: sträckan fram till punkten ritas inte för huvudlinjen (`GAP.main`), vänster (`GAP.left`) eller höger
 *   (`GAP.right`) kantlinje, som OCAD:s luckor i en linje (t.ex. där vägkanter möts i en korsning). På en dels första
 *   punkt (M) gäller `gap` sträckan som stänger en yta (från sista punkten tillbaka till den första).
 */
interface PointFlags { readonly corner?: true; readonly dash?: true; readonly gap?: number }

export const GAP = { main: 1, left: 2, right: 4 } as const;

/** En väg: flyttning, raka linjer och kubiska bézierkurvor, i mm med y uppåt. */
export type PathCommand =
  | { readonly type: "M"; readonly x: number; readonly y: number } & PointFlags
  | { readonly type: "L"; readonly x: number; readonly y: number } & PointFlags
  | { readonly type: "C"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number } & PointFlags;
export type Path = readonly PathCommand[];

interface SymbolBase {
  readonly id: string;
  readonly code: SymbolCode;
  readonly name: string;
  /** Dold i filen (ritas inte, men finns för analys). */
  readonly hidden: boolean;
}

export interface PointSymbol extends SymbolBase { readonly kind: "POINT"; readonly elements: readonly PointElement[] }

/**
 * Punktsymbol som upprepas längs linjen (taggar på brant, prickar på mur, streck på staket). Mått i mm.
 *
 * Linjen delas i hörn- och streckpunkterna. På varje del ligger första och sista stället `endLength` från ändarna och
 * resten med avståndet `spacing`, justerat så att det går jämnt ut (som OCAD och Mapper). Utan `endLength` ligger första
 * stället ett halvt avstånd in. `count` symboler per ställe, `groupSpacing` isär (t.ex. två prickar på opasserbar mur).
 * `minimum` ställen läggs alltid på den längsta delen.
 */
export interface RepeatedSymbol {
  readonly elements: readonly PointElement[];
  readonly spacing: number;
  readonly endLength?: number | undefined;
  readonly count?: number | undefined;
  readonly groupSpacing?: number | undefined;
  readonly minimum?: number | undefined;
}

/** Punktsymbol i linjens hörn (OCAD:s hörnsymbol, Mappers strecksymbol), t.ex. kraftledningens stolpar. */
export interface CornerSymbol {
  readonly elements: readonly PointElement[];
  /** Symbolen sträcks på tvären i spetsiga hörn (högst 3 gånger), så att tvärstrecket når över båda linjerna. */
  readonly stretch: boolean;
  /** Ritas inte i linjens första och sista punkt. */
  readonly skipEnds?: boolean | undefined;
}

/**
 * Punktsymbolerna i en linjesymbol ritas med x-axeln i linjens riktning (y åt vänster). Hörnsymbolen ligger längs
 * bisektrisen.
 */
export interface LineSymbol extends SymbolBase {
  readonly kind: "LINE";
  readonly strokes: readonly StrokeStyle[];
  readonly repeated?: RepeatedSymbol | undefined;
  /** OCAD:s sekundärsymbol: mitt emellan ställena som `repeated` skulle få med samma mått (en symbol per mellanrum). */
  readonly between?: RepeatedSymbol | undefined;
  readonly corner?: CornerSymbol | undefined;
  /** Symbol i linjens början och slut (t.ex. brons vingar). */
  readonly start?: { readonly elements: readonly PointElement[] } | undefined;
  readonly end?: { readonly elements: readonly PointElement[] } | undefined;
}

/** Linjemönster (raster) i en yta. Mått i mm, vinkel i grader moturs från x-axeln. */
export interface HatchStyle { readonly color: number; readonly width: number; readonly spacing: number; readonly angle: number }

export interface AreaSymbol extends SymbolBase {
  readonly kind: "AREA";
  readonly fill?: number | undefined;
  readonly hatches: readonly HatchStyle[];
  /**
   * Punktmönster i rutnät (t.ex. stenig mark): elementen upprepas var `dx` mm längs raden och var `dy` mm mellan raderna.
   * Förskjutna rader ligger som extra element i samma ruta. `angle` är rutnätets vinkel i grader moturs (0 när den saknas).
   */
  readonly pattern?: { readonly elements: readonly PointElement[]; readonly dx: number; readonly dy: number; readonly angle?: number | undefined } | undefined;
  /** Kantlinje som ritas längs ytans ytterkant. */
  readonly border?: readonly StrokeStyle[] | undefined;
}

export interface TextSymbol extends SymbolBase {
  readonly kind: "TEXT";
  readonly color: number;
  /** Teckenhöjd i mm. */
  readonly size: number;
  readonly fontFamily: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** Mapper: en symbol som består av andra symboler (t.ex. yta med kantlinje). */
export interface CombinedSymbol extends SymbolBase { readonly kind: "COMBINED"; readonly parts: readonly string[] }

export type MapSymbol = PointSymbol | LineSymbol | AreaSymbol | TextSymbol | CombinedSymbol;

/**
 * ADR-0207: `source` säger var objektet ligger i grundfilen (indexpost och post i OCAD, del, ordningstal och textintervall
 * i Mapper) och objektets hash, så att en ändring kan skrivas tillbaka till just det objektet.
 */
export type MapObject = (
  | { readonly kind: "point"; readonly symbol: string; readonly at: Point; readonly angle: number }
  | { readonly kind: "line"; readonly symbol: string; readonly path: Path }
  /** Första ringen är ytterkanten, resten hål. */
  | { readonly kind: "area"; readonly symbol: string; readonly rings: readonly Path[]; readonly angle: number }
  | { readonly kind: "text"; readonly symbol: string; readonly at: Point; readonly angle: number; readonly text: string }
) & { readonly source?: ObjectSource | undefined };

/** Koordinatsystem som O-Tid kan räkna om till WGS 84 (Gauss–Krüger på GRS 80 resp. Bessel via direkta parametrar). */
export type MapCrs =
  | { readonly kind: "EPSG"; readonly code: number }
  | { readonly kind: "UNKNOWN"; readonly description: string };

/**
 * Kartans georeferens: kartans mm → projicerade meter. E = E0 + s·(x·cos g + y·sin g), N = N0 + s·(−x·sin g + y·cos g)
 * där (x, y) = mm − mapRefPoint, s = scale/1000 · combinedScaleFactor och g = grivationen (medurs, grader).
 */
export interface MapGeoreference {
  readonly scale: number;
  readonly crs: MapCrs;
  readonly refPoint: { readonly easting: number; readonly northing: number };
  readonly mapRefPoint: Point;
  readonly grivationDegrees: number;
  /** Mappers `auxiliary_scale_factor`; 1 när filen inte anger något. */
  readonly combinedScaleFactor: number;
}

export interface MapFileWarning {
  /** Maskinläsbar kod, t.ex. "UNKNOWN_OBJECT_TYPE". */
  readonly code: string;
  readonly count: number;
  /** Kort beskrivning på svenska för arrangören. */
  readonly text: string;
}

export interface ParsedMap {
  readonly format: MapFileFormat;
  /** T.ex. "OCAD 2018.8" eller "Mapper v9". */
  readonly version: string;
  readonly colors: readonly MapColor[];
  readonly symbols: ReadonlyMap<string, MapSymbol>;
  readonly objects: readonly MapObject[];
  /** Kartans skala även när georeferens saknas. */
  readonly scale: number;
  readonly georeference: MapGeoreference | null;
  /** Ytan som objekten täcker, i mm. */
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | null;
  readonly warnings: readonly MapFileWarning[];
}

/** Läsfel som gör filen oanvändbar (inte en orienteringskarta, för gammal version, trunkerad). */
export class MapFileError extends Error {
  constructor(readonly code: "NOT_A_MAP_FILE" | "UNSUPPORTED_VERSION" | "TRUNCATED" | "INVALID", message: string) {
    super(message);
    this.name = "MapFileError";
  }
}
