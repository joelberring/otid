import type { Point } from "@o-tid/map-file";
import type { Coverage, ReconMarker, ReconStatus, TrackPoint } from "@o-tid/map-revision";
import { toScreen, type Viewport } from "./course-setting-viewport";

/**
 * ADR-0219 tillägget om rekningen (K3): rekningens lager ovanpå kartan, som aldrig skrivs ut: täckningen (ljusblått där någon
 * gått), spåren (tunna linjer, det egna som spelas in kraftigare) och objektens status. Statusen syns på formen, inte bara
 * färgen: ej rekat är en röd ring, passerat en gul fylld ring, kollat en grön fylld prick med bock.
 */
type Context = CanvasRenderingContext2D;

const STATUS_STYLE: Record<ReconStatus, { stroke: string; fill: string | undefined }> = {
  UNSEEN: { stroke: "#c62828", fill: undefined },
  PASSED: { stroke: "#a86b00", fill: "rgba(255, 193, 7, 0.85)" },
  CHECKED: { stroke: "#1b5e20", fill: "#2e7d32" }
};

/** Markörerna i bild; radien följer zoomen (2–7 px). Vilka som visas väljs med `shown`. */
export function drawReconMarkers(ctx: Context, view: Viewport, markers: readonly ReconMarker[], shown: ReadonlySet<ReconStatus>) {
  const radius = Math.max(2, Math.min(7, view.pxPerMm * 0.6));
  ctx.save();
  ctx.lineWidth = Math.max(1, radius / 3);
  for (const marker of markers) {
    if (!shown.has(marker.status)) continue;
    const at = toScreen(view, marker.at);
    if (at.x < -radius || at.y < -radius || at.x > view.width + radius || at.y > view.height + radius) continue;
    const style = STATUS_STYLE[marker.status];
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    if (style.fill) { ctx.fillStyle = style.fill; ctx.fill(); }
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
    if (marker.status === "CHECKED" && radius >= 4) {
      ctx.beginPath();
      ctx.moveTo(at.x - radius * 0.5, at.y);
      ctx.lineTo(at.x - radius * 0.1, at.y + radius * 0.4);
      ctx.lineTo(at.x + radius * 0.55, at.y - radius * 0.45);
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Täckningen som en bild (en pixel per ruta), skapad en gång per täckning. */
export function coverageImage(coverage: Coverage): HTMLCanvasElement | undefined {
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = coverage.columns;
  canvas.height = coverage.rows;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const image = context.createImageData(coverage.columns, coverage.rows);
  for (let r = 0; r < coverage.rows; r += 1) {
    // Rutnätet är nerifrån och upp (y uppåt), bilden uppifrån.
    const row = coverage.rows - 1 - r;
    for (let c = 0; c < coverage.columns; c += 1) {
      if (!coverage.cells[r * coverage.columns + c]) continue;
      const index = (row * coverage.columns + c) * 4;
      image.data[index] = 30; image.data[index + 1] = 136; image.data[index + 2] = 229; image.data[index + 3] = 80;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export function drawCoverage(ctx: Context, view: Viewport, coverage: Coverage, image: HTMLCanvasElement) {
  const topLeft = toScreen(view, { x: coverage.origin.x, y: coverage.origin.y + coverage.rows * coverage.cellMm });
  const size = coverage.cellMm * view.pxPerMm;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, topLeft.x, topLeft.y, coverage.columns * size, coverage.rows * size);
  ctx.restore();
}

/** Spåren som tunna linjer; `strong` (det som spelas in nu) kraftigare. En lucka (tappad signal) ritas inte. */
export function drawTracks(ctx: Context, view: Viewport, tracks: readonly (readonly TrackPoint[])[], strong: readonly TrackPoint[] | undefined,
  gapMm: number) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const trace = (track: readonly TrackPoint[]) => {
    ctx.beginPath();
    let previous: Point | undefined;
    for (const point of track) {
      const at = toScreen(view, point);
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > gapMm) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y);
      previous = point;
    }
    ctx.stroke();
  };
  ctx.strokeStyle = "rgba(123, 31, 162, 0.7)";
  ctx.lineWidth = 2;
  for (const track of tracks) trace(track);
  if (strong && strong.length > 0) {
    ctx.strokeStyle = "rgba(216, 27, 96, 0.95)";
    ctx.lineWidth = 3.5;
    trace(strong);
  }
  ctx.restore();
}

/**
 * K3: notiserna som en liten flagga med "!" (öppen: orange, klar: grå, väntar på nät: streckad). Den som visas är större. Formen
 * skiljer sig från rekningens ringar.
 */
export function drawNotes(ctx: Context, view: Viewport, notes: readonly { noteId: string; at: Point; status: "OPEN" | "DONE"; pending: boolean }[],
  shown: string | undefined) {
  ctx.save();
  for (const note of notes) {
    const at = toScreen(view, note.at);
    if (at.x < -20 || at.y < -30 || at.x > view.width + 20 || at.y > view.height + 10) continue;
    const size = note.noteId === shown ? 13 : 9;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(at.x - size, at.y - size * 1.6);
    ctx.lineTo(at.x + size, at.y - size * 1.6);
    ctx.closePath();
    ctx.fillStyle = note.status === "DONE" ? "#9e9e9e" : "#ef6c00";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    if (note.pending) ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(size * 1.1)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", at.x, at.y - size * 1.05);
  }
  ctx.restore();
}

/** Notisen under punkten (skärmens flagga ovanför sin punkt räknas), eller undefined. */
export function noteAt<T extends { at: Point }>(notes: readonly T[], point: Point, toleranceMm: number, pxPerMm: number): T | undefined {
  const flag = 14 / pxPerMm;
  let best: T | undefined, distance = Infinity;
  for (const note of notes) {
    const dx = point.x - note.at.x, dy = point.y - (note.at.y + flag);
    const d = Math.hypot(dx, dy);
    if (d <= Math.max(toleranceMm, flag) && d < distance) { best = note; distance = d; }
  }
  return best;
}

/** Normkontrollens ställen: orange romber med vit kant (formen skiljer dem från rekningens ringar), det visade större. */
export function drawNormIssues(ctx: Context, view: Viewport, issues: readonly { readonly at: Point }[], shown: Point | undefined) {
  ctx.save();
  ctx.lineJoin = "round";
  const diamond = (at: { x: number; y: number }, size: number) => {
    ctx.beginPath();
    ctx.moveTo(at.x, at.y - size); ctx.lineTo(at.x + size, at.y); ctx.lineTo(at.x, at.y + size); ctx.lineTo(at.x - size, at.y); ctx.closePath();
  };
  for (const issue of issues) {
    const at = toScreen(view, issue.at);
    if (at.x < -10 || at.y < -10 || at.x > view.width + 10 || at.y > view.height + 10) continue;
    const size = shown && shown.x === issue.at.x && shown.y === issue.at.y ? 10 : 6;
    diamond(at, size);
    ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = "#e65100"; ctx.stroke();
  }
  ctx.restore();
}
