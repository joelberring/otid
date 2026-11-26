export * from "./model";
export * from "./render";
export { readMapFile } from "./read";
export { decimalYear, magneticDeclination, type Declination } from "./wmm";
export { declinationAt, mapNorthFacts, northLineDegrees, type MapNorthFacts } from "./declination";
export { northLineSegments, northLineSpacing } from "./north-lines";
export { MAP_READER_VERSION } from "./version";
export {
  crsFromEpsg, geodeticToGrid, gridToGeodetic, isSupportedEpsg, mapPointToProjected, mapPointToWgs84, projectedToMapPoint,
  projectedToWgs84, transverseMercatorFor, wgs84ToMapPoint, wgs84ToProjected
} from "./georef";
export type { ProjectedPoint, TransverseMercator, Wgs84Point } from "./georef";
export { maxOf, minOf, ocdSymbolCode, parseSymbolCode } from "./geometry";
export { distance, distanceToSegment, nearestOnSegment, polylineLength } from "./plane";
export { colorUsage, usageSymbolsText } from "./usage";
export type { ColorUsage, ColorUseKind } from "./usage";
export { rgbFromCmyk } from "./color";
export * from "./revision/change-set";
export { applyMapRevision } from "./revision/apply";
export { ocdChangesFile } from "./ocd/writer";
export { applyMapColors, effectiveColorChanges, withColorChanges, type MapColorChange, type MapColorsResult } from "./revision/colors";
export { applyMapSymbolColors, effectiveSymbolColorChanges, symbolColorIds, withSymbolColorChanges, type MapSymbolColorChange } from "./revision/symbol-colors";
export { sha256Hex } from "./revision/sha256";
export { applyMapRevisionWithSymbols, applyMapSymbolReplacements, planColors, withSymbolReplacements, type SymbolReplacement } from "./revision/symbol-replace";
export type { ColorDef, SymbolDef } from "./template/symbol-def";
export {
  applyMapRevisionWithTextSymbols, applyMapTextSymbols, effectiveTextSymbolChanges, nextTextSymbolCode, nextTextSymbolId, withTextSymbolChanges,
  type MapTextSymbolChange, type TextAlign
} from "./revision/text-symbols";
export { newMapFile, NewMapError, SYMBOL_SETS } from "./template/new-map";
export { MARKING_CODES, MARKING_LOGO_SIZE, MARKING_TEXT_SIZE, MARKING_TITLE_SIZE } from "./template/isom-2017-2";
export type { NewMapOptions, SymbolSetId } from "./template/new-map";
