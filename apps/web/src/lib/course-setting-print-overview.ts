import { effectivePaper, type CourseSettingDocument, type OverprintPrimitive, type Sheet } from "@o-tid/course-setting";

/**
 * ADR-0211 beslut 7: översikten på utskriftssidan, ett kort per ark (bana, kartbytets del, sida). Korten säger namn, skala,
 * papper och mall, och märken för det som skiljer banan från mallen och det som bör ses över.
 */
export interface SheetCard {
  readonly key: string;
  readonly index: number;
  readonly course: string | undefined;
  readonly part: number | undefined;
  readonly label: string;
  readonly scale: number | undefined;
  readonly paper: string;
  /** Papperets mall som banan följer (ADR-0197), och "Kartor per ark" om sidan har en. */
  readonly paperTemplate: string | undefined;
  readonly sheetLayout: string | undefined;
  /** Banan har egna element eller ändringar utöver mallen. */
  readonly changed: boolean;
  readonly warnings: readonly ("DESCRIPTION_COVERS_MAP" | "COURSE_OUTSIDE_FRAME")[];
  readonly back: boolean;
}

const PAPERS: readonly [string, number, number][] = [["A3", 297, 420], ["A4", 210, 297], ["A5", 148, 210]];

/** "A4 liggande", "A3 stående" eller måtten. */
export function paperText(paper: Sheet["paper"]): string {
  const short = Math.min(paper.widthMm, paper.heightMm), long = Math.max(paper.widthMm, paper.heightMm);
  const name = PAPERS.find(([, w, h]) => Math.abs(w - short) < 1.5 && Math.abs(h - long) < 1.5)?.[0];
  const orientation = paper.widthMm > paper.heightMm ? "liggande" : "stående";
  return name ? `${name} ${orientation}` : `${Math.round(paper.widthMm)} × ${Math.round(paper.heightMm)} mm`;
}

/** Ligger någon av banans figurer (ringar, linjer, start, mål) utanför ramens utsnitt? */
export function courseOutsideFrame(figures: readonly OverprintPrimitive[], area: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  const out = (x: number, y: number, r = 0) => x - r < area.minX - 0.01 || x + r > area.maxX + 0.01 || y - r < area.minY - 0.01 || y + r > area.maxY + 0.01;
  for (const figure of figures) {
    if (figure.role !== "CONTROL" && figure.role !== "START" && figure.role !== "FINISH" && figure.role !== "LEG") continue;
    if (figure.kind === "circle" && out(figure.center.x, figure.center.y, figure.diameter / 2)) return true;
    if (figure.kind === "polyline" && figure.points.some(point => out(point.x, point.y))) return true;
  }
  return false;
}

export function sheetCards(document: CourseSettingDocument, sheets: readonly { key: string; sheet: Sheet; label: string }[], sheetLayout?: string): SheetCard[] {
  return sheets.map(({ key, sheet, label }, index) => {
    const frame = sheet.frames[0];
    const course = frame?.course;
    const paper = course && course !== "ALL_CONTROLS" ? effectivePaper(document, course, frame?.part) : undefined;
    const changed = paper ? paper.items.some(item => item.source !== "TEMPLATE") || paper.clipSource === "OWN"
      || Object.keys(document.event.paperLayouts?.[frame?.part !== undefined ? `${course}#${frame.part}` : course!]?.descriptions ?? {}).length > 0 : false;
    const warnings: SheetCard["warnings"][number][] = [];
    if (sheet.descriptions.some(item => (item.overlaps ?? 0) > 0)) warnings.push("DESCRIPTION_COVERS_MAP");
    if (sheet.frames.some(item => courseOutsideFrame(item.figures, item.mapArea))) warnings.push("COURSE_OUTSIDE_FRAME");
    return { key, index, course, part: frame?.part, label, scale: frame?.printScale, paper: paperText(sheet.paper), paperTemplate: paper?.template?.name,
      sheetLayout, changed: Boolean(paper?.template) && changed, warnings, back: sheet.back === true };
  });
}
