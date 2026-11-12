import { carryCourseLevels, carryExcludedVariants, keepAcceptedChecks, type CourseSettingDocument } from "@o-tid/course-setting";

/**
 * En inläst .ppen-fil ersätter dokumentet, men det som bara finns i O-Tid följer med (utbrutet ur `course-setting-editor.tsx`,
 * översynen 2026-11-10 G1): utskriftsprofiler och layoutmallar (steg 64, ADR-0183), ringklippen (ADR-0180 beslut 10), valet av rubrik på kartorna, de
 * godtagna varningarna där de fortfarande gäller (ADR-0199), vägvalens vägar nära kontrollerna (ägaren 2026-11-08), träningen
 * när filen saknar den (ADR-0192 beslut 10), bortvalda varianter (ADR-0198) och banornas nivåer.
 */
export function carryOnImport(current: CourseSettingDocument, incoming: CourseSettingDocument): CourseSettingDocument {
  const event = current.event;
  const accepted = keepAcceptedChecks(event.acceptedChecks, incoming);
  const carried: CourseSettingDocument = { ...incoming, event: { ...incoming.event,
    ...(event.printProfiles ? { printProfiles: event.printProfiles } : {}), ...(event.printProfileId ? { printProfileId: event.printProfileId } : {}),
    ...(event.layoutTemplates ? { layoutTemplates: event.layoutTemplates } : {}),
    ...(event.circleCutting ? { circleCutting: event.circleCutting } : {}),
    ...(event.routeHints ? { routeHints: event.routeHints } : {}),
    // Valet av rubrik på kartorna (filens titel i stället för tävlingens namn, användartestet 2026-11-12).
    ...(event.printFileTitle ? { printFileTitle: event.printFileTitle } : {}),
    ...(accepted ? { acceptedChecks: accepted } : {}) },
    ...(!incoming.training && current.training ? { training: current.training } : {}) };
  return carryCourseLevels(current, carryExcludedVariants(current, carried));
}
