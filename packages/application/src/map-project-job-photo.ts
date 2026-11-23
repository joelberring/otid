import { randomUUID } from "node:crypto";
import { MCP_PROPOSAL_MAX_OPERATIONS } from "@o-tid/contracts";
import { baseKeys, mapNorm, newKey, objectBox, objectRefFor, symbolObjectKind, type MapNorm, type RevisionEdit } from "@o-tid/map-revision";
import {
  classifyPhotoCell, PHOTO_CLASS_CODES, PHOTO_CONFIDENT, photoCellStats, photoFillArea, photoFillCells, photoFillCuts, type PhotoCellClass, type PhotoRaster
} from "@o-tid/map-revision/base-map";
import type { Point } from "@o-tid/map-file";
import type { Box, CreateMapJobCanvas, LoadedProjectMap, MapJobCanvas, RenderUnderlay } from "./map-project-job-run";

/**
 * Fyll ytor ur flygbilden för AI-kopplingen (ägaren 2026-11-23; MCP-verktyget `classify_cells`). Kartjobbet ritar projektets
 * ortofoto (och IR-bilden) över området i 0,25 m, räknar rutorna med samma ytmotor som webbens Fyll över och klassar dem med
 * samma pixelstatistik (`@o-tid/map-revision/base-map`). Utan svar ger jobbet rutornas klass och en kontaktkarta (PNG) med de
 * osäkra rutorna utskurna och numrerade, så att Claude kan titta på dem; med svar (`answers`) blir rutorna ytor och klippningarna
 * under dem ändringar till ett förslag. Rutornas id räknas om ur kartan, så de gäller så länge kartan inte ändrats i området.
 */
export const PHOTO_JOB_MAX_SIDE_M = 500;
const PIXEL_M = 0.25, TILE_PX = 160, COLUMNS = 4;
export const PHOTO_JOB_MAX_IMAGES = 24;

export type PhotoAnswer = { readonly id: string; readonly class: Exclude<PhotoCellClass, "unsure"> | "skip" };
export interface PhotoCellsJobRequest {
  readonly area: Box; readonly includeGround?: boolean | undefined;
  /** Så många osäkra rutor i bilden (förval 12). */
  readonly maxImages?: number | undefined;
  /** Svaren per ruta; med dem blir det ett förslag. */
  readonly answers?: readonly PhotoAnswer[] | undefined;
  /** Med svaren: lägg också in de säkra rutorna med sin egen klass. */
  readonly acceptConfident?: boolean | undefined;
}

export function projectNorm(loaded: LoadedProjectMap): MapNorm {
  return mapNorm({ scale: loaded.base.scale, symbols: [...loaded.base.symbols.values()].filter(symbol => !symbol.id.includes("."))
    .map(symbol => ({ code: symbol.code.text, kind: symbolObjectKind(loaded.base, symbol), name: symbol.name })) });
}

/** Underlagen ritade över rutan `box` (kartans mm) med `pxPerMm`, på vit botten. */
function drawPhoto(canvas: MapJobCanvas, box: Box, pxPerMm: number, underlays: readonly RenderUnderlay[], offset = { x: 0, y: 0 }) {
  const ctx = canvas.context;
  for (const { image, toMap: t } of underlays) {
    ctx.setTransform(pxPerMm * t.a, -pxPerMm * t.d, pxPerMm * t.b, -pxPerMm * t.e, offset.x + pxPerMm * (t.c - box.minX), offset.y + pxPerMm * (box.maxY - t.f));
    ctx.drawImage(image, -0.5, -0.5);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function raster(createCanvas: CreateMapJobCanvas, box: Box, step: number, underlays: readonly RenderUnderlay[]): PhotoRaster | undefined {
  const width = Math.max(1, Math.ceil((box.maxX - box.minX) / step)), height = Math.max(1, Math.ceil((box.maxY - box.minY) / step));
  const canvas = createCanvas(width, height);
  if (!canvas.rgba) return undefined;
  drawPhoto(canvas, box, 1 / step, underlays);
  return { width, height, data: canvas.rgba(), minX: box.minX, maxY: box.maxY, step };
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Jobbet: rutorna klassade (och bilden av de osäkra), eller förslagets ändringar när svaren finns. */
export function runPhotoCellsJob(loaded: LoadedProjectMap, request: PhotoCellsJobRequest, deps: { createCanvas: CreateMapJobCanvas; rgb: readonly RenderUnderlay[];
  ir: readonly RenderUnderlay[] }, now: Date): { result: unknown; image?: Uint8Array } | { error: string } {
  const mPerMm = loaded.base.scale / 1000, area = request.area;
  if (Math.max(area.maxX - area.minX, area.maxY - area.minY) * mPerMm > PHOTO_JOB_MAX_SIDE_M * 1.001) {
    return { result: { errors: [`Området är större än ${PHOTO_JOB_MAX_SIDE_M} × ${PHOTO_JOB_MAX_SIDE_M} m; dela upp det.`] } };
  }
  if (deps.rgb.length === 0 && deps.ir.length === 0) return { result: { errors: ["Inget av projektets ortofoton täcker området."] } };
  const step = PIXEL_M / mPerMm;
  const rgb = raster(deps.createCanvas, area, step, deps.rgb.length ? deps.rgb : deps.ir);
  if (!rgb) return { error: "Arbetaren kan inte läsa bildens pixlar" };
  const ir = deps.rgb.length && deps.ir.length ? raster(deps.createCanvas, area, step, deps.ir) : undefined;
  const norm = projectNorm(loaded);
  const map = { objects: loaded.objects, boxes: loaded.objects.map(objectBox), symbols: loaded.base.symbols, scale: loaded.base.scale, norm };
  const cells = photoFillCells(map, area, { includeGround: request.includeGround === true });
  if (!cells) return { result: { errors: ["Området har för många linjer; välj ett mindre område."] } };
  const classified = cells.map(cell => ({ cell, ...classifyPhotoCell(photoCellStats(rgb, cell.rings, ir), cell.areaM2) }));
  if (!request.answers) return overview(classified, request, deps, area, mPerMm, ir !== undefined);
  return proposal(loaded, classified, request, now);
}

type Classified = { readonly cell: { readonly id: string; readonly rings: Point[][]; readonly at: Point; readonly areaM2: number; readonly state: string };
  readonly guess: PhotoCellClass; readonly confidence: number; readonly reason: string };

function overview(classified: readonly Classified[], request: PhotoCellsJobRequest, deps: { createCanvas: CreateMapJobCanvas; rgb: readonly RenderUnderlay[];
  ir: readonly RenderUnderlay[] }, area: Box, mPerMm: number, infrared: boolean) {
  const unsure = classified.filter(item => item.confidence < PHOTO_CONFIDENT && item.reason !== "no-photo");
  // De osäkra som syns bäst först: inte de minsta, och de stora (över 2 ha) sist.
  const shown = [...unsure].sort((a, b) => Number(a.reason === "large") - Number(b.reason === "large") || b.cell.areaM2 - a.cell.areaM2)
    .slice(0, Math.min(PHOTO_JOB_MAX_IMAGES, request.maxImages ?? 12));
  const counts: Record<string, number> = {};
  for (const item of classified) { const key = item.confidence >= PHOTO_CONFIDENT ? item.guess : "unsure"; counts[key] = (counts[key] ?? 0) + 1; }
  const result = { areaMm: area, infrared, counts, cells: classified.map(item => ({ id: item.cell.id, areaM2: Math.round(item.cell.areaM2), state: item.cell.state,
    guess: item.guess, confidence: item.confidence, reason: item.reason, atMm: [round(item.cell.at.x), round(item.cell.at.y)] })),
    image: shown.map((item, index) => ({ number: index + 1, id: item.cell.id, guess: item.guess, confidence: item.confidence })) };
  if (shown.length === 0) return { result };
  const rows = Math.ceil(shown.length / COLUMNS);
  const canvas = deps.createCanvas(Math.min(shown.length, COLUMNS) * TILE_PX, rows * TILE_PX);
  const ctx = canvas.context;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.context.canvas.width, canvas.context.canvas.height);
  shown.forEach((item, index) => {
    const x0 = (index % COLUMNS) * TILE_PX, y0 = Math.floor(index / COLUMNS) * TILE_PX;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of item.cell.rings[0]!) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
    // Rutan med marginal (minst 10 m runt om), kvadratisk.
    const side = Math.max(maxX - minX, maxY - minY) * 1.3 + 20 / mPerMm, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const box = { minX: cx - side / 2, minY: cy - side / 2, maxX: cx + side / 2, maxY: cy + side / 2 }, scale = TILE_PX / side;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + TILE_PX, y0); ctx.lineTo(x0 + TILE_PX, y0 + TILE_PX); ctx.lineTo(x0, y0 + TILE_PX); ctx.clip();
    drawPhoto(canvas, box, scale, deps.rgb.length ? deps.rgb : deps.ir, { x: x0, y: y0 });
    ctx.beginPath();
    for (const ring of item.cell.rings) ring.forEach((point, i) => {
      const px = x0 + (point.x - box.minX) * scale, py = y0 + (box.maxY - point.y) * scale;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = "rgba(255,0,200,0.95)"; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke();
    ctx.font = "bold 16px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffff"; ctx.fillRect(x0 + 2, y0 + 2, 24, 20); ctx.fillStyle = "#000000"; ctx.fillText(String(index + 1), x0 + 5, y0 + 4);
    ctx.restore();
  });
  return { result, image: canvas.png() };
}

function proposal(loaded: LoadedProjectMap, classified: readonly Classified[], request: PhotoCellsJobRequest, now: Date) {
  const byId = new Map(classified.map(item => [item.cell.id, item]));
  const errors: string[] = [], chosen = new Map<string, Exclude<PhotoCellClass, "unsure">>();
  if (request.acceptConfident) for (const item of classified) if (item.guess !== "unsure" && item.confidence >= PHOTO_CONFIDENT) chosen.set(item.cell.id, item.guess);
  for (const answer of request.answers ?? []) {
    if (!byId.has(answer.id)) { errors.push(`Rutan ${answer.id} finns inte (kartan kan ha ändrats; kör classify_cells utan svar igen)`); continue; }
    if (answer.class === "skip") chosen.delete(answer.id); else chosen.set(answer.id, answer.class);
  }
  const symbolFor = (kind: Exclude<PhotoCellClass, "unsure">) => PHOTO_CLASS_CODES[kind].map(code => loaded.symbolsByCode.get(code))
    .find(symbol => symbol && symbolObjectKind(loaded.base, symbol) === "area");
  const areas: { symbol: string; rings: Point[][] }[] = [];
  for (const [id, kind] of chosen) {
    const symbol = symbolFor(kind);
    if (!symbol) { errors.push(`Kartan saknar en ytsymbol för ${kind} (${PHOTO_CLASS_CODES[kind].join(", ")})`); break; }
    areas.push({ symbol: symbol.id, rings: byId.get(id)!.cell.rings });
  }
  if (errors.length) return { result: { errors } };
  if (areas.length === 0) return { result: { summary: { areas: 0 }, edits: [] } };
  const norm = projectNorm(loaded);
  const cuts = photoFillCuts({ objects: loaded.objects, boxes: loaded.objects.map(objectBox), symbols: loaded.base.symbols, scale: loaded.base.scale, norm }, areas);
  const at = now.toISOString(), edits: RevisionEdit[] = [];
  for (const area of areas) edits.push({ editId: randomUUID(), key: newKey(randomUUID()), ref: null, base: null, kind: "ADD", state: { kind: "OBJECT", object: photoFillArea(area.symbol, area.rings) }, at });
  const baseIndex = new Map(baseKeys(loaded.base).map((key, position) => [key, position]));
  for (const cut of cuts) {
    const key = loaded.keys[cut.index]!, stored = loaded.states.get(key), basePosition = baseIndex.get(key);
    const ref = stored?.ref ?? (basePosition !== undefined ? objectRefFor(loaded.baseSha256, loaded.base.objects[basePosition]!) : null);
    const common = { editId: randomUUID(), key, ref: key.startsWith("b:") ? ref : null, base: stored?.lastEditId ?? null, at };
    const [first, ...rest] = cut.objects;
    if (!first) {
      const box = objectBox(loaded.objects[cut.index]!);
      edits.push({ ...common, kind: "DELETE", state: { kind: "DELETED" }, point: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } });
    } else edits.push({ ...common, kind: "RESHAPE", state: { kind: "OBJECT", object: first } });
    for (const piece of rest) edits.push({ editId: randomUUID(), key: newKey(randomUUID()), ref: null, base: null, kind: "ADD", state: { kind: "OBJECT", object: piece }, at });
  }
  if (edits.length > MCP_PROPOSAL_MAX_OPERATIONS) {
    return { result: { errors: [`${edits.length} ändringar är fler än ${MCP_PROPOSAL_MAX_OPERATIONS} i ett förslag; svara på färre rutor åt gången.`] } };
  }
  const counts: Record<string, number> = {};
  for (const kind of chosen.values()) counts[kind] = (counts[kind] ?? 0) + 1;
  return { result: { summary: { areas: areas.length, byClass: counts, cut: cuts.length }, edits } };
}
