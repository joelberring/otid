import { cellMeters, type GridPart } from "@o-tid/map-revision/base-map";
import { banksOf, basisVectors, contoursOf, contourStyle, imageOf, type BasisFile, type BasisJob, type ContourLine } from "./map-project-drawing-basis";
import { jpegPagesPdf, type JpegPage } from "./pdf-jpeg-pages";

/**
 * Fältutskriften av underlaget (kartritaren: «Sedan ritar jag det mesta på plast i skogen, där har jag en utskrift med 1 m
 * ekv.»): ljusa, lågkontrastiga sidor att rita ovanpå. Kartans område delas i blad med 10 mm överlapp; varje blad har
 * rutnät med koordinater (SWEREF 99 TM) och en rad med blad, skala och ekvidistans. Sidorna ritas på canvas och blir JPEG
 * i en PDF (`jpegPagesPdf`).
 */
export interface FieldPrintChoice {
  readonly scale: number;
  readonly paper: "A4" | "A3";
  readonly landscape: boolean;
  readonly interval: number;
  readonly smooth: boolean;
  readonly shade: boolean;
  readonly vegetation: boolean;
  readonly relief: boolean;
  readonly banks: boolean;
  readonly files: readonly BasisFile[];
}
export interface FieldPrintTexts { readonly title: string; readonly footer: (page: number, pages: number) => string }

const PAPER = { A4: [210, 297], A3: [297, 420] } as const;
const MARGIN_MM = 8, HEADER_MM = 6, OVERLAP_MM = 10;
export const FIELD_PRINT_MAX_PAGES = 40;
type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Bladen över området: rutor i meter, centrerade över det. */
export function fieldPages(extent: Box, choice: Pick<FieldPrintChoice, "scale" | "paper" | "landscape">): { pages: Box[]; widthMm: number; heightMm: number; mapMm: [number, number] } {
  const [w, h] = PAPER[choice.paper], [widthMm, heightMm] = choice.landscape ? [h, w] : [w, h];
  const mapMm: [number, number] = [widthMm - 2 * MARGIN_MM, heightMm - 2 * MARGIN_MM - HEADER_MM];
  const metersPerMm = choice.scale / 1000;
  const pageW = mapMm[0] * metersPerMm, pageH = mapMm[1] * metersPerMm, overlap = OVERLAP_MM * metersPerMm;
  const count = (size: number, page: number) => Math.max(1, Math.ceil((size - overlap) / (page - overlap)));
  const columns = count(extent.maxX - extent.minX, pageW), rows = count(extent.maxY - extent.minY, pageH);
  const totalW = columns * (pageW - overlap) + overlap, totalH = rows * (pageH - overlap) + overlap;
  const x0 = (extent.minX + extent.maxX - totalW) / 2, y1 = (extent.minY + extent.maxY + totalH) / 2;
  const pages: Box[] = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const minX = x0 + column * (pageW - overlap), maxY = y1 - row * (pageH - overlap);
    pages.push({ minX, maxX: minX + pageW, maxY, minY: maxY - pageH });
  }
  return { pages, widthMm, heightMm, mapMm };
}

/** Rasterbilden som canvas (en bildpunkt per cell), vitt genomskinligt. */
function rasterCanvas(rgb: Uint8Array, part: GridPart): HTMLCanvasElement {
  const { columns, rows } = part.grid, canvas = document.createElement("canvas");
  canvas.width = columns; canvas.height = rows;
  const image = new ImageData(columns, rows);
  for (let i = 0; i < columns * rows; i += 1) {
    const r = rgb[i * 3]!, g = rgb[i * 3 + 1]!, b = rgb[i * 3 + 2]!;
    image.data[i * 4] = r; image.data[i * 4 + 1] = g; image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = r === 255 && g === 255 && b === 255 ? 0 : 255;
  }
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return canvas;
}

const LAYER_COLORS: Record<string, string> = { "1": "rgb(175,95,35)", "2": "rgb(30,30,30)", "3": "rgb(0,120,210)", "4": "rgb(40,150,60)", "5": "rgb(60,60,60)" };

export async function fieldPrintPdf(base: string, jobs: readonly BasisJob[], ground: GridPart, vegetation: GridPart | undefined,
  choice: FieldPrintChoice, texts: FieldPrintTexts): Promise<Uint8Array> {
  const cell = cellMeters(ground.affine), { grid, affine } = ground;
  const extent = { minX: affine[2] - cell / 2, maxX: affine[2] + cell * (grid.columns - 0.5), maxY: affine[5] + cell / 2, minY: affine[5] - cell * (grid.rows - 0.5) };
  const layout = fieldPages(extent, choice);
  // Blad helt utan markdata (havet runt en ö) skrivs inte ut.
  const hasData = (page: Box) => {
    for (let k = 0; k < 400; k += 1) {
      const x = page.minX + ((k % 20) + 0.5) / 20 * (page.maxX - page.minX), y = page.minY + (Math.floor(k / 20) + 0.5) / 20 * (page.maxY - page.minY);
      const column = Math.round((x - affine[2]) / cell), row = Math.round((affine[5] - y) / cell);
      if (column >= 0 && row >= 0 && column < grid.columns && row < grid.rows && grid.meters[row * grid.columns + column] === grid.meters[row * grid.columns + column]) return true;
    }
    return false;
  };
  const pages = layout.pages.filter(hasData);
  if (pages.length > FIELD_PRINT_MAX_PAGES) throw new Error(`pages:${pages.length}`);
  const rasters = ([["shade", 0.45], ["vegetation", 0.45], ["relief", 0.55]] as const)
    .filter(([kind]) => choice[kind])
    .flatMap(([kind, alpha]) => { const image = imageOf(kind, ground, vegetation); return image ? [{ canvas: rasterCanvas(image.rgb, image.part), part: image.part, alpha }] : []; });
  const contours = contoursOf(ground, choice.interval, choice.smooth).map(line => ({ line, box: boxOf(line.points) }));
  const classes = [...new Set(contours.map(({ line }) => line.major))].sort((a, b) => a - b);
  const vectors: { color: string; lines: (readonly (readonly [number, number])[])[]; points: (readonly [number, number])[] }[] = [];
  for (const file of choice.files) {
    for (const [name, content] of await basisVectors(base, jobs, file)) vectors.push({ color: LAYER_COLORS[name[0] ?? ""] ?? "rgb(90,90,90)", lines: content.lines.map(line => line.points), points: content.points });
  }
  if (choice.banks) vectors.push({ color: "rgb(190,0,70)", lines: banksOf(ground), points: [] });
  const dpi = choice.paper === "A3" ? 250 : 300, pxPerMm = dpi / 25.4;
  const out: JpegPage[] = [];
  for (const [index, page] of pages.entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(layout.widthMm * pxPerMm); canvas.height = Math.round(layout.heightMm * pxPerMm);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    const left = MARGIN_MM * pxPerMm, top = (MARGIN_MM + HEADER_MM) * pxPerMm, pxPerM = pxPerMm * 1000 / choice.scale;
    const px = (x: number) => left + (x - page.minX) * pxPerM, py = (y: number) => top + (page.maxY - y) * pxPerM;
    context.save();
    context.beginPath(); context.rect(left, top, layout.mapMm[0] * pxPerMm, layout.mapMm[1] * pxPerMm); context.clip();
    for (const raster of rasters) {
      const c = cellMeters(raster.part.affine), [, , x0, , , y0] = raster.part.affine;
      context.globalAlpha = raster.alpha;
      context.drawImage(raster.canvas, px(x0 - c / 2), py(y0 + c / 2), raster.part.grid.columns * c * pxPerM, raster.part.grid.rows * c * pxPerM);
    }
    context.globalAlpha = 1;
    context.lineJoin = "round"; context.lineCap = "round";
    const visible = (box: Box) => box.maxX >= page.minX && box.minX <= page.maxX && box.maxY >= page.minY && box.minY <= page.maxY;
    // En färg per kurvklass (som i DXF:en), de grövre ovanpå.
    for (const major of classes) {
      const style = contourStyle(major, choice.interval);
      context.strokeStyle = style.css; context.lineWidth = style.width * pxPerMm;
      context.beginPath();
      for (const { line, box } of contours) if (line.major === major && visible(box)) path(context, line, px, py);
      context.stroke();
    }
    for (const layer of vectors) {
      context.strokeStyle = layer.color; context.fillStyle = layer.color; context.lineWidth = 0.18 * pxPerMm;
      context.beginPath();
      for (const points of layer.lines) if (visible(boxOf(points))) path(context, { points, closed: false }, px, py);
      context.stroke();
      for (const [x, y] of layer.points) {
        if (x < page.minX || x > page.maxX || y < page.minY || y > page.maxY) continue;
        context.beginPath(); context.arc(px(x), py(y), 0.3 * pxPerMm, 0, 2 * Math.PI); context.fill();
      }
    }
    // Rutnät med koordinater: 100 m upp till 1:5 000, annars 200 m.
    const step = choice.scale <= 5000 ? 100 : 200;
    context.strokeStyle = "rgba(0,0,0,0.35)"; context.lineWidth = 0.1 * pxPerMm; context.fillStyle = "rgba(0,0,0,0.6)";
    context.font = `${Math.round(1.8 * pxPerMm)}px sans-serif`;
    for (let x = Math.ceil(page.minX / step) * step; x <= page.maxX; x += step) {
      context.beginPath(); context.moveTo(px(x), top); context.lineTo(px(x), top + layout.mapMm[1] * pxPerMm); context.stroke();
      context.fillText(String(x), px(x) + 0.5 * pxPerMm, top + 2.2 * pxPerMm);
    }
    for (let y = Math.ceil(page.minY / step) * step; y <= page.maxY; y += step) {
      context.beginPath(); context.moveTo(left, py(y)); context.lineTo(left + layout.mapMm[0] * pxPerMm, py(y)); context.stroke();
      context.fillText(String(y), left + 0.5 * pxPerMm, py(y) - 0.5 * pxPerMm);
    }
    context.restore();
    context.strokeStyle = "black"; context.lineWidth = 0.2 * pxPerMm;
    context.strokeRect(left, top, layout.mapMm[0] * pxPerMm, layout.mapMm[1] * pxPerMm);
    context.fillStyle = "black"; context.font = `${Math.round(2.6 * pxPerMm)}px sans-serif`;
    context.fillText(`${texts.title} – ${texts.footer(index + 1, pages.length)}`, left, top - 1.6 * pxPerMm);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) throw new Error("jpeg");
    out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), widthPx: canvas.width, heightPx: canvas.height, widthMm: layout.widthMm, heightMm: layout.heightMm });
    canvas.width = canvas.height = 0;
  }
  return jpegPagesPdf(out, texts.title);
}

function boxOf(points: readonly (readonly [number, number])[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
}
function path(context: CanvasRenderingContext2D, line: Pick<ContourLine, "points" | "closed">, px: (x: number) => number, py: (y: number) => number) {
  line.points.forEach(([x, y], index) => index === 0 ? context.moveTo(px(x), py(y)) : context.lineTo(px(x), py(y)));
  if (line.closed) context.closePath();
}
