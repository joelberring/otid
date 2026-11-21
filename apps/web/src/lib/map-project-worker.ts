/// <reference lib="webworker" />
import { drawMap, MapFileError, northLineDegrees, readMapFile, symbolColorIds, withColorChanges, withSymbolColorChanges, type MapObject, type MapSymbol, type ParsedMap } from "@o-tid/map-file";
import {
  baseKeys, checkNorm, combineGeneralize, coveredObjects, coverageGrid, generalizeJoins, generalizePart, generalizeParts, editedObjects, fitToMap, mapFitPoints, boxTest, hitTest, objectBox, objectRefFor, reconMarkers, symbolObjectKind, warpObjects, type Box, type GeneralizeResult, type KeyedState, type NormObject, type ObjectKey,
  type ObjectRef, type ReconObject
} from "@o-tid/map-revision";
import { MAX_RENDER_SIDE } from "./course-setting-map-protocol";
import { builtPolygons, FIELD_MAINS } from "@o-tid/map-revision/base-map";
import { proposeAreas } from "./map-project-area-proposals";
import { fillFinder } from "./map-project-fill-area";
import { buildSnapIndex, snapTransfer } from "./map-project-snap";
import { findUnfilled } from "./map-project-unfilled";
import { symbolGroup, type CatalogSymbol, type MapProjectRequest, type MapProjectResponse, type ProjectHit } from "./map-project-protocol";

/**
 * ADR-0219 (K1): kartprojektets karta i webbläsaren. Grundfilen läses en gång med objektens källor; projektets ändringar
 * (`states`) läggs ovanpå med `editedObjects` och kartan ritas med `drawMap` som annars (bara objekten i bild, rumsligt index
 * per version av kartan). Träffarna på kartan räknas här, så att sidan aldrig behöver hela kartan.
 */
declare const self: DedicatedWorkerGlobalScope;

const post = (message: MapProjectResponse, transfer: Transferable[] = []) => self.postMessage(message, transfer);

let base: ParsedMap | undefined;
let sha256 = "";
let keys: ObjectKey[] = [];
const refs = new Map<ObjectKey, ObjectRef>();
/** Kartan med ändringarna, nycklarna i samma ordning och objektens rutor (för träffarna). */
let current: { map: ParsedMap; keys: readonly ObjectKey[]; boxes: Box[] } | undefined;
let queued: Extract<MapProjectRequest, { type: "render" }> | undefined;
let drawing = false;

/** Filens egna färger (innan projektets ändrade färger lagts på) och de senaste lägena, för att bygga om när färgerna byts. */
let fileColors: ParsedMap["colors"] = [];
/** Symbolerna som i filen och projektets färgbyten per symbol (ägaren 2026-11-13). */
let fileSymbols: ParsedMap["symbols"] = new Map();
let lastStates: ReadonlyMap<ObjectKey, KeyedState> = new Map();
/** Skisslagren: objektens lagernamn från en DWG/DXF-import i Mapper (taggen `Layer`), per nyckel. */
const layerByKey = new Map<ObjectKey, string>();
/** Högst så många lagernamn per symbol i listan. */
const MAX_LAYERS = 60;

/** Grundkartan G2b: kandidaterna från en inläsning som en egen karta med samma symboler, ritad ovanpå kartan. */
let candidateObjects: readonly MapObject[] = [];
let candidateMap: ParsedMap | undefined;
const refreshCandidates = () => { candidateMap = base && candidateObjects.length ? { ...base, objects: [...candidateObjects] } : undefined; };

function rebuild(states: ReadonlyMap<ObjectKey, KeyedState>) {
  if (!base) return;
  lastStates = states;
  refreshCandidates();
  const edited = editedObjects(base, states, keys);
  current = { map: { ...base, objects: edited.objects }, keys: edited.keys, boxes: edited.objects.map(objectBox) };
}

/** Fyll yta: sökaren minns fönstrets ytor mellan frågorna (kartan med ändringarna är en ny lista efter varje ändring). */
const findFill = fillFinder();

/** Låsta och nedtonade lager ritas med så här stor andel av färgen. */
const DIMMED_TINT = 0.3;

function render(request: Extract<MapProjectRequest, { type: "render" }>) {
  if (!current) return;
  const width = Math.max(1, Math.min(MAX_RENDER_SIDE, Math.round(request.width)));
  const height = Math.max(1, Math.min(MAX_RENDER_SIDE, Math.round(request.height)));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) { post({ type: "error", code: "NO_CANVAS" }); return; }
  const hidden = new Set(request.hiddenSymbols ?? []);
  const dimmed = new Set((request.dimmedSymbols ?? []).filter(id => !hidden.has(id)));
  // Skisslagren: symboler som är dolda i kartfilen ritas bara när lagren säger det.
  const shown = request.shownSymbols?.length ? { showHiddenSymbols: new Set(request.shownSymbols) } : {};
  if (dimmed.size === 0) {
    drawMap(context, current.map, { pxPerMm: request.pxPerMm, origin: request.origin, cull: true, ...(hidden.size ? { hiddenSymbols: hidden } : {}), ...shown });
  } else {
    // Låsta lager nedtonade: först de nedtonade symbolerna (tonade, med papperet), sedan resten ovanpå utan papper.
    const others = new Set([...current.map.symbols.keys()].filter(id => !dimmed.has(id)));
    drawMap(context, current.map, { pxPerMm: request.pxPerMm, origin: request.origin, cull: true, hiddenSymbols: others, tint: DIMMED_TINT, ...shown });
    drawMap(context, current.map, { pxPerMm: request.pxPerMm, origin: request.origin, cull: true, background: false, hiddenSymbols: new Set([...hidden, ...dimmed]), ...shown });
  }
  // Kandidaterna med sina symboler, utan papper, ovanpå kartan (släckta symboler ritas inte).
  if (candidateMap) drawMap(context, candidateMap, { pxPerMm: request.pxPerMm, origin: request.origin, cull: true, background: false, ...(hidden.size ? { hiddenSymbols: hidden } : {}) });
  const bitmap = canvas.transferToImageBitmap();
  post({ type: "rendered", id: request.id, bitmap }, [bitmap]);
}

function drain() {
  if (drawing) return;
  drawing = true;
  setTimeout(() => {
    try {
      const next = queued;
      queued = undefined;
      if (next) render(next);
    } catch (error) {
      console.error("Kartan kunde inte ritas", error);
      post({ type: "error", code: "FAILED" });
    } finally {
      drawing = false;
      if (queued) drain();
    }
  }, 0);
}

const hex = (rgb: { r: number; g: number; b: number }) =>
  `#${[rgb.r, rgb.g, rgb.b].map(value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0")).join("")}`;

/** Förenklad stil för förhandsvisningen: huvudlinjens färg och bredd, ytans fyllning, punktens första färg. */
function previewStyle(map: ParsedMap, symbol: MapSymbol, depth = 0): Pick<CatalogSymbol, "stroke" | "width" | "fill"> {
  const color = (id: number | undefined) => {
    const found = id === undefined ? undefined : map.colors.find(row => row.id === id);
    return found ? hex(found.rgb) : undefined;
  };
  switch (symbol.kind) {
    case "LINE": {
      const main = [...symbol.strokes].sort((a, b) => b.width - a.width)[0];
      return { stroke: color(main?.color) ?? "#333333", width: main?.width ?? 0.2 };
    }
    case "AREA": return { fill: color(symbol.fill ?? symbol.hatches[0]?.color ?? symbol.pattern?.elements[0]?.color), stroke: color(symbol.border?.[0]?.color),
      width: symbol.border?.[0]?.width };
    case "POINT": return { fill: color(symbol.elements[0]?.color) ?? "#333333" };
    case "TEXT": return { fill: color(symbol.color) };
    case "COMBINED": {
      if (depth > 4) return {};
      const parts = symbol.parts.map(id => map.symbols.get(id)).filter((part): part is MapSymbol => !!part).map(part => previewStyle(map, part, depth + 1));
      return { fill: parts.find(part => part.fill)?.fill, stroke: parts.find(part => part.stroke)?.stroke, width: parts.find(part => part.width)?.width };
    }
  }
}

/** Bilden ritas i dubbel upplösning (skarp på täta skärmar) och visas i 32 px. */
const ICON_PX = 64;
/** Ägaren 2026-11-10: symbolen fyller rutan. Rutan är 5 mm av kartan (förut 8), så linjer och punktsymboler blir tydliga. */
const ICON_MM = 5;

/** Ett exempelobjekt för symbolens lilla bild: en böjd linje tvärs över rutan, en yta som fyller den, en punkt i mitten. */
function sample(kind: MapObject["kind"], symbol: string): MapObject | undefined {
  if (kind === "point") return { kind: "point", symbol, at: { x: 0, y: 0 }, angle: 0 };
  if (kind === "line") return { kind: "line", symbol, path: [{ type: "M", x: -2.3, y: -0.8 }, { type: "C", x1: -0.8, y1: 1.5, x2: 0.8, y2: -1.5, x: 2.3, y: 0.8 }] };
  if (kind === "area") return { kind: "area", symbol, angle: 0, rings: [[{ type: "M", x: -2.3, y: -2.3 }, { type: "L", x: 2.3, y: -2.3 },
    { type: "L", x: 2.3, y: 2.3 }, { type: "L", x: -2.3, y: 2.3 }]] };
  return undefined;
}

async function catalog(map: ParsedMap): Promise<CatalogSymbol[]> {
  const counts = new Map<string, number>();
  const layerCounts = new Map<string, Map<string, number>>();
  const objects = current?.map.objects ?? map.objects, objectKeys = current?.keys ?? keys;
  objects.forEach((object, index) => {
    counts.set(object.symbol, (counts.get(object.symbol) ?? 0) + 1);
    const layer = layerByKey.get(objectKeys[index]!);
    if (!layer) return;
    const perSymbol = layerCounts.get(object.symbol) ?? new Map<string, number>();
    perSymbol.set(layer, (perSymbol.get(layer) ?? 0) + 1);
    layerCounts.set(object.symbol, perSymbol);
  });
  const out: CatalogSymbol[] = [];
  for (const symbol of map.symbols.values()) {
    // Symboler som är dolda i filen och inte används är bara rester; de som används blir skisslager.
    if (symbol.hidden && !counts.get(symbol.id)) continue;
    const layers = [...(layerCounts.get(symbol.id) ?? [])].sort((a, b) => b[1] - a[1]).slice(0, MAX_LAYERS).map(([name, count]) => ({ name, count }));
    const kind = symbolObjectKind(map, symbol);
    let icon: Blob | undefined;
    const object = sample(kind, symbol.id);
    if (object) {
      try {
        const canvas = new OffscreenCanvas(ICON_PX, ICON_PX);
        const context = canvas.getContext("2d");
        if (context) {
          drawMap(context, { ...map, objects: [object] }, { pxPerMm: ICON_PX / ICON_MM, origin: { x: -ICON_MM / 2, y: ICON_MM / 2 }, background: false,
            ...(symbol.hidden ? { showHiddenSymbols: new Set([symbol.id]) } : {}) });
          icon = await canvas.convertToBlob({ type: "image/png" });
        }
      } catch { icon = undefined; }
    }
    out.push({ id: symbol.id, code: symbol.code.text, name: symbol.name, kind, group: symbolGroup(symbol.code.main), ...previewStyle(map, symbol), icon,
      count: counts.get(symbol.id) ?? 0, colors: symbolColorIds(fileSymbols, fileSymbols.get(symbol.id) ?? symbol),
      ...(symbol.hidden ? { fileHidden: true } : {}), ...(layers.length ? { layers } : {}) });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, "sv", { numeric: true }));
}

/** Normkontrollens och generaliseringens objekt: synliga symboler med linjebredden. */
function normRows(map: ParsedMap, keys: readonly ObjectKey[]): NormObject[] {
  const rows: NormObject[] = [];
  map.objects.forEach((object, index) => {
    const symbol = map.symbols.get(object.symbol);
    if (!symbol || symbol.hidden) return;
    const width = symbol.kind === "LINE" ? Math.max(0, ...symbol.strokes.map(stroke => stroke.width)) : 0;
    rows.push({ key: keys[index]!, code: symbol.code.text, object, ...(width > 0 ? { lineWidth: width } : {}) });
  });
  return rows;
}

/** Den senaste generaliseringen som begärts; en äldre som fortfarande räknas avbryts. */
let latestGeneralize = 0;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * K6 (ägaren 2026-11-15: «den verkar hänga sig … går den att dela upp i delar»): generaliseringen ruta för ruta
 * (`generalizeParts`), med förloppet efter varje ruta och en paus så att kartbilden kan ritas emellan. Ett fel ger ett svar
 * med felet i stället för tystnad (förut stod «Räknar …» kvar för alltid).
 */
async function runGeneralize(request: Extract<MapProjectRequest, { type: "generalize" }>) {
  const empty: GeneralizeResult = { changes: [], simplified: 0, pointsBefore: 0, pointsAfter: 0, removed: { SMALL_AREA: 0, SHORT_LINE: 0, SMALL_CLOSED: 0 } };
  if (!current) { post({ type: "generalize", id: request.id, result: empty, refs: [] }); return; }
  try {
    const map = current.map;
    const rows = normRows(map, current.keys);
    const parts = generalizeParts(rows, request.options);
    const taken = new Set<ObjectKey>();
    const results: GeneralizeResult[] = request.options.joinLines ? [generalizeJoins(rows, map.scale, request.options, taken)] : [];
    for (const [index, part] of parts.entries()) {
      if (request.id !== latestGeneralize) return;
      results.push(generalizePart(part, map.scale, request.options, taken));
      post({ type: "generalizeProgress", id: request.id, done: index + 1, total: parts.length });
      await pause();
    }
    if (request.id !== latestGeneralize) return;
    const result = combineGeneralize(results);
    post({ type: "generalize", id: request.id, result, refs: result.changes.flatMap(change => {
      const ref = refs.get(change.key);
      return ref ? [[change.key, ref] as const] : [];
    }) });
  } catch (error) {
    console.error("Generaliseringen kunde inte räknas", error);
    post({ type: "generalize", id: request.id, result: empty, refs: [], failed: true });
  }
}

self.onmessage = (event: MessageEvent<MapProjectRequest>) => {
  const request = event.data;
  if (request.type === "load") {
    try {
      base = readMapFile(new Uint8Array(request.bytes), request.fileName, { sources: true, layerTags: true });
    } catch (error) {
      if (error instanceof MapFileError) post({ type: "error", code: error.code });
      else { console.error("Kartfilen kunde inte läsas", error); post({ type: "error", code: "FAILED" }); }
      return;
    }
    fileColors = base.colors;
    fileSymbols = base.symbols;
    sha256 = request.sha256;
    keys = baseKeys(base);
    layerByKey.clear();
    base.objectLayers?.forEach((layer, index) => { if (layer) layerByKey.set(keys[index]!, layer); });
    refs.clear();
    base.objects.forEach((object, index) => {
      const ref = objectRefFor(sha256, object);
      if (ref) refs.set(keys[index]!, ref);
    });
    rebuild(new Map());
    const bounds = base.bounds ?? { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    post({ type: "loaded", bounds, scale: base.scale, georeference: base.georeference, colors: base.colors, objects: base.objects.length,
      northLines: northLineDegrees(base) });
    return;
  }
  if (request.type === "states") { rebuild(new Map(request.states)); return; }
  if (request.type === "candidates") { candidateObjects = request.objects; refreshCandidates(); return; }
  // Projektets ändrade färger (ägaren 2026-11-10): färgtabellen byts och kartan byggs om med samma objekt.
  if (request.type === "colors") { if (base) { base = { ...base, colors: withColorChanges(fileColors, request.changes) }; rebuild(lastStates); } return; }
  if (request.type === "symbolColors") {
    if (base) { base = { ...base, symbols: withSymbolColorChanges(fileSymbols, fileColors, request.changes) }; rebuild(lastStates); }
    return;
  }
  if (request.type === "render") { queued = request; drain(); return; }
  if (request.type === "hit" || request.type === "box") {
    const hits: ProjectHit[] = [];
    if (current) {
      const hidden = new Set(request.hidden);
      const symbols = hidden.size === 0 ? current.map.symbols
        : new Map([...current.map.symbols].map(([id, symbol]) => [id, hidden.has(id) ? { ...symbol, hidden: true } : symbol]));
      const objects = current.map.objects;
      const input = { objects, keys: current.keys, boxes: current.boxes, symbols };
      const found = request.type === "hit" ? hitTest(input, request.point, request.tolerance)
        : boxTest(input, request.box).map(key => ({ key, distance: 0 }));
      for (const candidate of found) {
        const index = current.keys.indexOf(candidate.key);
        const object = objects[index];
        if (!object) continue;
        // Källan i grundfilen följer inte med till sidan (bara referensen).
        const plain = { ...object, source: undefined } as MapObject;
        delete (plain as { source?: unknown }).source;
        hits.push({ key: candidate.key, ref: refs.get(candidate.key) ?? null, object: plain, distance: candidate.distance });
      }
    }
    post({ type: request.type, id: request.id, hits });
    return;
  }
  if (request.type === "fill") {
    post({ type: "fill", id: request.id, result: current
      ? findFill({ objects: current.map.objects, boxes: current.boxes, symbols: current.map.symbols, scale: current.map.scale }, request.query)
      : { status: "open", gaps: [] } });
    return;
  }
  if (request.type === "snapIndex") {
    const index = current ? buildSnapIndex(current.map.objects, current.keys, current.map.symbols) : null;
    post({ type: "snapIndex", id: request.id, index }, index ? snapTransfer(index) : []);
    return;
  }
  if (request.type === "unfilled") {
    if (!current) { post({ type: "unfilled", id: request.id, result: { status: "done", cells: [], count: 0 } }); return; }
    // Kartans yttre kant: rutan runt alla objekt (med ändringarna).
    const bounds = current.boxes.reduce<Box | undefined>((all, box) => all ? { minX: Math.min(all.minX, box.minX), minY: Math.min(all.minY, box.minY),
      maxX: Math.max(all.maxX, box.maxX), maxY: Math.max(all.maxY, box.maxY) } : box, undefined);
    post({ type: "unfilled", id: request.id, result: findUnfilled({ objects: current.map.objects, boxes: current.boxes, symbols: current.map.symbols,
      scale: current.map.scale, bounds }, request.query) });
    return;
  }
  if (request.type === "proposeAreas") {
    post({ type: "proposeAreas", id: request.id, result: current
      ? proposeAreas({ objects: current.map.objects, boxes: current.boxes, symbols: current.map.symbols, scale: current.map.scale }, request.query)
      : { status: "done", candidates: [], found: 0, filled: 0, small: 0 } });
    return;
  }
  if (request.type === "recon") {
    if (!current || !base) { post({ type: "recon", id: request.id, result: { markers: [], coverage: undefined } }); return; }
    const map = current.map;
    const objects: ReconObject[] = [];
    map.objects.forEach((object, index) => {
      const symbol = map.symbols.get(object.symbol);
      if (symbol && !symbol.hidden) objects.push({ key: current!.keys[index]!, code: symbol.code.text, object });
    });
    const markers = reconMarkers(objects, request.tracks, new Set(request.checked), request.settings, map.scale);
    // Täckningen över kartan och spåren.
    let coverage;
    const points = request.tracks.flat();
    if (points.length > 0) {
      const bounds = { ...(base.bounds ?? { minX: points[0]!.x, minY: points[0]!.y, maxX: points[0]!.x, maxY: points[0]!.y }) };
      for (const point of points) {
        bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
      }
      coverage = coverageGrid(request.tracks, bounds, request.settings, map.scale);
    }
    post({ type: "recon", id: request.id, result: { markers, coverage } }, coverage ? [coverage.cells.buffer] : []);
    return;
  }
  if (request.type === "bySymbol") {
    let objects = current ? current.map.objects.flatMap((object, index) => {
      if (object.symbol !== request.symbol) return [];
      const key = current!.keys[index]!;
      if (request.layer !== undefined && layerByKey.get(key) !== request.layer) return [];
      return [{ key, ref: refs.get(key) ?? null, object }];
    }) : [];
    // Skisslagren: det som redan är ritat med målsymbolen förs inte över en gång till.
    if (current && request.skipCoveredBy && objects.length) {
      const target = request.skipCoveredBy.symbol;
      const covered = coveredObjects(objects.map(row => row.object), current.map.objects.filter(object => object.symbol === target), request.skipCoveredBy.toleranceMm);
      objects = objects.filter((_, index) => !covered.has(index));
    }
    post({ type: "bySymbol", id: request.id, objects });
    return;
  }
  if (request.type === "fit") {
    // Kartans hus, vägar och vatten (med ändringarna) mot underlagets; tar ett par sekunder, därför här och inte i sidan.
    const fit = current ? fitToMap(request.source, mapFitPoints(current.map.objects, current.map.symbols)) ?? null : null;
    post({ type: "fit", id: request.id, fit });
    return;
  }
  if (request.type === "built") {
    const map = current?.map;
    const mainOf = (symbol: string) => map?.symbols.get(symbol)?.code.main;
    post({ type: "built", id: request.id, polygons: map ? builtPolygons(map.objects, mainOf) : [], fields: map ? builtPolygons(map.objects, mainOf, FIELD_MAINS) : [] });
    return;
  }
  if (request.type === "warp") {
    // K6b: alla objekt (eller de i rutan), också dolda symbolers, flyttas med passpunkternas transform; grundfilens referenser följer med.
    const objects = current ? current.map.objects.map((object, index) => ({ key: current!.keys[index]!, object })) : [];
    const { changes } = warpObjects(objects, request.options);
    post({ type: "warp", id: request.id, changes, refs: changes.flatMap(change => {
      const ref = refs.get(change.key);
      return ref ? [[change.key, ref] as const] : [];
    }) });
    return;
  }
  if (request.type === "norm") {
    if (!current) { post({ type: "norm", id: request.id, result: { standard: "ISOM", factor: 1, issues: [], truncated: false } }); return; }
    post({ type: "norm", id: request.id, result: checkNorm(normRows(current.map, current.keys), current.map.scale) });
    return;
  }
  if (request.type === "generalize") { latestGeneralize = request.id; void runGeneralize(request); return; }
  if (request.type === "catalog") {
    if (!base) { post({ type: "catalog", id: request.id, symbols: [] }); return; }
    catalog(base).then(symbols => post({ type: "catalog", id: request.id, symbols }), error => {
      console.error("Symbolerna kunde inte listas", error);
      post({ type: "catalog", id: request.id, symbols: [] });
    });
  }
};
