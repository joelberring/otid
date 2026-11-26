/**
 * Etapp 4A (OCAD Steg 2): Publikt typat API för den förlustfria `OcdDocument`-serialiseraren.
 */
export {
  decodeOcdString,
  encodeOcdString,
  encodeWindows1252,
  HEADER_EXTRA,
  HEADER_V12_SIZE,
  HEADER_V9_SIZE,
  OBJ_INDEX,
  OBJ_STATUS,
  parseOcdDocument,
  STRING_BLOCK_SIZE,
  SYMBOL_HEAD,
  type OcdDocument,
  type ParseOcdDocumentOptions,
  type RawOcdObject,
  type RawOcdString,
  type RawOcdSymbol
} from "./ocd-document";

export {
  packOcdDocument,
  verifyOcdDocument,
  type OcdDocumentVerifyResult,
  type PackOcdResult,
  type VerifyOcdDocumentExpectations
} from "./ocd-pack";

export {
  applyOcdColorChanges,
  applyOcdColors,
  collectDocumentUsedColorIds,
  documentColors,
  STRING_TYPE,
  updateOcdScalePar,
  type OcdColorAdd,
  type OcdColorApplyStats,
  type OcdColorDelete,
  type OcdColorEdit,
  type OcdColorMove,
  type OcdColorUpdate
} from "./ocd-colors-write";

export {
  computeSymbolExtentUnits,
  ICON_BG,
  ICON_SIZE,
  iconBitsOffset,
  ocdIconColorIndex,
  renderOcdSymbolIcon,
  writeSymbolDescription,
  writeSymbolHeaderColors
} from "./ocd-icon";

export {
  allocateHelperBorderNumber,
  allocateOcdSymbolNumber,
  encodeOcdElements,
  encodeOcdSymbol,
  ocdNumberMatchesCode,
  parseOcdSymbolNumber,
  symbolDefToMapSymbol,
  writeTextBodyFields,
  type EncodeOcdSymbolOptions
} from "./ocd-symbols-encode";

export {
  applyOcdNormSymbols,
  applyOcdSymbolColorChanges,
  applyOcdSymbolColors,
  applyOcdSymbolReplacementChanges,
  applyOcdTextSymbolChanges,
  applyOcdTextSymbols,
  type OcdSymbolMutationStats
} from "./ocd-symbols-write";

export {
  applyOcdFullRevision,
  applyOcdRevisionToDocument,
  type ApplyDocRevisionResult,
  type ExpectedDocObject,
  type OcdFullRevisionOptions
} from "./ocd-objects-write";

export {
  ocdChangesFile,
  type OcdChangesExportOptions,
  type OcdChangesExportResult
} from "./ocd-changes-export";
