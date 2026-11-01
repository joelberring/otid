/**
 * Banläggningen (steg 62, ADR-0180). Funktionerna nedan är kontraktet mellan paketet och webben; logiken finns i
 * `src/*.ts`. Allt är ren TypeScript utan I/O och går i Web Worker och Node.
 */
import { checkCourseSetting } from "./check";
import { applyDocumentEdit } from "./edit";
import { createEmptyDocument } from "./empty";
import { layout } from "./overprint";
import { readPpenDocument } from "./ppen-read";
import { writePpenDocument } from "./ppen-write";
import { controlOrder, courseVariantList, nextUnusedCode, summaries } from "./summary";
import type {
  CheckOptions, CourseCheck, CourseSettingDocument, CourseSettingEdit, CourseSummary, CourseVariant, EditResult,
  DescriptionStandard, OverprintOptions, OverprintPrimitive, PpenReadWarning
} from "./types";
import type { DescriptionLanguage, DescriptionLayout, DescriptionLayoutOptions, DescriptionSymbol } from "./description-types";

export * from "./types";
export * from "./description-types";
export { CONTROL_DISTANCE_LIMITS } from "./check";
export { OVERPRINT_SIZES } from "./appearance";
export { INVERTIBLE_CODES } from "./summary";

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
/** Alla varianter av en bana, med koder som Purple Pen. */
export function courseVariants(document: CourseSettingDocument, course: string): readonly CourseVariant[] { return courseVariantList(document, course); }
/** Längd, antal kontroller och varianter per bana (längden i meter med kartans skala). */
export function courseSummaries(document: CourseSettingDocument): readonly CourseSummary[] { return summaries(document); }
/** Kontrollerna som banläggaren bör titta på. Gränserna för nära kontroller kan ändras med `options`. */
export function checkDocument(document: CourseSettingDocument, options?: CheckOptions): readonly CourseCheck[] { return checkCourseSetting(document, options); }
/** Banpåtrycket som figurer i kartans mm (skärm nu, PDF i steg 65). */
export function layoutOverprint(document: CourseSettingDocument, options: OverprintOptions): readonly OverprintPrimitive[] { return layout(document, options); }
/** Nästa lediga kodsiffra enligt numreringen. */
export function nextFreeCode(document: CourseSettingDocument): string { return nextUnusedCode(document); }

// Steg 63: kontrollbeskrivningar. Stubbar tills steget är byggt.
const notYet = (name: string): never => { throw new Error(`${name} är inte byggd än (steg 63)`); };
/* eslint-disable @typescript-eslint/no-unused-vars -- stubbar tills steg 63 är byggt */
/** Alla symboler för en standard (för väljaren och ritningen). */
export function descriptionSymbols(_standard: DescriptionStandard): readonly DescriptionSymbol[] { return notYet("descriptionSymbols"); }
/** Symbolerna som får stå i en ruta ("C"–"H"), i Purple Pens ordning. */
export function symbolsForBox(_box: string, _standard: DescriptionStandard): readonly DescriptionSymbol[] { return notYet("symbolsForBox"); }
/** Kontrollbeskrivningen för en bana som figurer i mm (y nedåt): huvud, rader per kontroll, textrader, mål. */
export function layoutDescription(_document: CourseSettingDocument, _options: DescriptionLayoutOptions): DescriptionLayout { return notYet("layoutDescription"); }
/** Kontrollens beskrivning som text ("Sydöstra stenen, 1 m hög") på valt språk, som Purple Pens textbeskrivning. */
export function describeControl(_document: CourseSettingDocument, _control: string, _language: DescriptionLanguage): string { return notYet("describeControl"); }
/* eslint-enable @typescript-eslint/no-unused-vars */
