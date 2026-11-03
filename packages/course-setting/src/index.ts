/**
 * Banläggningen (steg 62, ADR-0180). Funktionerna nedan är kontraktet mellan paketet och webben; logiken finns i
 * `src/*.ts`. Allt är ren TypeScript utan I/O och går i Web Worker och Node.
 */
import { checkCourseSetting } from "./check";
import { bakeDetailGapEdits, detailCircles } from "./circle-cutting";
import { computeDetailCircleGaps, type DetailCircle, type DetailGapOptions } from "./detail-gaps";
import { applyDocumentEdit } from "./edit";
import { createEmptyDocument } from "./empty";
import { layout } from "./overprint";
import { readPpenDocument } from "./ppen-read";
import { writePpenDocument } from "./ppen-write";
import { allCourseVariantList, controlOrder, courseVariantList, nextUnusedCode, summaries } from "./summary";
import type { ParsedMap } from "@o-tid/map-file";
import type {
  CheckOptions, CourseCheck, CourseSettingDocument, CourseSettingEdit, CourseSummary, CourseVariant, EditResult,
  DescriptionStandard, OverprintOptions, OverprintPrimitive, PpenReadWarning
} from "./types";
import type { DescriptionLanguage, DescriptionLayout, DescriptionLayoutOptions, DescriptionSymbol } from "./description-types";
import { layout as layoutDescriptionFigures } from "./description-layout";
import { symbolDb, symbolsInStandard, symbolsOfBox } from "./description-symbols";
import { descriptionContext, Textifier } from "./description-text";
import { CourseSettingEditError } from "./types";

export * from "./types";
export * from "./description-types";
export { CONTROL_DISTANCE_LIMITS } from "./check";
export { appearanceOf, ITEM_SCALINGS, OVERPRINT_SIZES, type Appearance, type ItemScaling } from "./appearance";
// Banans utseende och etiketten vid kontrollen (ADR-0180 beslut 12).
export {
  APPEARANCE_LIMITS, APPEARANCE_TOLERANCE, appearanceWarnings, paperSizesFor, printScalesInUse, standardPaperSizes, type AppearanceWarning,
  type PaperSizes
} from "./appearance-edit";
export { controlLabelText } from "./overprint";
export { excludedVariantCodes, INVERTIBLE_CODES, isExcludedVariant } from "./summary";
// ADR-0198: bortvalda varianter i .ppen och när en ny .ppen läses in.
export { carryExcludedVariants, VARIANTS_ELEMENT } from "./variants-ppen";
// Steg 66: flera som arbetar samtidigt (åtgärder som spelas upp på en nyare version, ångra med PUT_OBJECTS).
export {
  createdIdsBetween, diffTouches, documentChanges, editTouches, EMPTY_ID_MAP, NO_CREATED_IDS, objectPatch, remapEdit, replayEdits, touchedConflict,
  touchesOverlap, type CreatedIds, type IdMap, type ReplayedEdit, type ReplayOptions, type ReplayRejection, type ReplayResult
} from "./collaboration";
export { detailGapKey, OVERLAP_CUT_LIMITS } from "./circle-cutting";
export { circleArcs } from "./arcs";
export {
  DEFAULT_DETAIL_SYMBOLS, DETAIL_GAP_LIMITS, DETAIL_PRIORITY_WEIGHT, SPRINT_DETAIL_SYMBOLS, type DetailClass, type DetailPriority
} from "./detail-symbols";
export type { DetailCircle, DetailGapOptions } from "./detail-gaps";
// Steg 64: specialobjekt och utskriftslayout (ADR-0180 beslut 11).
export {
  DEFAULT_MARGINS, defaultPage, figureBounds, HEADER_MM, HUNDREDTH_INCH_MM, layoutCoursePage, PAPER_SIZES, printAreaOf, printRectangle,
  printVariants, toPage, type CoursePage, type CoursePageOptions, type PageText, type PaperName
} from "./page-layout";
export { approximateTextWidth, DIGIT_HEIGHT_EM, expandText, specialVisible, TEXT_LINE_EM } from "./specials";
export { SPECIAL_KIND_LIST, specialPointCount } from "./special-edit";
export { specialImage } from "./ppen-special";
export { printScaleOf } from "./overprint";
// Banläggningens UX (ADR-0180 beslut 14): kopia av bana, oanvända kontroller, grenarnas bokstäver och vinklar.
export { controlsOnlyIn, unusedControls } from "./course-duplicate";
export { legPath, variantLetters, variations, type Variation } from "./walk";
export { normalizeDegrees } from "./edit";
export { BARRIER_KINDS, routeBarriers, type RouteBarrierGeometry } from "./barriers";
// ADR-0180 beslut 13: förslag på kontrollbeskrivning ur kartfilen.
export {
  acceptSuggestion, lacksFeature, mapNorthDegrees, SUGGEST_LIMITS, suggestAt, suggestForDocument, suggestOptionsFor, type DescriptionSuggestion,
  type SuggestedFeature, type SuggestOptions
} from "./suggest";
export {
  FEATURE_KIND, featureRuleFor, ISOM_FEATURES, ISSPROM_FEATURES, NAME_FEATURES, type FeatureKind, type FeatureLookup, type FeatureRule
} from "./suggest-symbols";
// Steg 64 (ADR-0183): utskriftsprofil och layoutmall.
export * from "./print-profile";
export * from "./print-reference";
export * from "./color-match";
export * from "./layout-template";
// ADR-0190: banorna som IOF XML 3.0 CourseData (som Purple Pens export).
export { classNamesOfCourse, writeIofCourseData, type IofCourseDataOptions } from "./iof-export";
// Papperet per bana (ägaren 2026-11-03): kontrollbeskrivningen på kartan; senare fler element på arket.
export * from "./paper-layout";
export * from "./paper-items";
export { printSheetGroups, type SheetGroup, type SheetGroupOptions, type SheetLayout } from "./print-sheets";
// Poängbanans förval (kodens första siffra, som tävlingens rogaining).
export { defaultScorePoints, scorePoints } from "./course-properties";
// En banfil (IOF XML CourseData) utan .ppen som banläggningsdokument.
export {
  COURSE_DATA_LENGTH_TOLERANCE_METERS, courseDataDocument, type CourseDataDocumentOptions, type CourseDataLayout, type CourseDataLayoutKind,
  type CourseDataNotice
} from "./course-data-import";

/** Läs en Purple Pen-fil (.ppen, XML). Kastar `CourseSettingEditError("INVALID")` om filen inte är en .ppen. */
export function readPpen(xml: string): { readonly document: CourseSettingDocument; readonly warnings: readonly PpenReadWarning[] } { return readPpenDocument(xml); }
/** Skriv dokumentet som .ppen. Det som lästes in och inte ändrats skrivs tillbaka likadant. */
export function writePpen(document: CourseSettingDocument): string { return writePpenDocument(document); }
/** Ett tomt dokument för en karta (ingen bana än). Sprint ger ISSprOM 2019 och 15/30 m för nära kontroller. */
export function emptyDocument(options: { readonly title: string; readonly mapScale: number; readonly sprint?: boolean }): CourseSettingDocument { return createEmptyDocument(options); }
/** Gör en ändring. Kastar `CourseSettingEditError` när den inte går. */
export function applyEdit(document: CourseSettingDocument, edit: CourseSettingEdit): EditResult { return applyDocumentEdit(document, edit); }
/** Banans kontroller (banans kontroll-id) i ordning för en variant (eller alla grenar, i ordningen de ritas). */
export function courseControlOrder(document: CourseSettingDocument, course: string, variant?: string): readonly string[] { return controlOrder(document, course, variant); }
/** Varianterna som används av en bana, med koder som Purple Pen (ADR-0198: utan de bortvalda). */
export function courseVariants(document: CourseSettingDocument, course: string): readonly CourseVariant[] { return courseVariantList(document, course); }
/** Alla varianter av en bana, också de bortvalda (`excluded`). */
export function allCourseVariants(document: CourseSettingDocument, course: string): readonly CourseVariant[] { return allCourseVariantList(document, course); }
/** Längd, antal kontroller och varianter per bana (längden i meter med kartans skala). */
export function courseSummaries(document: CourseSettingDocument): readonly CourseSummary[] { return summaries(document); }
/** Kontrollerna som banläggaren bör titta på. Gränserna för nära kontroller kan ändras med `options`. */
export function checkDocument(document: CourseSettingDocument, options?: CheckOptions): readonly CourseCheck[] { return checkCourseSetting(document, options); }
/** Banpåtrycket som figurer i kartans mm (skärm nu, PDF i steg 65). */
export function layoutOverprint(document: CourseSettingDocument, options: OverprintOptions): readonly OverprintPrimitive[] { return layout(document, options); }

// Ringklipp (ADR-0180 beslut 10).
/** Ett ringavbrott i grader moturs från x-axeln. */
export type CircleArc = { readonly startDegrees: number; readonly endDegrees: number };
/**
 * Gapen där ringarna täcker viktiga detaljer i kartan (symboltabellen `DEFAULT_DETAIL_SYMBOLS`), per ringens id. Ges till
 * `layoutOverprint` som `detailGaps`. Kartan indexeras första gången och sparas per `ParsedMap`.
 */
export function detailCircleGaps(map: ParsedMap, centers: readonly DetailCircle[], options?: DetailGapOptions): Record<string, CircleArc[]> {
  return computeDetailCircleGaps(map, centers, options);
}
/**
 * Ringarna att räkna detaljgap för: kontroller och mål, en per ringstorlek i banornas och alla kontrollers skalor (id =
 * `detailGapKey(kontroll, radie)`), med sträckornas vinklar på alla banor.
 */
export function detailCircleCenters(document: CourseSettingDocument): DetailCircle[] { return detailCircles(document); }
/** Ändringarna (`SET_CIRCLE_GAPS`) som gör detaljgapen fasta i kontrollernas ringavbrott, så att de följer med till .ppen. */
export function bakeDetailGaps(document: CourseSettingDocument, detailGaps: Readonly<Record<string, readonly CircleArc[]>>): CourseSettingEdit[] {
  return bakeDetailGapEdits(document, detailGaps);
}
/** Nästa lediga kodsiffra enligt numreringen. */
export function nextFreeCode(document: CourseSettingDocument): string { return nextUnusedCode(document); }

// Steg 63: kontrollbeskrivningar (description-*.ts, ur Purple Pen).
/** Alla symboler med ritning i en standard (för väljaren och ritningen), i Purple Pens ordning. */
export function descriptionSymbols(standard: DescriptionStandard): readonly DescriptionSymbol[] { return symbolsInStandard(standard); }
/**
 * Symbolerna som får stå i en ruta ("C"–"H"), i Purple Pens ordning; E visar E och sedan D (två objekt). Slagen "V"–"Z"
 * ger riktningsradernas symboler (mål "Z", passage "X").
 */
export function symbolsForBox(box: string, standard: DescriptionStandard): readonly DescriptionSymbol[] { return symbolsOfBox(box, standard); }
/** Kontrollbeskrivningen för en bana som figurer i mm (y nedåt): huvud, rader per kontroll, textrader, mål. */
export function layoutDescription(document: CourseSettingDocument, options: DescriptionLayoutOptions): DescriptionLayout { return layoutDescriptionFigures(document, options); }
/** Kontrollens beskrivning som text ("SÖ stenen, 1m hög") på valt språk, som Purple Pens textbeskrivning. */
export function describeControl(document: CourseSettingDocument, control: string, language: DescriptionLanguage): string {
  const found = document.controls[control];
  if (!found) throw new CourseSettingEditError("NOT_FOUND", `Kontrollen ${control} finns inte`);
  return new Textifier(descriptionContext(document, language)).createTextForControl(found, "");
}
/** Språken som symbolerna har namn och texter på (id och namnet på språket självt). */
export const DESCRIPTION_LANGUAGES: readonly { readonly id: string; readonly name: string }[] =
  symbolDb().data.languages.map(language => ({ id: language.id, name: language.name }));
export { controlBounds, moveDocumentPoints } from "./move-points";
// Träningsläget (ADR-0192): avsnitt, symbolfilter, korridor, fönster, sista säkra, stjärna, linje, keps och kartbitar.
export * from "./training-types";
export {
  FILTER_PRESETS, FULL_FILTER, SYMBOL_GROUPS, filterShows, hiddenSymbolIds, isFullFilter, presetFilter, setSymbol, symbolCatalog, symbolGroup, symbolKey,
  toggleGroup, type SymbolCatalogEntry
} from "./training-symbols";
export {
  DEFAULT_TINT, EMPTY_TRAINING, areasFor, courseTrainingOf, drawTrainingMap, passesKey, trainingMapPasses, trainingOf
} from "./training-passes";
export {
  DEFAULT_BAND_METERS, chaikin, circlePolygon, controlSequences, metersToMm, sectionLegs, sectionRange, sectionRegion, unionRegion, type Region
} from "./training-regions";
export { TRAINING_LIMITS, cleanCourseTraining, cleanFilter } from "./training-edit";
export { TRAINING_ELEMENT, TRAINING_NAMESPACE } from "./training-ppen";
export { SECTION_MARKER_TEXT, dashedGaps, pairLabels, sectionMarkerText } from "./training-overprint";
export { DEFAULT_PIECES, expandTrainingItems, starSpokes, trainingPieceSheets } from "./training-print";
export { mirrorFigures, mirrorPoint } from "./training-mirror";
export { TRAINING_TAGS, trainingTags, type TrainingTag } from "./training-tags";
