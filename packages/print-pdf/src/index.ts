/**
 * `@o-tid/print-pdf` (steg 65, ADR-0184): arken ur steg 64 som PDF för tryckeriet med kartan som vektorer, kartans och
 * banans dekorfärger (`/Separation`, `/DeviceN`) och äkta övertryck (/OP /op /OPM 1), eller för kontorsskrivaren i CMYK.
 * Ren TypeScript utan I/O: anroparen ger kartfilen, typsnitten och arken.
 */
export { colorsOverCourse, inCourseLayer, writeSheetsPdf, PDF_CAPABILITIES, PDF_MAX_PATTERN_INSTANCES, PT_PER_MM, type WritePdfInput, type WritePdfResult } from "./write-pdf";
export { FONT_FILE_NAMES, FONT_VARIANTS, type FontFiles, type FontVariant } from "./fonts";
export { plateName, type Ink, type Paint, type PdfMode } from "./paint";
