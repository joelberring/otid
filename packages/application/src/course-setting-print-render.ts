import type { PrintJobRequest } from "@o-tid/contracts";
import {
  BUILT_IN_PRINT_PROFILES, BUILT_IN_TEMPLATES, colorPreflight, layoutCoursePage, layoutTemplateSheets, sheetOfPage, sourceMapColors, validateLayoutTemplate,
  validatePrintProfile, type CourseSettingDocument, type LayoutTemplate, type MapRect, type PrintProfile, type Sheet, type SheetItem
} from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { PDF_CAPABILITIES, writeSheetsPdf, type FontFiles, type WritePdfResult } from "@o-tid/print-pdf";

/**
 * Steg 65 (ADR-0184): ett utskriftsjobb blir en PDF. Ren beräkning utan databas: arken läggs ut som i förhandsvisningen
 * (`layoutCoursePage` eller `layoutTemplateSheets`, en löpare per ark med baksida), förhandskontrollen görs mot kartans
 * färger och PDF:en skrivs med `@o-tid/print-pdf`. Körs bara i utskriftsarbetaren (låg prioritet), aldrig i webben.
 */
export class PrintJobError extends Error {}

/** Profilen för jobbet: en osparad i förfrågan, annars en sparad i dokumentet eller en färdig. */
export function printProfileFor(document: CourseSettingDocument, request: Pick<PrintJobRequest, "profileId" | "profile" | "kind">): PrintProfile {
  if (request.profile !== undefined) return validatePrintProfile(request.profile);
  const id = request.kind === "OFFICE" && request.profileId === "" ? "office" : request.profileId;
  const found = [...BUILT_IN_PRINT_PROFILES, ...(document.event.printProfiles ?? [])].find(item => item.id === id);
  if (!found) throw new PrintJobError(`Utskriftsprofilen ${id} finns inte`);
  return found;
}

/** Mallen för jobbet: färdig eller sparad (id) eller hela mallen (osparad i förhandsvisningen). */
export function layoutTemplateFor(document: CourseSettingDocument, template: unknown): LayoutTemplate {
  if (typeof template === "string") {
    const found = [...BUILT_IN_TEMPLATES, ...(document.event.layoutTemplates ?? [])].find(item => item.id === template);
    if (!found) throw new PrintJobError(`Layoutmallen ${template} finns inte`);
    return found;
  }
  return validateLayoutTemplate(template);
}

/** Arken i samma ordning som förhandsvisningen. */
export function printJobSheets(document: CourseSettingDocument, request: PrintJobRequest, mapBounds: MapRect | undefined): Sheet[] {
  const items = request.items as readonly SheetItem[];
  const options = { mapBounds, ...(request.date ? { date: request.date } : {}) };
  if (request.layout.kind === "TEMPLATE") {
    const template = layoutTemplateFor(document, request.layout.template);
    if (request.perRunner) return items.flatMap(item => layoutTemplateSheets(document, template, [item], { ...options, duplexBacks: request.duplex }));
    return layoutTemplateSheets(document, template, items, { ...options, mode: request.layout.fill });
  }
  const header = request.layout.header;
  return items.flatMap(item => layoutCoursePage(document, { course: item.course, ...(item.variant ? { variant: item.variant } : {}),
    ...(item.printScale ? { printScale: item.printScale } : {}), ...(item.printArea ? { printArea: item.printArea } : {}), mapBounds, header }).map(sheetOfPage));
}

export interface RenderPrintJobInput {
  readonly document: CourseSettingDocument;
  readonly request: PrintJobRequest;
  readonly map: { readonly bytes: Uint8Array; readonly fileName: string; readonly bounds: MapRect } | null;
  readonly fonts: FontFiles;
  readonly maxPages: number;
  readonly title: string;
  readonly now?: Date | undefined;
}

export async function renderPrintJob(input: RenderPrintJobInput): Promise<WritePdfResult & { preflight: string[] }> {
  const { document, request } = input;
  const profile = printProfileFor(document, request);
  const map = input.map ? readMapFile(input.map.bytes, input.map.fileName) : null;
  // Förhandskontrollen igen i servern, mot kartans färger och PDF:ens förmåga (ColorPreflight).
  const preflight: string[] = [];
  if (map) {
    const report = colorPreflight(profile, sourceMapColors(map.colors), PDF_CAPABILITIES, new Set(request.confirmedRules ?? []));
    const blocking = report.findings.filter(finding => finding.severity === "BLOCKING");
    if (blocking.length > 0) throw new PrintJobError(`Förhandskontrollen stoppar: ${blocking.map(finding => finding.text).join(" ")}`);
    const warnings = report.findings.filter(finding => finding.severity === "WARNING");
    if (warnings.length > 0 && !request.warningsConfirmed) throw new PrintJobError("Förhandskontrollens varningar är inte bekräftade.");
    preflight.push(...warnings.map(finding => `Förhandskontroll: ${finding.text}`));
  }
  const sheets = printJobSheets(document, request, input.map?.bounds ?? map?.bounds ?? undefined);
  if (sheets.length === 0) throw new PrintJobError("Inget att skriva ut.");
  if (sheets.length > input.maxPages) throw new PrintJobError(`PDF:en skulle få ${sheets.length} sidor; högst ${input.maxPages} går i ett jobb.`);
  const result = await writeSheetsPdf({ sheets, map, profile, mode: request.kind, fonts: input.fonts,
    descriptionStandard: document.event.descriptionStandard, title: input.title, now: input.now });
  return { ...result, preflight };
}
