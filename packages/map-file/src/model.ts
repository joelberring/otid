/**
 * Steg 59 (ADR-0179): gemensam modell för en orienteringskarta som lästs ur OCAD (.ocd) eller OpenOrienteering Mapper
 * (.omap/.xmap). Modellen finns bara i minnet för att visa och räkna; originalfilen sparas orörd och skrivs aldrig om.
 *
 * Koordinater är kartans millimeter med y uppåt, samma som IOF `MapPosition` och OCAD. Mapper lagrar 0,001 mm med y
 * nedåt och räknas om vid läsningen.
 */

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
  /** Färgen är (eller bygger på) en dekorfärg. Används inte för skärm, sparas för tryck (steg 4 i diskussionen). */
  readonly spot?: { readonly name: string; readonly overprint: boolean } | undefined;
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

/** En väg: flyttning, raka linjer och kubiska bézierkurvor, i mm med y uppåt. */
export type PathCommand =
  | { readonly type: "M"; readonly x: number; readonly y: number }
  | { readonly type: "L"; readonly x: number; readonly y: number }
  | { readonly type: "C"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number };
export type Path = readonly PathCommand[];

interface SymbolBase {
  readonly id: string;
  readonly code: SymbolCode;
  readonly name: string;
  /** Dold i filen (ritas inte, men finns för analys). */
  readonly hidden: boolean;
}

export interface PointSymbol extends SymbolBase { readonly kind: "POINT"; readonly elements: readonly PointElement[] }

export interface LineSymbol extends SymbolBase {
  readonly kind: "LINE";
  readonly strokes: readonly StrokeStyle[];
  /** Punktsymbol som upprepas längs linjen (t.ex. taggar på brant), med avstånd i mm. */
  readonly repeated?: { readonly elements: readonly PointElement[]; readonly spacing: number } | undefined;
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

export type MapObject =
  | { readonly kind: "point"; readonly symbol: string; readonly at: Point; readonly angle: number }
  | { readonly kind: "line"; readonly symbol: string; readonly path: Path }
  /** Första ringen är ytterkanten, resten hål. */
  | { readonly kind: "area"; readonly symbol: string; readonly rings: readonly Path[]; readonly angle: number }
  | { readonly kind: "text"; readonly symbol: string; readonly at: Point; readonly angle: number; readonly text: string };

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
