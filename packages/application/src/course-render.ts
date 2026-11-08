import { MCP_MAX_IMAGE_SIDE_PX } from "@o-tid/contracts";
import { layoutOverprint, type CourseSettingDocument, type OverprintPrimitive } from "@o-tid/course-setting";
import { drawMap, readMapFile, type Point } from "@o-tid/map-file";
import type { CreateMapJobCanvas, MapJobCanvas } from "./map-project-job-run";

/**
 * Ägaren 2026-11-08 (AI-banläggningsassistenten): en bild av en bana på tävlingens karta, för Claude. Kartan ritas som i
 * kartprojektens bilder (samma `drawMap`) och banpåtrycket (`layoutOverprint`, samma figurer som skärmen och PDF:en) läggs
 * ovanpå i lila, med ett rutnät i kartans mm som i `course_overview`. Ren kod; canvasen kommer utifrån.
 */
export interface CourseRenderRequest { readonly course: string; readonly widthPx?: number | undefined; readonly grid?: boolean | undefined;
  /** Utsnitt i kartans mm; saknas = banan med marginal. */
  readonly area?: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | undefined }

const PURPLE = "rgba(166, 38, 255, 0.92)";
const MARGIN_MM = 15;

function extentOf(primitives: readonly OverprintPrimitive[]): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  const points: Point[] = [];
  for (const item of primitives) {
    if (item.kind === "circle") points.push({ x: item.center.x - item.diameter / 2, y: item.center.y - item.diameter / 2 },
      { x: item.center.x + item.diameter / 2, y: item.center.y + item.diameter / 2 });
    else if (item.kind === "polyline") points.push(...item.points);
    else if (item.kind === "polygon") points.push(...item.rings.flat());
    else if (item.kind === "text") points.push(item.at);
  }
  if (points.length === 0) return undefined;
  return { minX: Math.min(...points.map(p => p.x)) - MARGIN_MM, minY: Math.min(...points.map(p => p.y)) - MARGIN_MM,
    maxX: Math.max(...points.map(p => p.x)) + MARGIN_MM, maxY: Math.max(...points.map(p => p.y)) + MARGIN_MM };
}

function drawOverprint(canvas: MapJobCanvas, primitives: readonly OverprintPrimitive[], px: (point: Point) => [number, number], pxPerMm: number) {
  const ctx = canvas.context;
  ctx.save();
  ctx.strokeStyle = PURPLE;
  ctx.fillStyle = PURPLE;
  for (const item of primitives) {
    if (item.color === "WHITE" || item.color === "BLACK" || item.kind === "image" || item.kind === "description") continue;
    ctx.globalAlpha = item.fade ?? 1;
    if (item.kind === "circle") {
      ctx.lineWidth = Math.max(1, item.lineWidth * pxPerMm);
      ctx.setLineDash([]);
      const [x, y] = px(item.center);
      ctx.beginPath();
      ctx.arc(x, y, (item.diameter / 2) * pxPerMm, 0, Math.PI * 2);
      ctx.stroke();
    } else if (item.kind === "polyline") {
      ctx.lineWidth = Math.max(1, item.width * pxPerMm);
      ctx.setLineDash(item.dash ? item.dash.map(value => value * pxPerMm) : []);
      ctx.beginPath();
      item.points.forEach((point, index) => { const [x, y] = px(point); if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      if (item.closed && item.points[0]) { const [x, y] = px(item.points[0]); ctx.lineTo(x, y); }
      ctx.stroke();
    } else if (item.kind === "polygon") {
      ctx.globalAlpha = (item.fade ?? 1) * (item.tint ?? 0.5);
      ctx.beginPath();
      for (const ring of item.rings) ring.forEach((point, index) => { const [x, y] = px(point); if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.fill("evenodd");
    } else if (item.kind === "text") {
      const [x, y] = px(item.at);
      ctx.font = `bold ${Math.max(9, Math.round(item.heightMm * pxPerMm))}px sans-serif`;
      ctx.textAlign = item.align === "left" ? "left" : "center";
      ctx.textBaseline = "middle";
      ctx.fillText(item.text, x, y);
    }
  }
  ctx.restore();
}

function drawGrid(canvas: MapJobCanvas, extent: { minX: number; minY: number; maxX: number; maxY: number }, pxPerMm: number, width: number, height: number) {
  const ctx = canvas.context;
  const step = pxPerMm * 10 < 40 ? (pxPerMm * 50 < 60 ? 100 : 50) : 10;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0, 120, 220, 0.4)";
  ctx.fillStyle = "rgba(0, 90, 200, 0.95)";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.setLineDash([]);
  for (let x = Math.ceil(extent.minX / step) * step; x <= extent.maxX; x += step) {
    const p = (x - extent.minX) * pxPerMm;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, height); ctx.stroke(); ctx.fillText(String(x), p + 2, 2);
  }
  for (let y = Math.ceil(extent.minY / step) * step; y <= extent.maxY; y += step) {
    const p = (extent.maxY - y) * pxPerMm;
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(width, p); ctx.stroke(); ctx.fillText(String(y), 2, p + 2);
  }
  ctx.restore();
}

/** Banan på kartan som PNG och uppgifterna om bilden. Kastar om banan inte finns. */
export function renderCourse(map: { bytes: Uint8Array; fileName: string } | null, document: CourseSettingDocument, request: CourseRenderRequest,
  createCanvas: CreateMapJobCanvas) {
  const course = document.courses.find(row => row.id === request.course);
  if (!course) throw new Error("Banan finns inte");
  const primitives = layoutOverprint(document, { course: course.id });
  const extent = request.area ?? extentOf(primitives) ?? { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  const widthMm = Math.max(1, extent.maxX - extent.minX), heightMm = Math.max(1, extent.maxY - extent.minY);
  let pxPerMm = Math.min(MCP_MAX_IMAGE_SIDE_PX, Math.max(200, Math.round(request.widthPx ?? 1200))) / widthMm;
  if (heightMm * pxPerMm > MCP_MAX_IMAGE_SIDE_PX) pxPerMm = MCP_MAX_IMAGE_SIDE_PX / heightMm;
  const width = Math.max(1, Math.round(widthMm * pxPerMm)), height = Math.max(1, Math.round(heightMm * pxPerMm));
  const canvas = createCanvas(width, height);
  const origin = { x: extent.minX, y: extent.maxY };
  if (map) drawMap(canvas.context, readMapFile(map.bytes, map.fileName), { pxPerMm, origin, cull: true, hiddenSymbols: new Set() });
  drawOverprint(canvas, primitives, point => [(point.x - origin.x) * pxPerMm, (origin.y - point.y) * pxPerMm], pxPerMm);
  if (request.grid !== false) drawGrid(canvas, extent, pxPerMm, width, height);
  const round = (value: number) => Math.round(value * 10) / 10;
  return { png: canvas.png(), meta: { course: course.name, areaMm: { minX: round(extent.minX), minY: round(extent.minY), maxX: round(extent.maxX), maxY: round(extent.maxY) },
    pxPerMm: Math.round(pxPerMm * 1000) / 1000, widthPx: width, heightPx: height, metersPerPixel: Math.round((document.event.mapScale / 1000 / pxPerMm) * 100) / 100,
    withMap: map !== null } };
}
