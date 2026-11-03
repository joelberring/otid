/**
 * Positioner i OCAD:s binärformat. Konstanterna nedan gäller version 12 och senare (OCAD 12, 2018, 2019 …); äldre
 * versioner beskrivs av `OcdVariant`. Egen sammanställning ur OCAD:s formatbeskrivningar och kontrollerad mot ägarens
 * filer (Djurgården 2025, OCAD 2018.8, och klubbarkivets OCAD 8–11). Alla tal är little-endian.
 */

export const OCD_MARK = 0x0cad;
export const MIN_VERSION = 8;

export const HEADER = {
  mark: 0, fileType: 2, version: 4, subversion: 6, subsubversion: 7,
  firstSymbolBlock: 8, firstObjectBlock: 12, firstStringBlock: 32, size: 48
} as const;

export const SYMBOL_BLOCK_SIZE = 4 + 256 * 4;
export const OBJECT_BLOCK_SIZE = 4 + 256 * 40;

/** Objektindexets post (40 byte). */
export const INDEX_ENTRY = { size: 40, position: 16, length: 20, symbol: 24, type: 28, status: 30 } as const;
/** Objektets status i indexet. Bara 1 (normal) räknas; 2 är dolt och 0/3 borttaget. */
export const STATUS_NORMAL = 1;

/** Symbolens gemensamma början (796 byte). */
export const SYMBOL = {
  size: 0, number: 4, type: 8, flags: 9, status: 11, description: 56, descriptionBytes: 128, end: 796
} as const;

export const SYMBOL_TYPE = { point: 1, line: 2, area: 3, text: 4, lineText: 6, rectangle: 7 } as const;

/** Punktsymbol: datastorlek i enheter om 8 byte, följd av element. */
export const POINT = { dataSize: 796, elements: 800 } as const;

/** Element i punkt-, linje- och ytsymboler: 16 byte huvud följt av koordinater om 8 byte. */
export const ELEMENT = { type: 0, color: 4, lineWidth: 6, diameter: 8, coordCount: 10, header: 16 } as const;
export const ELEMENT_TYPE = { line: 1, area: 2, circle: 3, dot: 4 } as const;

export const LINE = {
  color: 796, width: 798, style: 800, mainLength: 806, endLength: 808, mainGap: 810, secondaryGap: 812,
  minimumSymbols: 816, symbolCount: 818, symbolDistance: 820,
  doubleMode: 822, doubleFlags: 824, doubleColor: 826, doubleLeftColor: 828, doubleRightColor: 830,
  doubleWidth: 832, doubleLeftWidth: 834, doubleRightWidth: 836,
  framingColor: 854, framingWidth: 856,
  primaryDataSize: 860, secondaryDataSize: 862, cornerDataSize: 864, startDataSize: 866, endDataSize: 868,
  useSymbolFlags: 870, elements: 872
} as const;

/** Vilka av linjesymbolens punktsymboler som används (primärsymbolen används alltid när den finns). */
export const LINE_SYMBOL_FLAG = { end: 1, start: 2, corner: 4, secondary: 8 } as const;

export const AREA = {
  borderSymbol: 796, fillColor: 800, hatchMode: 802, hatchColor: 804, hatchWidth: 806, hatchDistance: 808,
  hatchAngle1: 810, hatchAngle2: 812, fillOn: 814, borderOn: 815, structureMode: 816,
  structureWidth: 818, structureHeight: 820, structureAngle: 822, dataSize: 830, elements: 832
} as const;

export const TEXT = { fontName: 796, fontNameCapacity: 31, color: 828, fontSize: 830, fontWeight: 832, italic: 834 } as const;

export const RECTANGLE = { color: 796, width: 798 } as const;

/** Objekt (version 12): huvud på 56 byte, koordinater och sedan text i UTF-16. */
export const OBJECT = { symbol: 0, type: 4, angle: 6, color: 8, lineWidth: 12, coordCount: 44, textCount: 48, coords: 56 } as const;
export const OBJECT_TYPE = { point: 1, line: 2, area: 3, text: 4, formattedText: 5, lineText: 6, rectangle: 7 } as const;

/**
 * Flaggor i koordinaternas låga byte. x: 1 och 2 är kurvans första och andra styrpunkt, 4 = ingen vänster och 8 = ingen
 * huvudlinje fram till nästa punkt. y: 1 = hörnpunkt, 2 börjar ett hål, 4 = ingen höger linje, 8 = streckpunkt.
 */
export const COORD_FLAG = {
  firstControl: 1, secondControl: 2, leftGap: 4, mainGap: 8, corner: 1, holeStart: 2, rightGap: 4, dash: 8
} as const;

/** 0,01 mm → mm. */
export const UNIT = 1 / 100;

/**
 * Skillnaderna mellan versionerna (ADR-0196). Symbolernas typdelar (linje, yta, punkt, text, rektangel) har samma
 * inbördes ordning i version 8–2020; bara den gemensamma början är olika lång. Fälten i `LINE`, `AREA` … räknas därför från
 * 796 och flyttas med `symbolBody - 796`.
 *
 * - Version 8: 348 byte symbolhuvud (storlek, nummer och typ som 16-bitarstal, beskrivningen som Pascalsträng), färgerna i
 *   ett eget huvud efter filhuvudet, skalan och georeferensen i inställningsposten, objektindex om 24 byte och objekthuvud
 *   om 32 byte. Symbolnumret är tio gånger ISOM-numret plus undernumret (1012 = 101.2).
 * - Version 9 och 10: 572 byte symbolhuvud (beskrivningen som Pascalsträng), objekthuvud om 40 byte.
 * - Version 11: 796 byte symbolhuvud (beskrivningen i UTF-16) som version 12, objekthuvud om 40 byte.
 * - Version 9–11: ytsymbolens ritdata börjar 4 byte tidigare än i version 12. Strängarna är ofta Windows-1252.
 */
export interface OcdVariant {
  readonly version: number;
  /** Var symbolens typdel börjar. */
  readonly symbolBody: number;
  /** Symbolhuvudets form: v8 (16-bitars fält) eller v9+ (32-bitars storlek och nummer). */
  readonly symbolHeader: "V8" | "V9";
  /** Beskrivningen: Pascalsträng (v8 vid 52, v9–10 vid 56) eller UTF-16 (v11+ vid 56). */
  readonly description: { readonly at: number; readonly kind: "PASCAL" | "UTF16" };
  /** Ytsymbolens datastorlek och ritdata, i samma räkning som `AREA` (från 796). */
  readonly areaData: { readonly dataSize: number; readonly elements: number };
  /** Ytsymbolens fält före mönstret i v8: AreaFlags, FillOn (16 bit), FillColor, sedan raster. Saknar kantlinje. */
  readonly areaV8: boolean;
  /** Linjesymbolens flaggor för sekundär-, hörn-, start- och slutsymbol finns (v11+). Annars används de som har data. */
  readonly lineSymbolFlags: boolean;
  readonly index: {
    readonly blockSize: number; readonly entrySize: number; readonly position: number;
    /** Längden i byte (v9+) eller i koordinater (v8, 16 bit). */
    readonly length: number; readonly lengthInCoords: boolean; readonly symbol: number; readonly symbol16: boolean;
    /** Status (1 = normal) finns inte i v8; där är ett borttaget objekt symbol 0. */
    readonly status: number | null;
  };
  readonly object: {
    readonly symbol16: boolean; readonly type: number; readonly angle: number;
    readonly coordCount: number; readonly coordCount16: boolean; readonly textCount: number; readonly coords: number;
    /** v8: byte som säger om texten är UTF-16 (1) eller Windows-1252 (0). */
    readonly unicodeFlag: number | null;
  };
}

const INDEX_V9 = {
  blockSize: OBJECT_BLOCK_SIZE, entrySize: 40, position: 16, length: 20, lengthInCoords: false, symbol: 24, symbol16: false, status: 30
} as const;
const OBJECT_V9 = { symbol16: false, type: 4, angle: 6, coordCount: 8, coordCount16: false, textCount: 12, coords: 40, unicodeFlag: null } as const;

export const VARIANT_V12: OcdVariant = {
  version: 12, symbolBody: 796, symbolHeader: "V9", description: { at: 56, kind: "UTF16" },
  areaData: { dataSize: 830, elements: 832 }, areaV8: false, lineSymbolFlags: true,
  index: INDEX_V9,
  object: { symbol16: false, type: 4, angle: 6, coordCount: 44, coordCount16: false, textCount: 48, coords: 56, unicodeFlag: null }
};

export const VARIANT_V11: OcdVariant = {
  ...VARIANT_V12, version: 11, areaData: { dataSize: 826, elements: 828 }, object: OBJECT_V9
};

export const VARIANT_V9: OcdVariant = {
  ...VARIANT_V11, version: 9, symbolBody: 572, description: { at: 56, kind: "PASCAL" }, lineSymbolFlags: false
};

export const VARIANT_V8: OcdVariant = {
  version: 8, symbolBody: 348, symbolHeader: "V8", description: { at: 52, kind: "PASCAL" },
  areaData: { dataSize: 826, elements: 828 }, areaV8: true, lineSymbolFlags: false,
  index: { blockSize: 4 + 256 * 24, entrySize: 24, position: 16, length: 20, lengthInCoords: true, symbol: 22, symbol16: true, status: null },
  object: { symbol16: true, type: 2, angle: 8, coordCount: 4, coordCount16: true, textCount: 6, coords: 32, unicodeFlag: 3 }
};

export function variantFor(version: number): OcdVariant | null {
  if (version >= 12) return VARIANT_V12;
  if (version === 11) return VARIANT_V11;
  if (version === 9 || version === 10) return { ...VARIANT_V9, version };
  if (version === 8) return VARIANT_V8;
  return null;
}

/** Version 8: färgtabellen efter filhuvudet och inställningsposten (skala och georeferens). */
export const V8 = {
  colorCount: 48, separationCount: 50, colors: 72, colorSize: 72, maxColors: 256, separations: 72 + 256 * 72, separationSize: 24,
  maxSeparations: 32, setupPosition: 16, setupSize: 20,
  setup: { scale: 24, realWorldX: 32, realWorldY: 40, realWorldAngle: 48 }
} as const;
