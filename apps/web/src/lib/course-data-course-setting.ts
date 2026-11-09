import { courseDataDocument, CourseSettingEditError, keepPaperOnImport, type CourseSettingDocument } from "@o-tid/course-setting";
import { decodeIofXml, IofValidationError, readCourseLayout } from "@o-tid/iof-xml";
import { wgs84ToMapPoint, type MapGeoreference } from "@o-tid/map-file";
import { courseDataSv } from "../i18n/course-data-sv";
import type { Texts } from "./language";

export type CourseDataConversion =
  /** `stays`: beskedet står kvar tills det stängs (varianter som blev egna banor). */
  | { readonly kind: "ok"; readonly document: CourseSettingDocument; readonly notices: readonly string[]; readonly stays: boolean }
  | { readonly kind: "problem"; readonly text: string };

/**
 * En banfil (IOF XML 3.0 eller 2.0.3 CourseData) som banläggningsdokument på tävlingens kartfil: Använd igen ur
 * klubbarkivet och Banor → Banfil när det inte finns någon .ppen. Kartfilens skala gäller; georeferensen räknar om
 * kontroller som bara har WGS 84 i filen.
 */
export function courseSettingFromCourseData(bytes: Uint8Array, options: { readonly title?: string | undefined; readonly mapScale: number;
  readonly georeference?: MapGeoreference | null | undefined }, text: Texts<typeof courseDataSv> = courseDataSv): CourseDataConversion {
  const decoded = decodeIofXml(bytes);
  if ("issue" in decoded) return { kind: "problem", text: `${text.problems.invalid} ${decoded.issue}` };
  try {
    const georeference = options.georeference ?? undefined;
    const { document, notices } = courseDataDocument(readCourseLayout(decoded.xml), { title: options.title, mapScale: options.mapScale,
      fromWgs84: georeference ? position => {
        try { return wgs84ToMapPoint(georeference, position); } catch { return undefined; }
      } : undefined });
    return { kind: "ok", document, notices: [text.fromCourseData(document.courses.length, Object.keys(document.controls).length),
      ...notices.map(notice => notice.text)], stays: notices.some(notice => notice.code === "FORKS_AS_COURSES") };
  } catch (error) {
    if (error instanceof IofValidationError) return { kind: "problem", text: text.problems.invalid };
    if (error instanceof CourseSettingEditError) return { kind: "problem", text: text.problems.notPlaced(error.message) };
    throw error;
  }
}

/**
 * Det som tar över en banläggning behåller tävlingens utskriftsprofiler, layoutmallar, papperets mallar, ringklipp och
 * träning (de står inte i banfilen), som när en .ppen läses in i editorn.
 */
export function keepEventSettings(next: CourseSettingDocument, current: CourseSettingDocument | undefined): CourseSettingDocument {
  if (!current) return next;
  const event = current.event;
  // ADR-0197: papperets mallar och värden följer med, liksom papperet för banor som finns kvar (samma som en .ppen i editorn).
  const papered = keepPaperOnImport(current, next);
  return { ...papered, event: { ...papered.event,
    ...(event.printProfiles ? { printProfiles: event.printProfiles } : {}), ...(event.printProfileId ? { printProfileId: event.printProfileId } : {}),
    ...(event.layoutTemplates ? { layoutTemplates: event.layoutTemplates } : {}), ...(event.circleCutting ? { circleCutting: event.circleCutting } : {}) },
  ...(current.training ? { training: current.training } : {}) };
}

export { rememberCourseSettingNotice } from "./course-setting-notice";
