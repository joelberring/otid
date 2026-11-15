import { BUILT_IN_PRINT_PROFILES, type Sheet } from "@o-tid/course-setting";
import { objectBox } from "@o-tid/map-revision";
import { paperFor, PAPER_MARGIN, PAPERS } from "@o-tid/map-revision/base-map";
import { writeSheetsPdf, type FontFiles } from "@o-tid/print-pdf";
import type { LoadedProjectMap } from "./map-project-job-run";

/**
 * Ägaren 2026-11-15 («om man vill skriva ut hela kartan i en pdf … med knapp direkt i kartläget», «knappen ska fungera på
 * alla kartor»): hela kartan med projektets sparade ändringar som en PDF i kartans skala, på det minsta A-pappret (stående
 * eller liggande) som rymmer allt med 10 mm marginal. Större än A0: ett eget papper med samma marginal. Kartan har sin ram
 * och sitt namn som kartobjekt när den gjorts i O-Tid; annars blir det bara kartan.
 */
export interface MapPdfRequest { readonly title?: string | undefined }
export interface MapPdfResult { readonly pages: number; readonly paper: string; readonly size: string | null; readonly landscape: boolean; readonly widthMm: number; readonly heightMm: number; readonly notes: readonly string[] }

/** Det papper (mm, med riktning) som rymmer en ruta på `width` × `height` mm med marginalen. */
export function mapPdfPaper(width: number, height: number): { name: string; size: string | null; widthMm: number; heightMm: number; landscape: boolean } {
  const paper = paperFor(width, height);
  if (!paper) return { name: "eget", size: null, widthMm: Math.ceil(width + 2 * PAPER_MARGIN), heightMm: Math.ceil(height + 2 * PAPER_MARGIN), landscape: width > height };
  const [, short, long] = PAPERS.find(([size]) => size === paper.size)!;
  return { name: `${paper.size} ${paper.landscape ? "liggande" : "stående"}`, size: paper.size, widthMm: paper.landscape ? long : short, heightMm: paper.landscape ? short : long,
    landscape: paper.landscape };
}

export async function runMapPdf(loaded: LoadedProjectMap, request: MapPdfRequest, fonts: FontFiles, now: Date)
  : Promise<{ result: MapPdfResult; pdf: Uint8Array } | { error: string }> {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const object of loaded.objects) {
    const box = objectBox(object);
    if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) continue;
    minX = Math.min(minX, box.minX); minY = Math.min(minY, box.minY); maxX = Math.max(maxX, box.maxX); maxY = Math.max(maxY, box.maxY);
  }
  if (!(maxX > minX && maxY > minY)) return { error: "Kartan är tom" };
  const width = maxX - minX, height = maxY - minY;
  const paper = mapPdfPaper(width, height);
  const scale = loaded.base.scale;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // Utsnittet är hela papperet innanför halva marginalen, med kartans mitt i papperets mitt (kartans mm = papperets mm).
  const clip = { x: PAPER_MARGIN / 2, y: PAPER_MARGIN / 2, width: paper.widthMm - PAPER_MARGIN, height: paper.heightMm - PAPER_MARGIN };
  const mapArea = { minX: cx - clip.width / 2, maxX: cx + clip.width / 2, minY: cy - clip.height / 2, maxY: cy + clip.height / 2 };
  const sheet: Sheet = {
    paper: { widthMm: paper.widthMm, heightMm: paper.heightMm, landscape: paper.landscape, marginMm: PAPER_MARGIN },
    frames: [{ course: "", title: request.title ?? "", mapScale: scale, printScale: scale, mapArea, clip,
      transform: { scale: 1, translateX: clip.x - mapArea.minX, translateY: clip.y + mapArea.maxY }, figures: [] }],
    texts: [], images: [], descriptions: [], boxes: [], cutMarks: []
  };
  const profile = BUILT_IN_PRINT_PROFILES.find(item => item.id === "office")!;
  const written = await writeSheetsPdf({ sheets: [sheet], map: { ...loaded.base, objects: [...loaded.objects] }, profile, mode: "OFFICE", fonts,
    title: request.title?.slice(0, 200) || "Karta", now });
  return { pdf: written.bytes, result: { pages: written.pages, paper: paper.name, size: paper.size, landscape: paper.landscape, widthMm: paper.widthMm, heightMm: paper.heightMm, notes: written.notes } };
}
