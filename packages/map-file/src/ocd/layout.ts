/**
 * Positioner i OCAD:s binärformat, version 12 och senare (OCAD 12, 2018, 2019 …). Egen sammanställning ur OCAD:s
 * formatbeskrivning och kontrollerad mot ägarens filer (Djurgården 2025, OCAD 2018.8). Alla tal är little-endian.
 */

export const OCD_MARK = 0x0cad;
export const MIN_VERSION = 12;

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
  symbolCount: 818, symbolDistance: 820,
  doubleMode: 822, doubleFlags: 824, doubleColor: 826, doubleLeftColor: 828, doubleRightColor: 830,
  doubleWidth: 832, doubleLeftWidth: 834, doubleRightWidth: 836,
  framingColor: 854, framingWidth: 856,
  primaryDataSize: 860, secondaryDataSize: 862, cornerDataSize: 864, startDataSize: 866, endDataSize: 868,
  elements: 872
} as const;

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

/** Flaggor i koordinaternas låga byte. x: 1 och 2 är kurvans första och andra styrpunkt. y: 2 börjar ett hål. */
export const COORD_FLAG = { firstControl: 1, secondControl: 2, holeStart: 2 } as const;

/** 0,01 mm → mm. */
export const UNIT = 1 / 100;
