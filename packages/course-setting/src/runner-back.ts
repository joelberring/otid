/**
 * ADR-0213: baksidan i en karta per löpare. Ett ark utan karta med papperets element (texter med löparens variabler, bild,
 * ram, linje), förankrade i arket, ritat av samma kod som framsidan (`placePaperItem`). Förvalet är innehållet i Kartor till
 * startens baksida (steg 61): variant och startnummer stort, namn, klubb, klass och starttid, uppe till höger (bakom kartans
 * övre vänstra hörn när kartan vänds kring långsidan). Dokumentet sparar bara elementen med variablerna, aldrig löparna.
 */
import { placePaperItem, validatePaperItem, PAPER_LIMITS, type PaperItem, type SheetPaperItem } from "./paper-items";
import type { RunnerInfo, Sheet } from "./layout-template";
import { CourseSettingEditError, type CourseSettingDocument, type RunnerBackLayout } from "./types";

/** `SheetPaperItem.course` för baksidans element (redigeras på arket som en banas element). */
export const RUNNER_BACK = "RUNNER_BACK";

const invalid = (message: string) => new CourseSettingEditError("INVALID", `Baksidan: ${message}`);

/** Kontrollerar baksidan (elementen som i banans papper, högst `PAPER_LIMITS.items`, unika id). */
export function validateRunnerBack(value: unknown): RunnerBackLayout {
  if (typeof value !== "object" || value === null || !Array.isArray((value as RunnerBackLayout).items)) throw invalid("elementen saknas");
  const items = (value as RunnerBackLayout).items.map(validatePaperItem);
  if (items.length > PAPER_LIMITS.items) throw invalid(`högst ${PAPER_LIMITS.items} element`);
  if (new Set(items.map(item => item.id)).size !== items.length) throw invalid("två element med samma id");
  // Baksidan har ingen kartram: allt står i förhållande till arket.
  return { items: items.map(item => ({ ...item, relativeTo: "PAGE" as const })) };
}

const text = (id: string, value: string, y: number, sizeMm: number, bold: boolean): PaperItem =>
  ({ id, kind: "TEXT", at: { corner: "TOP_RIGHT", x: 10, y }, relativeTo: "PAGE", text: value, sizeMm, widthMm: 120, bold, align: "right" });

/** Förvalet (Kartor till startens baksida); stafett får en rad med lag och sträcka. */
export function defaultRunnerBack(relay = false): RunnerBackLayout {
  return { items: [
    text("b1", "{variant}", 10, 14, true),
    text("b2", "{startnummer}", 28, 18, true),
    text("b3", "{namn}", 52, 8, true),
    text("b4", "{klubb}", 63, 5, false),
    text("b5", "{klass}  {starttid}", 71, 5, false),
    ...(relay ? [text("b6", "Lag {lagnummer} · Sträcka {sträcka}", 79, 5, true)] : [])
  ] };
}

/** Baksidan som gäller: den sparade, annars förvalet (med stafettraden när löparen springer i ett lag). */
export function runnerBackOf(document: CourseSettingDocument, relay = false): RunnerBackLayout {
  return document.event.runnerBack ?? defaultRunnerBack(relay);
}

/**
 * Baksidan för en löpares karta: samma papper som framsidan, elementen med löparens variabler. `front` är framsidans
 * (första) ram: banan, varianten, skalan och löparen. En mening som blir tom (t.ex. klubben för en reserv) står inte.
 */
export function runnerBackSheet(document: CourseSettingDocument, paper: Sheet["paper"],
  front: { readonly course: string; readonly variant?: string | undefined; readonly printScale: number; readonly runner?: RunnerInfo | undefined },
  options: { readonly date?: string | undefined; readonly runnerPlaceholders?: boolean | undefined } = {}): Sheet {
  const page = { x: 0, y: 0, width: paper.widthMm, height: paper.heightMm };
  const frame = { course: front.course, ...(front.variant ? { variant: front.variant } : {}), printScale: front.printScale,
    ...(front.runner ? { runner: front.runner } : {}), clip: page };
  const paperItems: SheetPaperItem[] = [];
  for (const item of runnerBackOf(document, front.runner?.team !== undefined).items) {
    if (item.hide) continue;
    const placed = placePaperItem(document, item, document.event.runnerBack ? "OWN" : "TEMPLATE", frame, 0,
      { page, date: options.date, runnerPlaceholders: options.runnerPlaceholders, course: RUNNER_BACK });
    if (placed) paperItems.push(placed);
  }
  return { paper, frames: [], texts: [], images: [], descriptions: [], boxes: [], cutMarks: [], back: true,
    ...(paperItems.length > 0 ? { paperItems } : {}) };
}
