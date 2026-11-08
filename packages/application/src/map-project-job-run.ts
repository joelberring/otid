import { randomUUID } from "node:crypto";
import { MCP_MAX_IMAGE_SIDE_PX, MCP_PROPOSAL_MAX_OPERATIONS, MCP_PROPOSAL_MAX_SIDE_M } from "@o-tid/contracts";
import {
  drawMap, mapPointToWgs84, readMapFile, type MapDrawingContext, type MapObject, type MapSymbol, type ParsedMap, type Path, type PathCommand,
  type Point
} from "@o-tid/map-file";
import {
  baseKeys, editedObjects, newKey, newObject, objectBox, objectRefFor, parseObjectRef, symbolObjectKind, validState, withSymbol,
  type KeyedState, type ObjectKey, type RevisionEdit
} from "@o-tid/map-revision";

/**
 * ADR-0219 (K2): kartjobben i utskriftsarbetaren. Grundfilen läses med objektens källor, projektets ändrade objekt läggs
 * ovanpå (`editedObjects`, samma som editorn) och sedan svarar jobbet: översikt, bild, jämförelse, objektlista, normkontroll
 * eller förslagets ändringar. Ren kod utan I/O; canvasen kommer utifrån (`@napi-rs/canvas` i arbetaren, en falsk i testerna).
 */
export interface MapJobCanvas {
  readonly context: MapDrawingContext & { strokeRect(x: number, y: number, w: number, h: number): void; globalAlpha: number };
  png(): Uint8Array;
}
export type CreateMapJobCanvas = (width: number, height: number) => MapJobCanvas;

export interface StoredObjectRow { objectKey: string; ref: unknown; state: unknown; lastEditId: string }

export interface LoadedProjectMap {
  readonly base: ParsedMap;
  readonly baseSha256: string;
  /** Kartan med ändringarna (grundfilens objekt bytta eller borttagna, nya sist) och nyckeln för varje objekt. */
  readonly objects: readonly MapObject[];
  readonly keys: readonly ObjectKey[];
  readonly states: ReadonlyMap<ObjectKey, KeyedState & { lastEditId: string }>;
  readonly symbolsByCode: ReadonlyMap<string, MapSymbol>;
}

export interface Box { minX: number; minY: number; maxX: number; maxY: number }

const MAP_JOB_MAX_SIDE_PX = MCP_MAX_IMAGE_SIDE_PX, PROPOSAL_MAX_SIDE_M = MCP_PROPOSAL_MAX_SIDE_M, PROPOSAL_MAX_OPERATIONS = MCP_PROPOSAL_MAX_OPERATIONS;

export const symbolCode = (symbol: MapSymbol) => symbol.code.main > 0 ? `${symbol.code.main}${symbol.code.sub ? `.${symbol.code.sub}` : ""}` : "";

export function loadProjectMap(bytes: Uint8Array, fileName: string, baseSha256: string, rows: readonly StoredObjectRow[]): LoadedProjectMap {
  const base = readMapFile(bytes, fileName, { sources: true });
  const states = new Map<ObjectKey, KeyedState & { lastEditId: string }>();
  for (const row of rows) {
    const ref = row.ref === null ? null : parseObjectRef(row.ref) ?? null;
    if (!validState(row.state)) continue;
    states.set(row.objectKey, { ref, state: row.state, lastEditId: row.lastEditId });
  }
  const edited = editedObjects(base, states, baseKeys(base));
  const symbolsByCode = new Map<string, MapSymbol>();
  for (const symbol of base.symbols.values()) {
    const code = symbolCode(symbol);
    if (code && !symbol.hidden && !symbol.id.includes(".") && !symbolsByCode.has(code)) symbolsByCode.set(code, symbol);
  }
  return { base, baseSha256, objects: edited.objects, keys: edited.keys, states, symbolsByCode };
}

function objectsBox(objects: readonly MapObject[]): Box | undefined {
  let box: Box | undefined;
  for (const object of objects) {
    const b = objectBox(object);
    if (!Number.isFinite(b.minX)) continue;
    box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : { ...b };
  }
  return box;
}

const intersects = (a: Box, b: Box) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const metersPerMm = (map: ParsedMap) => map.scale / 1000;

/** Översikten: skala, storlek, georeferens, symbolerna som används och antalet ändringar. */
export function runOverview(loaded: LoadedProjectMap, area: readonly (readonly Point[])[] | null) {
  const { base } = loaded;
  const extent = objectsBox(loaded.objects) ?? (area ? objectsBox([{ kind: "area", symbol: "", rings: area.map(ring =>
    ring.map((point, index) => ({ type: index === 0 ? "M" as const : "L" as const, x: point.x, y: point.y }))), angle: 0 }]) : undefined);
  const counts = new Map<string, number>();
  for (const object of loaded.objects) counts.set(object.symbol, (counts.get(object.symbol) ?? 0) + 1);
  const symbols = [...base.symbols.values()].filter(symbol => !symbol.hidden && !symbol.id.includes(".") && symbolCode(symbol))
    .map(symbol => ({ code: symbolCode(symbol), name: symbol.name, kind: symbolObjectKind(base, symbol), count: counts.get(symbol.id) ?? 0 }))
    .sort((a, b) => Number(a.code) - Number(b.code));
  const georef = base.georeference;
  const center = extent && georef ? mapPointToWgs84(georef, { x: (extent.minX + extent.maxX) / 2, y: (extent.minY + extent.maxY) / 2 }) : null;
  const changed = [...loaded.states.values()].filter(value => value.state.kind !== "UNCHANGED").length;
  return {
    format: base.format, scale: base.scale, objects: loaded.objects.length, changedObjects: changed,
    units: "Koordinater i kartans mm med y uppåt (som i Mapper). 1 mm på kartan = " + metersPerMm(base) + " m i terrängen.",
    extentMm: extent ? roundBox(extent) : null,
    sizeMeters: extent ? { width: Math.round((extent.maxX - extent.minX) * metersPerMm(base)), height: Math.round((extent.maxY - extent.minY) * metersPerMm(base)) } : null,
    georeference: georef ? { crs: georef.crs.kind === "EPSG" ? `EPSG:${georef.crs.code}` : georef.crs.description,
      grivationDegrees: georef.grivationDegrees, centerWgs84: center ? { latitude: round(center.latitude, 6), longitude: round(center.longitude, 6) } : null } : null,
    symbols: symbols.filter(symbol => symbol.count > 0),
    unusedSymbols: symbols.filter(symbol => symbol.count === 0).map(symbol => `${symbol.code} ${symbol.name}`)
  };
}

const round = (value: number, decimals = 2) => Math.round(value * 10 ** decimals) / 10 ** decimals;
const roundBox = (box: Box): Box => ({ minX: round(box.minX), minY: round(box.minY), maxX: round(box.maxX), maxY: round(box.maxY) });

export interface RenderRequest { area?: Box | undefined; widthPx?: number | undefined; grid?: boolean | undefined; highlight?: readonly string[] | undefined;
  hideSymbols?: readonly string[] | undefined }

/** Bildens område: begärt, annars hela kartan; med en liten marginal och inom gränserna för bildens storlek. */
function viewOf(loaded: LoadedProjectMap, request: RenderRequest, area: readonly (readonly Point[])[] | null) {
  const extent = request.area ?? objectsBox(loaded.objects) ?? (area ? objectsBox([{ kind: "line", symbol: "", path: area.flat().map((point, index) =>
    ({ type: index === 0 ? "M" as const : "L" as const, x: point.x, y: point.y })) }]) : undefined) ?? { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  const width = Math.max(1, extent.maxX - extent.minX), height = Math.max(1, extent.maxY - extent.minY);
  const widthPx = Math.min(MAP_JOB_MAX_SIDE_PX, Math.max(200, Math.round(request.widthPx ?? 1200)));
  let pxPerMm = widthPx / width;
  if (height * pxPerMm > MAP_JOB_MAX_SIDE_PX) pxPerMm = MAP_JOB_MAX_SIDE_PX / height;
  return { extent, pxPerMm, width: Math.max(1, Math.round(width * pxPerMm)), height: Math.max(1, Math.round(height * pxPerMm)),
    origin: { x: extent.minX, y: extent.maxY } };
}

function drawInto(canvas: MapJobCanvas, map: ParsedMap, view: ReturnType<typeof viewOf>, hidden: ReadonlySet<string>) {
  drawMap(canvas.context, map, { pxPerMm: view.pxPerMm, origin: view.origin, cull: true, hiddenSymbols: hidden });
}

/** Rutnät var 10:e mm på kartan (fint var 5:e när det får plats) med mm-tal i kanten, så att Claude kan ange platser. */
function drawGrid(canvas: MapJobCanvas, view: ReturnType<typeof viewOf>, offsetX = 0) {
  const ctx = canvas.context;
  const step = view.pxPerMm * 10 < 40 ? (view.pxPerMm * 50 < 60 ? 100 : 50) : 10;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(220,0,120,0.55)";
  ctx.fillStyle = "rgba(220,0,120,0.95)";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.setLineDash([]);
  for (let x = Math.ceil(view.extent.minX / step) * step; x <= view.extent.maxX; x += step) {
    const px = offsetX + (x - view.origin.x) * view.pxPerMm;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, view.height); ctx.stroke();
    ctx.fillText(String(x), px + 2, 2);
  }
  for (let y = Math.ceil(view.extent.minY / step) * step; y <= view.extent.maxY; y += step) {
    const py = (view.origin.y - y) * view.pxPerMm;
    ctx.beginPath(); ctx.moveTo(offsetX, py); ctx.lineTo(offsetX + view.width, py); ctx.stroke();
    ctx.fillText(String(y), offsetX + 2, py + 2);
  }
  ctx.restore();
}

function hiddenIds(loaded: LoadedProjectMap, codes: readonly string[] | undefined): Set<string> {
  const hidden = new Set<string>();
  for (const code of codes ?? []) for (const symbol of loaded.base.symbols.values()) if (symbolCode(symbol) === code) hidden.add(symbol.id);
  return hidden;
}

export function runRender(loaded: LoadedProjectMap, request: RenderRequest, area: readonly (readonly Point[])[] | null, createCanvas: CreateMapJobCanvas) {
  const view = viewOf(loaded, request, area);
  const canvas = createCanvas(view.width, view.height);
  drawInto(canvas, { ...loaded.base, objects: [...loaded.objects] }, view, hiddenIds(loaded, request.hideSymbols));
  const highlighted = new Set(request.highlight ?? []);
  if (highlighted.size > 0) {
    const ctx = canvas.context;
    ctx.save();
    ctx.strokeStyle = "rgba(255,0,200,0.9)";
    ctx.lineWidth = 3;
    loaded.objects.forEach((object, index) => {
      if (!highlighted.has(loaded.keys[index]!)) return;
      const box = objectBox(object);
      const x = (box.minX - view.origin.x) * view.pxPerMm - 4, y = (view.origin.y - box.maxY) * view.pxPerMm - 4;
      ctx.strokeRect(x, y, (box.maxX - box.minX) * view.pxPerMm + 8, (box.maxY - box.minY) * view.pxPerMm + 8);
    });
    ctx.restore();
  }
  if (area) drawOutline(canvas, view, area);
  if (request.grid !== false) drawGrid(canvas, view);
  return { png: canvas.png(), meta: { areaMm: roundBox(view.extent), pxPerMm: round(view.pxPerMm, 3), widthPx: view.width, heightPx: view.height,
    metersPerPixel: round(metersPerMm(loaded.base) / view.pxPerMm, 3) } };
}

function drawOutline(canvas: MapJobCanvas, view: ReturnType<typeof viewOf>, area: readonly (readonly Point[])[], offsetX = 0) {
  const ctx = canvas.context;
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([10, 4]);
  ctx.beginPath();
  for (const ring of area) ring.forEach((point, index) => {
    const x = offsetX + (point.x - view.origin.x) * view.pxPerMm, y = (view.origin.y - point.y) * view.pxPerMm;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

/** Grundfilen till vänster och kartan med ändringarna till höger, i samma skala och med samma rutnät. */
export function runCompare(loaded: LoadedProjectMap, request: RenderRequest, area: readonly (readonly Point[])[] | null, createCanvas: CreateMapJobCanvas) {
  const view = viewOf(loaded, { ...request, widthPx: Math.min(MAP_JOB_MAX_SIDE_PX / 2, request.widthPx ?? 700) }, area);
  const gap = 12;
  const canvas = createCanvas(view.width * 2 + gap, view.height);
  const ctx = canvas.context;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, view.width * 2 + gap, view.height);
  const hidden = hiddenIds(loaded, request.hideSymbols);
  drawInto(canvas, loaded.base, view, hidden);
  if (request.grid !== false) drawGrid(canvas, view);
  ctx.save();
  ctx.translate(view.width + gap, 0);
  drawInto(canvas, { ...loaded.base, objects: [...loaded.objects] }, view, hidden);
  ctx.restore();
  if (area) drawOutline(canvas, view, area, view.width + gap);
  if (request.grid !== false) drawGrid(canvas, view, view.width + gap);
  return { png: canvas.png(), meta: { left: "grundfilen", right: "med projektets ändringar", areaMm: roundBox(view.extent),
    pxPerMm: round(view.pxPerMm, 3), widthPx: view.width * 2 + gap, heightPx: view.height } };
}

export interface ObjectsRequest { area?: Box | undefined; symbols?: readonly string[] | undefined; limit?: number | undefined; offset?: number | undefined }

/** Objekten (i området, med symbolerna): nyckel, symbol, slag, ruta och förenklad geometri (högst 40 punkter). */
export function runObjects(loaded: LoadedProjectMap, request: ObjectsRequest) {
  const codes = request.symbols && request.symbols.length > 0 ? new Set(request.symbols) : undefined;
  const limit = Math.min(500, Math.max(1, request.limit ?? 200)), offset = Math.max(0, request.offset ?? 0);
  const matches: { key: string; object: MapObject; symbol: MapSymbol | undefined; box: Box }[] = [];
  loaded.objects.forEach((object, index) => {
    const symbol = loaded.base.symbols.get(object.symbol);
    if (codes && (!symbol || !codes.has(symbolCode(symbol)))) return;
    const box = objectBox(object);
    if (request.area && !intersects(box, request.area)) return;
    matches.push({ key: loaded.keys[index]!, object, symbol, box });
  });
  return {
    total: matches.length, offset, returned: Math.min(limit, Math.max(0, matches.length - offset)),
    objects: matches.slice(offset, offset + limit).map(({ key, object, symbol, box }) => ({
      key, symbol: symbol ? symbolCode(symbol) : null, symbolName: symbol?.name ?? null, kind: object.kind,
      changed: loaded.states.has(key), boxMm: roundBox(box), ...geometrySummary(object)
    }))
  };
}

function geometrySummary(object: MapObject) {
  if (object.kind === "point") return { at: [round(object.at.x), round(object.at.y)], angle: round(object.angle, 1) };
  if (object.kind === "text") return { at: [round(object.at.x), round(object.at.y)], text: object.text.slice(0, 80) };
  const paths = object.kind === "line" ? [object.path] : object.rings;
  const points = paths.map(path => path.map(command => [round(command.x), round(command.y)]));
  const total = points.reduce((sum, path) => sum + path.length, 0);
  const step = Math.max(1, Math.ceil(total / 40));
  return { [object.kind === "line" ? "points" : "rings"]: object.kind === "line" ? points[0]!.filter((_, index) => index % step === 0)
    : points.map(ring => ring.filter((_, index) => index % step === 0)), vertices: total, curved: paths.some(path => path.some(command => command.type === "C")) };
}

/** Normens minsta storlek, ungefärliga värden för de vanligaste symbolgrupperna (mm² och mm på kartan, ISOM/ISSprOM). */
function minimumArea(code: string): number | undefined {
  const main = Number(code.split(".")[0]);
  if ([401, 403].includes(main)) return 2.0;
  if ([406, 408].includes(main)) return 1.0;
  if ([410, 411, 520, 521].includes(main)) return 0.5;
  if (main === 301 || main === 302 || main === 308 || main === 310) return 1.0;
  return undefined;
}

function polygonArea(points: readonly { x: number; y: number }[]): number {
  let sum = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    sum += point.x * next.y - next.x * point.y;
  });
  return Math.abs(sum) / 2;
}

/**
 * Den grundläggande normkontrollen (K2; den fullständiga kommer i K6): ytor och linjer under minsta storlek, linjer utan
 * längd, ytor med för få punkter, dubbletter (samma symbol och samma läge) och objekt med en symbol som inte finns i filen.
 */
export function runCheck(loaded: LoadedProjectMap, request: { area?: Box | undefined }) {
  const findings: { key: string; symbol: string | null; problem: string; atMm: [number, number] }[] = [];
  const seen = new Map<string, string>();
  loaded.objects.forEach((object, index) => {
    const key = loaded.keys[index]!;
    const box = objectBox(object);
    if (request.area && !intersects(box, request.area)) return;
    const symbol = loaded.base.symbols.get(object.symbol);
    const code = symbol ? symbolCode(symbol) : null;
    const at: [number, number] = [round((box.minX + box.maxX) / 2), round((box.minY + box.maxY) / 2)];
    if (!symbol) { findings.push({ key, symbol: null, problem: "Symbolen finns inte i kartfilen", atMm: at }); return; }
    if (object.kind === "area") {
      const outer = object.rings[0] ?? [];
      if (outer.length < 3) findings.push({ key, symbol: code, problem: "Ytan har färre än tre punkter", atMm: at });
      const area = polygonArea(outer) - object.rings.slice(1).reduce((sum, ring) => sum + polygonArea(ring), 0);
      const minimum = code ? minimumArea(code) : undefined;
      if (minimum !== undefined && area < minimum) {
        findings.push({ key, symbol: code, problem: `Ytan är ${round(area, 2)} mm², under normens ungefärliga minsta ${minimum} mm²`, atMm: at });
      }
    } else if (object.kind === "line") {
      let length = 0;
      for (let i = 1; i < object.path.length; i += 1) length += Math.hypot(object.path[i]!.x - object.path[i - 1]!.x, object.path[i]!.y - object.path[i - 1]!.y);
      if (length < 0.01) findings.push({ key, symbol: code, problem: "Linjen saknar längd", atMm: at });
      else if (length < 1.0 && code && !code.startsWith("1")) findings.push({ key, symbol: code, problem: `Linjen är ${round(length, 2)} mm, kortare än 1 mm`, atMm: at });
    }
    const fingerprint = `${object.symbol}|${JSON.stringify(geometrySummary(object))}`;
    const earlier = seen.get(fingerprint);
    if (earlier) findings.push({ key, symbol: code, problem: `Dubblett av ${earlier} (samma symbol och läge)`, atMm: at });
    else seen.set(fingerprint, key);
  });
  return { checked: "Grundläggande kontroll: minsta storlek (ungefärliga värden), tomma linjer och ytor, dubbletter och okända symboler. Den fullständiga normkontrollen kommer senare.",
    findings: findings.slice(0, 300), total: findings.length };
}

export type ProposalOperation =
  | { op: "add"; symbol: string; points: readonly (readonly [number, number])[]; angle?: number | undefined }
  | { op: "move"; key: string; dx: number; dy: number }
  | { op: "reshape"; key: string; points: readonly (readonly [number, number])[] }
  | { op: "change_symbol"; key: string; symbol: string }
  | { op: "delete"; key: string };

function translate(object: MapObject, dx: number, dy: number): MapObject {
  if (object.kind === "point" || object.kind === "text") return { ...object, at: { x: object.at.x + dx, y: object.at.y + dy } };
  const path = (commands: Path): Path => commands.map((command): PathCommand => command.type === "C"
    ? { ...command, x: command.x + dx, y: command.y + dy, x1: command.x1 + dx, y1: command.y1 + dy, x2: command.x2 + dx, y2: command.y2 + dy }
    : { ...command, x: command.x + dx, y: command.y + dy });
  return object.kind === "line" ? { ...object, path: path(object.path) } : { ...object, rings: object.rings.map(path) };
}

/**
 * Förslagets ändringar ur operationerna (`propose_changes`): varje operation blir en ändring med objektets källa och den
 * senaste ändringen den bygger på, som synken vill ha. Alla punkter (före och efter) ska rymmas inom 500 × 500 m.
 */
export function runPropose(loaded: LoadedProjectMap, operations: readonly ProposalOperation[], now: Date)
  : { status: "ok"; edits: RevisionEdit[] } | { status: "invalid"; errors: string[] } {
  const errors: string[] = [];
  if (operations.length === 0 || operations.length > PROPOSAL_MAX_OPERATIONS) {
    return { status: "invalid", errors: [`Ett förslag har 1–${PROPOSAL_MAX_OPERATIONS} operationer`] };
  }
  const index = new Map(loaded.keys.map((key, position) => [key, position]));
  const baseIndex = new Map(baseKeys(loaded.base).map((key, position) => [key, position]));
  const at = now.toISOString();
  const edits: RevisionEdit[] = [];
  const touched: MapObject[] = [];
  const used = new Set<string>();
  operations.forEach((operation, number) => {
    const where = `Operation ${number + 1} (${operation.op})`;
    if (operation.op === "add") {
      const symbol = loaded.symbolsByCode.get(operation.symbol);
      if (!symbol) { errors.push(`${where}: symbolen ${operation.symbol} finns inte i kartan`); return; }
      const kind = symbolObjectKind(loaded.base, symbol);
      if (kind === "text") { errors.push(`${where}: texter kan inte föreslås än`); return; }
      const object = newObject(kind, symbol.id, operation.points.map(([x, y]) => ({ x, y })));
      if (!object) { errors.push(`${where}: för få punkter för en ${kind === "area" ? "yta" : kind === "line" ? "linje" : "punkt"}`); return; }
      const placed = object.kind === "point" && operation.angle ? { ...object, angle: operation.angle } : object;
      touched.push(placed);
      edits.push({ editId: randomUUID(), key: newKey(randomUUID()), ref: null, base: null, kind: "ADD", state: { kind: "OBJECT", object: placed }, at });
      return;
    }
    if (used.has(operation.key)) { errors.push(`${where}: objektet ${operation.key} finns redan i förslaget`); return; }
    used.add(operation.key);
    const position = index.get(operation.key);
    if (position === undefined) { errors.push(`${where}: objektet ${operation.key} finns inte (eller är borttaget)`); return; }
    const current = loaded.objects[position]!;
    const stored = loaded.states.get(operation.key);
    const basePosition = baseIndex.get(operation.key);
    const ref = stored?.ref ?? (basePosition !== undefined ? objectRefFor(loaded.baseSha256, loaded.base.objects[basePosition]!) : null);
    if (operation.key.startsWith("b:") && !ref) { errors.push(`${where}: objektets källa saknas`); return; }
    const common = { editId: randomUUID(), key: operation.key, ref: operation.key.startsWith("b:") ? ref : null, base: stored?.lastEditId ?? null, at };
    touched.push(current);
    let next: MapObject | undefined;
    if (operation.op === "delete") {
      const box = objectBox(current);
      edits.push({ ...common, kind: "DELETE", state: { kind: "DELETED" }, point: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } });
      return;
    }
    if (operation.op === "move") next = translate(current, operation.dx, operation.dy);
    else if (operation.op === "change_symbol") {
      const symbol = loaded.symbolsByCode.get(operation.symbol);
      const kind = symbol ? symbolObjectKind(loaded.base, symbol) : undefined;
      if (!symbol || kind !== current.kind) { errors.push(`${where}: symbolen ${operation.symbol} finns inte eller passar inte objektet (${current.kind})`); return; }
      next = withSymbol(current, symbol.id);
    } else {
      if (current.kind === "text") { errors.push(`${where}: texter kan inte formas om`); return; }
      next = newObject(current.kind, current.symbol, operation.points.map(([x, y]) => ({ x, y })));
      if (next && current.kind === "point" && next.kind === "point") next = { ...next, angle: current.angle };
      if (!next) { errors.push(`${where}: för få punkter`); return; }
    }
    touched.push(next);
    edits.push({ ...common, kind: operation.op === "move" ? "MOVE" : operation.op === "change_symbol" ? "SYMBOL" : "RESHAPE", state: { kind: "OBJECT", object: next } });
  });
  const box = objectsBox(touched);
  const limitMm = PROPOSAL_MAX_SIDE_M / metersPerMm(loaded.base);
  if (box && (box.maxX - box.minX > limitMm || box.maxY - box.minY > limitMm)) {
    errors.push(`Förslaget täcker mer än ${PROPOSAL_MAX_SIDE_M} × ${PROPOSAL_MAX_SIDE_M} m; dela upp det`);
  }
  return errors.length > 0 ? { status: "invalid", errors } : { status: "ok", edits };
}
