import type { MapObject, Path, Point } from "@o-tid/map-file";
import { vertices, type VertexAddress } from "@o-tid/map-revision";
import { toScreen, type Viewport } from "./course-setting-viewport";
import type { CatalogSymbol } from "./map-project-protocol";

/**
 * ADR-0219 (K1): det som ritas ovanpå kartan i editorn och aldrig hamnar i kartfilen: markerat objekt med brytpunkter, objektet
 * som dras eller ritas (med symbolens förenklade stil), utkastets punkter och objektet under pekaren.
 */
type Context = CanvasRenderingContext2D;

const SELECT = "#1a5fd0";

function tracePath(ctx: Context, view: Viewport, path: Path) {
  for (const command of path) {
    const end = toScreen(view, command);
    if (command.type === "M") ctx.moveTo(end.x, end.y);
    else if (command.type === "L") ctx.lineTo(end.x, end.y);
    else {
      const c1 = toScreen(view, { x: command.x1, y: command.y1 }), c2 = toScreen(view, { x: command.x2, y: command.y2 });
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
    }
  }
}

function traceObject(ctx: Context, view: Viewport, object: MapObject) {
  ctx.beginPath();
  if (object.kind === "line") tracePath(ctx, view, object.path);
  else if (object.kind === "area") for (const ring of object.rings) { tracePath(ctx, view, ring); ctx.closePath(); }
}

/** Objektet ungefär som symbolen: ytans färg, linjens färg och bredd, en prick för punkter. */
export function drawPreview(ctx: Context, view: Viewport, object: MapObject, symbol: CatalogSymbol | undefined) {
  ctx.save();
  if (object.kind === "point" || object.kind === "text") {
    const at = toScreen(view, object.at);
    ctx.fillStyle = symbol?.fill ?? "#333";
    ctx.beginPath();
    ctx.arc(at.x, at.y, Math.max(3, 0.4 * view.pxPerMm), 0, Math.PI * 2);
    ctx.fill();
  } else {
    traceObject(ctx, view, object);
    if (object.kind === "area") {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = symbol?.fill ?? "#999";
      ctx.fill("evenodd");
      ctx.globalAlpha = 1;
    }
    const width = (symbol?.width ?? (object.kind === "area" ? 0 : 0.18)) * view.pxPerMm;
    if (width > 0 || object.kind === "line") {
      ctx.lineWidth = Math.max(1, width);
      ctx.strokeStyle = symbol?.stroke ?? "#333";
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.stroke();
    }
  }
  ctx.restore();
}

function handle(ctx: Context, at: { x: number; y: number }, curve: boolean, active: boolean) {
  const size = active ? 7 : 5;
  ctx.beginPath();
  if (curve) ctx.arc(at.x, at.y, size, 0, Math.PI * 2);
  else ctx.rect(at.x - size, at.y - size, size * 2, size * 2);
  ctx.fillStyle = active ? SELECT : "#fff";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = SELECT;
  ctx.stroke();
}

/** Markerat objekt: kontur och brytpunkter (fyrkant = hörn, ring = kurva), vald punkt ifylld. */
export function drawSelection(ctx: Context, view: Viewport, object: MapObject, activeVertex: VertexAddress | undefined) {
  ctx.save();
  if (object.kind === "point" || object.kind === "text") {
    const at = toScreen(view, object.at);
    ctx.strokeStyle = SELECT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(at.x, at.y, Math.max(10, 1.2 * view.pxPerMm), 0, Math.PI * 2); ctx.stroke();
    // Vridningens riktning.
    const angle = -object.angle * Math.PI / 180, reach = Math.max(18, 2 * view.pxPerMm);
    ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(at.x + Math.cos(angle) * reach, at.y + Math.sin(angle) * reach); ctx.stroke();
    ctx.restore();
    return;
  }
  traceObject(ctx, view, object);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.stroke();
  ctx.strokeStyle = SELECT; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
  for (const vertex of vertices(object)) {
    handle(ctx, toScreen(view, vertex.at), vertex.curve, !!activeVertex && activeVertex.part === vertex.part && activeVertex.index === vertex.index);
  }
  ctx.restore();
}

/** K3: den aktiva punktens styrpunkter (linjer från punkten och en ruta att dra i). */
export function drawHandles(ctx: Context, view: Viewport, handles: { at: Point; in?: Point | undefined; out?: Point | undefined }) {
  const at = toScreen(view, handles.at);
  ctx.save();
  for (const handlePoint of [handles.in, handles.out]) {
    if (!handlePoint) continue;
    const to = toScreen(view, handlePoint);
    ctx.strokeStyle = SELECT; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.fillRect(to.x - 5, to.y - 5, 10, 10);
    ctx.strokeRect(to.x - 5, to.y - 5, 10, 10);
  }
  ctx.restore();
}

/** Utkastets punkter (och linjen till pekaren medan man ritar). */
export function drawDraftPoints(ctx: Context, view: Viewport, points: readonly { at: Point; handle?: Point | undefined }[], cursor: Point | undefined) {
  ctx.save();
  const last = points[points.length - 1];
  if (last && cursor) {
    const from = toScreen(view, last.at), to = toScreen(view, cursor);
    ctx.strokeStyle = SELECT; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const point of points) {
    const at = toScreen(view, point.at);
    if (point.handle) {
      const tip = toScreen(view, { x: point.at.x + point.handle.x / 3, y: point.at.y + point.handle.y / 3 });
      const back = toScreen(view, { x: point.at.x - point.handle.x / 3, y: point.at.y - point.handle.y / 3 });
      ctx.strokeStyle = SELECT; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(back.x, back.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    }
    handle(ctx, at, !!point.handle, false);
  }
  ctx.restore();
}

const PROPOSAL = "#d4570b";

/**
 * Förslag: objektets kontur (eller ring för punkter) streckad i orange, och ett kryss där ett objekt föreslås bli borttaget.
 * `strong` = förslaget som är valt i listan.
 */
export function drawProposed(ctx: Context, view: Viewport, objects: readonly MapObject[], deleted: readonly Point[], strong: boolean) {
  ctx.save();
  ctx.strokeStyle = PROPOSAL;
  ctx.lineWidth = strong ? 4 : 2.5;
  for (const point of deleted) {
    const at = toScreen(view, point), size = strong ? 11 : 8;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(at.x - size, at.y - size); ctx.lineTo(at.x + size, at.y + size);
    ctx.moveTo(at.x + size, at.y - size); ctx.lineTo(at.x - size, at.y + size);
    ctx.stroke();
  }
  ctx.setLineDash(strong ? [] : [7, 5]);
  for (const object of objects) {
    if (object.kind === "point" || object.kind === "text") {
      const at = toScreen(view, object.at);
      ctx.beginPath(); ctx.arc(at.x, at.y, Math.max(9, 1.1 * view.pxPerMm), 0, Math.PI * 2); ctx.stroke();
    } else {
      traceObject(ctx, view, object);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export interface AreaDrawing {
  readonly polygon: readonly (readonly Point[])[];
  readonly label: string;
  /** Kontots eget område (blått), någon annans (grått) eller inte utdelat (ljusgrått, streckat). */
  readonly owner: "MINE" | "OTHER" | "NONE";
  readonly selected?: boolean | undefined;
  /** Etapperna: ytan fylls med etappens färg (efter revideringsdatumet). */
  readonly fill?: string | undefined;
}

/** Etappens färg efter hur länge sedan den reviderades: grön (inom ett år), gulgrön (3 år), orange (6 år), röd, grå (aldrig). */
export const STAGE_COLORS = { YEAR: "#2e7d32", THREE: "#9e9d24", SIX: "#ef6c00", OLDER: "#c62828", NEVER: "#9e9e9e" } as const;
export type StageAge = keyof typeof STAGE_COLORS;
export function stageAge(revisedOn: string | null, today: Date): StageAge {
  if (!revisedOn) return "NEVER";
  const years = (today.getTime() - Date.parse(`${revisedOn}T00:00:00Z`)) / (365.25 * 24 * 3600 * 1000);
  return years < 1 ? "YEAR" : years < 3 ? "THREE" : years < 6 ? "SIX" : "OLDER";
}

/** Delområdena: kontur och namn i mitten av ytterkanten. Bara på skärmen. */
export function drawAreas(ctx: Context, view: Viewport, areas: readonly AreaDrawing[]) {
  ctx.save();
  for (const area of areas) {
    const color = area.fill ?? (area.owner === "MINE" ? SELECT : area.owner === "OTHER" ? "#555" : "#888");
    ctx.beginPath();
    for (const ring of area.polygon) {
      ring.forEach((point, index) => {
        const at = toScreen(view, point);
        if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y);
      });
      ctx.closePath();
    }
    if (area.fill) { ctx.globalAlpha = 0.22; ctx.fillStyle = area.fill; ctx.fill("evenodd"); ctx.globalAlpha = 1; }
    ctx.strokeStyle = "#fff"; ctx.lineWidth = area.selected ? 7 : 5; ctx.setLineDash([]); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = area.selected ? 4 : 2.5; ctx.setLineDash(area.owner === "NONE" ? [10, 6] : []); ctx.stroke();
    const outer = area.polygon[0] ?? [];
    if (outer.length === 0) continue;
    const middle = toScreen(view, { x: outer.reduce((sum, point) => sum + point.x, 0) / outer.length,
      y: outer.reduce((sum, point) => sum + point.y, 0) / outer.length });
    ctx.setLineDash([]);
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.strokeText(area.label, middle.x, middle.y);
    ctx.fillStyle = color; ctx.fillText(area.label, middle.x, middle.y);
  }
  ctx.restore();
}

/** En ny kartas område: svart streckad kant (bara på skärmen). */
export function drawMapArea(ctx: Context, view: Viewport, polygon: readonly (readonly Point[])[]) {
  ctx.save();
  ctx.beginPath();
  for (const ring of polygon) {
    ring.forEach((point, index) => {
      const at = toScreen(view, point);
      if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y);
    });
    ctx.closePath();
  }
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.stroke();
  ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5; ctx.setLineDash([12, 4, 2, 4]); ctx.stroke();
  ctx.restore();
}

/**
 * K6b: passpunkterna. Var bildens punkt ligger nu (ett rött kryss), var den ska ligga (en blå ring) och en linje mellan dem.
 * Formerna skiljer dem åt, inte bara färgen.
 */
export function drawControlPoints(ctx: Context, view: Viewport, markers: readonly { image: Point; map: Point | undefined }[]) {
  ctx.save();
  ctx.lineWidth = 2;
  markers.forEach((marker, index) => {
    const image = toScreen(view, marker.image);
    if (marker.map) {
      const map = toScreen(view, marker.map);
      ctx.strokeStyle = "#1f5fbf"; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(image.x, image.y); ctx.lineTo(map.x, map.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(map.x, map.y, 7, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = "#c0262d";
    ctx.beginPath(); ctx.moveTo(image.x - 6, image.y - 6); ctx.lineTo(image.x + 6, image.y + 6);
    ctx.moveTo(image.x + 6, image.y - 6); ctx.lineTo(image.x - 6, image.y + 6); ctx.stroke();
    ctx.fillStyle = "#000"; ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(String(index + 1), image.x + 8, image.y - 8);
  });
  ctx.restore();
}

/**
 * Ägaren 2026-11-10: flera markerade objekt. Varje objekt får en tunn kontur, och runt allt ligger markeringens ruta med ett
 * handtag i varje hörn och en liten båge utanför (där man drar för att vrida).
 */
export function drawMultiSelection(ctx: Context, view: Viewport, objects: readonly MapObject[], box: { minX: number; minY: number; maxX: number; maxY: number }) {
  ctx.save();
  ctx.strokeStyle = SELECT; ctx.lineWidth = 1.5;
  for (const object of objects) {
    if (object.kind === "point" || object.kind === "text") {
      const at = toScreen(view, object.at);
      ctx.beginPath(); ctx.arc(at.x, at.y, Math.max(7, 0.9 * view.pxPerMm), 0, Math.PI * 2); ctx.stroke();
    } else { traceObject(ctx, view, object); ctx.stroke(); }
  }
  const a = toScreen(view, { x: box.minX, y: box.maxY }), b = toScreen(view, { x: box.maxX, y: box.minY });
  const left = a.x - 4, top = a.y - 4, right = b.x + 4, bottom = b.y + 4;
  ctx.setLineDash([5, 4]); ctx.lineWidth = 1; ctx.strokeRect(left, top, right - left, bottom - top); ctx.setLineDash([]);
  for (const [x, y, sx, sy] of [[left, top, -1, -1], [right, top, 1, -1], [right, bottom, 1, 1], [left, bottom, -1, 1]] as const) {
    ctx.fillStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 4, y - 4, 8, 8);
    // Bågen utanför hörnet: här vrider man.
    const start = Math.atan2(sy, sx) - 0.6;
    ctx.beginPath(); ctx.arc(x, y, 13, start, start + 1.2); ctx.stroke();
  }
  ctx.restore();
}

/** Rutan som dras för att markera. */
export function drawMarquee(ctx: Context, view: Viewport, box: { minX: number; minY: number; maxX: number; maxY: number }) {
  const a = toScreen(view, { x: box.minX, y: box.maxY }), b = toScreen(view, { x: box.maxX, y: box.minY });
  ctx.save();
  ctx.fillStyle = "rgb(26 95 208 / 10%)"; ctx.strokeStyle = SELECT; ctx.lineWidth = 1;
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.restore();
}
