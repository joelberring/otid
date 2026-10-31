/* eslint-disable @typescript-eslint/no-unused-vars -- stubbar tills steg 62 är byggt */
/**
 * Banläggningen (steg 62, ADR-0180). Funktionerna nedan är kontraktet mellan paketet och webben; de byggs i
 * `src/*.ts` och ersätter stubbarna.
 */
import { readPpenDocument } from "./ppen-read";
import { writePpenDocument } from "./ppen-write";
import { controlOrder, courseVariantList, nextUnusedCode, summaries } from "./summary";
import type {
  CourseCheck, CourseSettingDocument, CourseSettingEdit, CourseSummary, CourseVariant, EditResult, OverprintOptions,
  OverprintPrimitive, PpenReadWarning
} from "./types";

export * from "./types";

const notYet = (name: string): never => { throw new Error(`${name} är inte byggd än (steg 62)`); };

/** Läs en Purple Pen-fil (.ppen, XML). Kastar `CourseSettingEditError("INVALID")` om filen inte är en .ppen. */
export function readPpen(xml: string): { readonly document: CourseSettingDocument; readonly warnings: readonly PpenReadWarning[] } { return readPpenDocument(xml); }
/** Skriv dokumentet som .ppen. Det som lästes in och inte ändrats skrivs tillbaka likadant. */
export function writePpen(document: CourseSettingDocument): string { return writePpenDocument(document); }
/** Ett tomt dokument för en karta (ingen bana än). */
export function emptyDocument(_options: { readonly title: string; readonly mapScale: number; readonly sprint?: boolean }): CourseSettingDocument { return notYet("emptyDocument"); }
/** Gör en ändring. Kastar `CourseSettingEditError` när den inte går. */
export function applyEdit(_document: CourseSettingDocument, _edit: CourseSettingEdit): EditResult { return notYet("applyEdit"); }
/** Banans kontroller i ordning för en variant (eller alla grenar, i ordningen de ritas). */
export function courseControlOrder(document: CourseSettingDocument, course: string, variant?: string): readonly string[] { return controlOrder(document, course, variant); }
/** Alla varianter av en bana, med koder som Purple Pen. */
export function courseVariants(document: CourseSettingDocument, course: string): readonly CourseVariant[] { return courseVariantList(document, course); }
/** Längd, antal kontroller och varianter per bana (längden i meter med kartans skala). */
export function courseSummaries(document: CourseSettingDocument): readonly CourseSummary[] { return summaries(document); }
/** Kontrollerna som banläggaren bör titta på. */
export function checkDocument(_document: CourseSettingDocument): readonly CourseCheck[] { return notYet("checkDocument"); }
/** Banpåtrycket som figurer i kartans mm (skärm nu, PDF i steg 65). */
export function layoutOverprint(_document: CourseSettingDocument, _options: OverprintOptions): readonly OverprintPrimitive[] { return notYet("layoutOverprint"); }
/** Nästa lediga kodsiffra enligt numreringen. */
export function nextFreeCode(document: CourseSettingDocument): string { return nextUnusedCode(document); }
