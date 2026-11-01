import type { OverprintPrimitive } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { toScreen, type Viewport } from "./course-setting-viewport";
import { alternativeColor, alternativeLabels, ROUTE_CHOICE_COLORS } from "./route-choice-view";

/**
 * Steg 62 (ADR-0180 beslut 5): banpåtryckets figurer på skärmen, i ett eget canvas-lager ovanpå kartan. Samma figurer blir
 * PDF i steg 65. Färgen "banans" är Purple Pens standardlila (CMYK 20/100/0/0); vit är vit bakgrund och kant.
 */
export const COURSE_PURPLE = "rgb(204, 0, 255)";
const DEGREES = Math.PI / 180;

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Bågarna som ritas när ringen har avbrott (grader moturs i kartan; skärmen har y nedåt). */
export function circleArcs(gaps: readonly { startDegrees: number; endDegrees: number }[] | undefined): [number, number][] {
  if (!gaps || gaps.length === 0) return [[0, 360]];
  const normalized = gaps.map(gap => {
    const start = ((gap.startDegrees % 360) + 360) % 360;
    let end = ((gap.endDegrees % 360) + 360) % 360;
    if (end <= start) end += 360;
    return [start, end] as [number, number];
  }).sort((left, right) => left[0] - right[0]);
  const arcs: [number, number][] = [];
  let cursor = normalized[0]![1];
  for (const [start, end] of [...normalized.slice(1), [normalized[0]![0] + 360, normalized[0]![1] + 360] as [number, number]]) {
    if (start > cursor) arcs.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  return arcs;
}

function path(ctx: Context, view: Viewport, points: readonly Point[], closed: boolean) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = toScreen(view, point);
    if (index === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
  });
  if (closed) ctx.closePath();
}

/** Ritar figurerna i vyn. `faded` ritar dem tonade (t.ex. andra grenar eller banor). */
export function drawOverprint(ctx: Context, view: Viewport, primitives: readonly OverprintPrimitive[], options: { faded?: boolean } = {}) {
  const scale = view.pxPerMm;
  ctx.save();
  ctx.globalAlpha = options.faded ? 0.35 : 1;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  for (const primitive of primitives) {
    const color = primitive.color === "WHITE" ? "#fff" : COURSE_PURPLE;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    switch (primitive.kind) {
      case "circle": {
        const center = toScreen(view, primitive.center);
        ctx.lineWidth = Math.max(1, primitive.lineWidth * scale);
        for (const [start, end] of circleArcs(primitive.gaps)) {
          ctx.beginPath();
          ctx.arc(center.x, center.y, primitive.diameter / 2 * scale, -start * DEGREES, -end * DEGREES, true);
          ctx.stroke();
        }
        break;
      }
      case "polyline":
        ctx.lineWidth = Math.max(1, primitive.width * scale);
        ctx.setLineDash(primitive.dash ? primitive.dash.map(value => value * scale) : []);
        path(ctx, view, primitive.points, primitive.closed === true);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case "polygon":
        ctx.beginPath();
        for (const ring of primitive.rings) {
          ring.forEach((point, index) => {
            const screen = toScreen(view, point);
            if (index === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
          });
          ctx.closePath();
        }
        ctx.fill("evenodd");
        break;
      case "text": {
        const at = toScreen(view, primitive.at);
        ctx.font = `${Math.max(6, primitive.heightMm * scale)}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(primitive.text, at.x, at.y);
        break;
      }
    }
  }
  ctx.restore();
}

/** Markeringar ovanpå: vald kontroll eller sträcka (blå) och kontroller från kontrollistan (orange), alltid synliga. */
export function drawMarks(ctx: Context, view: Viewport, marks: { selected: readonly Point[]; selectedLine?: readonly Point[] | undefined;
  flagged: readonly Point[]; bends?: readonly Point[] | undefined; radiusMm: number }) {
  const radius = Math.max(10, marks.radiusMm * view.pxPerMm + 6);
  ctx.save();
  ctx.lineWidth = 3;
  if (marks.selectedLine && marks.selectedLine.length > 1) {
    ctx.strokeStyle = "rgba(0, 110, 220, 0.55)";
    ctx.lineWidth = 8;
    path(ctx, view, marks.selectedLine, false);
    ctx.stroke();
    ctx.lineWidth = 3;
  }
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "rgb(230, 120, 0)";
  for (const point of marks.flagged) {
    const at = toScreen(view, point);
    ctx.beginPath(); ctx.arc(at.x, at.y, radius + 4, 0, 2 * Math.PI); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgb(0, 110, 220)";
  for (const point of marks.selected) {
    const at = toScreen(view, point);
    ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI); ctx.stroke();
  }
  ctx.fillStyle = "rgb(0, 110, 220)";
  for (const point of marks.bends ?? []) {
    const at = toScreen(view, point);
    ctx.fillRect(at.x - 4, at.y - 4, 8, 8);
  }
  ctx.restore();
}

/** Linjebredderna (px) för vägvalen: bästa vägen, alternativen och den vita kanten under dem. */
export const ROUTE_LINE = { best: 5, alternative: 4, halo: 4 } as const;

/**
 * Vägvalen för vald sträcka (steg 60): stråket tonat, alternativen streckade i var sin färg med vit kant och en etikett
 * med nummer och tidsskillnad ("1 · +8 %"), och bästa vägen överst som tjock blå linje med vit kant.
 */
export function drawRouteChoice(ctx: Context, view: Viewport, analysis: {
  best?: { points: readonly Point[] } | undefined; alternatives: readonly { points: readonly Point[]; timeRatio: number }[];
  corridor?: { origin: Point; cellMm: number; width: number; height: number; mask: Uint8Array } | undefined;
}) {
  ctx.save();
  const corridor = analysis.corridor;
  if (corridor) {
    ctx.fillStyle = "rgba(0, 150, 255, 0.18)";
    const cell = corridor.cellMm * view.pxPerMm;
    for (let row = 0; row < corridor.height; row += 1) {
      const top = toScreen(view, { x: corridor.origin.x, y: corridor.origin.y + (corridor.height - row) * corridor.cellMm });
      let column = 0;
      while (column < corridor.width) {
        if (corridor.mask[row * corridor.width + column] !== 1) { column += 1; continue; }
        const start = column;
        while (column < corridor.width && corridor.mask[row * corridor.width + column] === 1) column += 1;
        ctx.fillRect(top.x + start * cell, top.y, (column - start) * cell + 0.5, cell + 0.5);
      }
    }
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Sämsta alternativet först, så att de bättre och bästa vägen hamnar ovanpå.
  const order = analysis.alternatives.map((_, index) => index).reverse();
  for (const index of order) {
    const points = analysis.alternatives[index]!.points;
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = ROUTE_LINE.alternative + ROUTE_LINE.halo;
    path(ctx, view, points, false); ctx.stroke();
    ctx.setLineDash([12, 7]);
    ctx.strokeStyle = alternativeColor(index);
    ctx.lineWidth = ROUTE_LINE.alternative;
    path(ctx, view, points, false); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (analysis.best) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = ROUTE_LINE.best + ROUTE_LINE.halo;
    path(ctx, view, analysis.best.points, false); ctx.stroke();
    ctx.strokeStyle = ROUTE_CHOICE_COLORS.best;
    ctx.lineWidth = ROUTE_LINE.best;
    path(ctx, view, analysis.best.points, false); ctx.stroke();
  }
  // Etiketterna: vit platta med färgad kant, numret och tidsskillnaden.
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of alternativeLabels(analysis, 12 / view.pxPerMm)) {
    const at = toScreen(view, label.at);
    const width = ctx.measureText(label.text).width + 10, height = 18;
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeStyle = alternativeColor(label.index);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(at.x - width / 2, at.y - height / 2, width, height);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgb(20, 20, 20)";
    ctx.fillText(label.text, at.x, at.y + 0.5);
  }
  ctx.restore();
}
