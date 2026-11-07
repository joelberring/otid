import {
  printJobProblemSchema, printJobSchema, printJobsSchema, type PrintJob, type PrintJobKind, type PrintJobProblem, type PrintJobRequest, type PrintJobs
} from "@o-tid/contracts";
import {
  BUILT_IN_SHEET_LAYOUTS, colorPreflight, MAIN_LAYOUT, PDF_PRINT_CAPABILITIES, sourceMapColors, type SheetLayout, type PreflightReport, type PrintProfile, type SheetItem
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { courseSettingBase, HttpError } from "./course-setting-api";
import { adminFetch, fetchUntilReached, fetchWithRetry } from "./retrying-fetch";

/**
 * Steg 65 (ADR-0184): PDF för tryck från förhandsvisningen. Förfrågan beskriver samma ark som förhandsvisningen visar
 * (banor eller en karta per löpare, mallen, profilen); servern lägger den i kön och utskriftsarbetaren skriver PDF:en.
 */
export interface PrintJobSelection {
  readonly items: readonly SheetItem[];
  /** Mallen som visas (osparad som hela mallen, annars dess id), eller ingen = Purple Pens en bana per sida. */
  readonly template: SheetLayout | undefined;
  readonly templateIsDraft: boolean;
  readonly savedTemplateIds: readonly string[];
  readonly header: boolean;
  readonly fill: "FILL" | "REPEAT";
  readonly perRunner: boolean;
  readonly duplex: boolean;
  readonly date?: string | undefined;
  /** Träningsläget: kartbitar (en liten karta per sträcka) i stället för sidor eller mall. */
  readonly pieces?: boolean | undefined;
}

export function printJobRequest(selection: PrintJobSelection, kind: PrintJobKind, profileId: string, confirmation: { warnings: boolean; rules: readonly string[] },
  requestId: string = crypto.randomUUID(), profile?: PrintProfile): PrintJobRequest {
  const template = selection.template;
  const known = template && !selection.templateIsDraft
    && (BUILT_IN_SHEET_LAYOUTS.some(item => item.id === template.id) || selection.savedTemplateIds.includes(template.id));
  return {
    formatVersion: 1, requestId, kind, profileId, ...(profile ? { profile } : {}),
    layout: selection.pieces ? { kind: "PIECES" } : template ? { kind: "TEMPLATE", template: known ? template.id : template, fill: selection.fill }
      : { kind: "PAGES", header: selection.header },
    // Dubbelsidigt gäller löparnas baksidor och kartbytets delar (ADR-0203: del 2 på baksidan av del 1).
    perRunner: selection.perRunner, duplex: selection.duplex,
    // Kartbytets del följer med (ADR-0203); utan den skrev servern hela banan en gång per del.
    // ADR-0217: arkets layout följer med (saknas = huvudlayouten).
    items: selection.items.map(item => ({ course: item.course, ...(item.variant ? { variant: item.variant } : {}), ...(item.part !== undefined ? { part: item.part } : {}),
      ...(item.layout && item.layout !== MAIN_LAYOUT ? { layout: item.layout } : {}),
      ...(item.printScale ? { printScale: item.printScale } : {}),
      ...(item.printArea ? { printArea: item.printArea } : {}), ...(item.runner ? { runner: { ...item.runner, club: item.runner.club ?? null } } : {}),
      ...(item.training ? { training: item.training } : {}) })),
    ...(selection.date ? { date: selection.date } : {}),
    warningsConfirmed: confirmation.warnings, confirmedRules: [...confirmation.rules]
  };
}

/**
 * Förhandskontrollen mot det PDF:en kan (äkta övertryck ja, PDF/X och ICC nej). Med användningen vet BL-profilernas
 * kontroll vilka färger som ritas (oanvända behöver inget godkännande).
 */
export function pdfPreflight(profile: PrintProfile, colors: readonly MapColor[], confirmed: ReadonlySet<string>, usage?: ReadonlyMap<number, ColorUsage>): PreflightReport {
  return colorPreflight(profile, sourceMapColors(colors, usage), PDF_PRINT_CAPABILITIES, confirmed);
}

/** Kan PDF:en skapas: inga blockerande fel och varningarna bekräftade. */
export function pdfAllowed(report: PreflightReport | undefined, warningsConfirmed: boolean): boolean {
  if (!report) return true;
  if (!report.canPrint) return false;
  return warningsConfirmed || !report.findings.some(finding => finding.severity === "WARNING");
}

export async function fetchPrintJobs(raceId: string, signal?: AbortSignal): Promise<PrintJobs> {
  const response = await fetchWithRetry(`${courseSettingBase(raceId)}/course-setting/print-jobs`, { credentials: "same-origin", cache: "no-store", signal: signal ?? null });
  if (!response.ok) throw new HttpError(response.status);
  const value = printJobsSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("scope");
  return value;
}

export async function createPrintJob(raceId: string, request: PrintJobRequest): Promise<{ kind: "ok"; job: PrintJob } | { kind: "problem"; problem: PrintJobProblem }> {
  const response = await adminFetch(`${courseSettingBase(raceId)}/course-setting/print-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) }, fetchUntilReached);
  if (response.status === 422) return { kind: "problem", problem: printJobProblemSchema.parse(await response.json()) };
  if (!response.ok) throw new HttpError(response.status);
  return { kind: "ok", job: printJobSchema.parse(await response.json()) };
}

export async function deletePrintJob(raceId: string, jobId: string): Promise<void> {
  const response = await adminFetch(`${courseSettingBase(raceId)}/course-setting/print-jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }, fetchUntilReached);
  if (!response.ok && response.status !== 404) throw new HttpError(response.status);
}

export const printJobPdfUrl = (raceId: string, jobId: string) => `${courseSettingBase(raceId)}/course-setting/print-jobs/${encodeURIComponent(jobId)}/pdf`;
