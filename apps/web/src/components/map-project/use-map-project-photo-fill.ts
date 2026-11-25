"use client";

import { useEffect, useRef, useState } from "react";
import type { Box } from "@o-tid/map-revision";
import { PHOTO_CELL_CLASSES, PHOTO_CLASS_CODES, PHOTO_CLASS_COLORS, PHOTO_CONFIDENT, type PhotoCellClass } from "@o-tid/map-revision/base-map";
import type { Point } from "@o-tid/map-file";
import { toMap, toScreen, type Viewport } from "../../lib/course-setting-viewport";
import { IR_LAYER_SUFFIX } from "../../lib/map-project-layer-file";
import { PHOTO_FILL_MARGIN_M, PHOTO_FILL_PIXEL_M, PHOTO_FILL_TILE_M, photoChangeList, photoMosaic, photoTiles, type PhotoCellView, type PhotoTile }
  from "../../lib/map-project-photo-fill";
import type { CatalogSymbol, MapProjectSession } from "../../lib/map-project-protocol";
import type { ObjectChange } from "./use-map-project-editor";
import type { useMapProjectLayers } from "./use-map-project-layers";

type Insertable = Exclude<PhotoCellClass, "unsure">;
/** Högsta antal etapper vid körning över hela kartan (hindrar låsning på korrupta eller jättestora gränser). */
const MAX_MAP_TILES = 64;
const LOAD_HIDDEN_WAIT_MS = 5000;
const LOAD_HIDDEN_POLL_MS = 50;
export type PhotoFillStatus = { readonly kind: "idle" } | { readonly kind: "busy"; readonly done: number; readonly total: number }
  | { readonly kind: "done"; readonly seconds: number; readonly km2: number } | { readonly kind: "problem"; readonly problem: "zoomIn" | "noView" | "noPhoto" | "notSaved" }
  | { readonly kind: "committed"; readonly count: number; readonly cut: number };

/** Kan rutan läggas in automatiskt (säker), eller efter bästa gissning när ägaren vill det (inte de stora och inte utan bild)? */
export function photoCellTaken(cell: PhotoCellView, takeUnsure: boolean): boolean {
  if (cell.guess === "unsure") return false;
  return cell.confidence >= PHOTO_CONFIDENT || (takeUnsure && cell.reason !== "large" && cell.reason !== "no-photo");
}

/**
 * Fyll ytor ur flygbilden (ägaren 2026-11-23): ortofotot (och IR-bilden) ritas för det synliga utsnittet eller för hela kartan i
 * etapper om `PHOTO_FILL_TILE_M` och skickas till kartans Worker, som räknar och klassar rutorna (`lib/map-project-photo-fill.ts`).
 * Utkastet ritas färgat på kartan (säkra fyllda, osäkra streckade); kryssrutor per klass och symbol, och «Lägg in» lägger ytorna
 * och klippningarna under dem som en ångringsbar grupp (förslag för den som bara får föreslå, som all redigering).
 */
export function useMapProjectPhotoFill(input: { session: MapProjectSession | undefined; layers: ReturnType<typeof useMapProjectLayers>;
  symbols: ReadonlyMap<string, CatalogSymbol>; hidden: readonly string[]; scale: number | undefined; bounds: Box | undefined;
  area: readonly (readonly Point[])[] | undefined; commitMany: (changes: readonly ObjectChange[]) => number }) {
  const { session, layers, symbols, scale } = input;
  const [cells, setCells] = useState<readonly PhotoCellView[]>([]);
  const [status, setStatus] = useState<PhotoFillStatus>({ kind: "idle" });
  const [includeGround, setIncludeGround] = useState(false);
  const [takeUnsure, setTakeUnsure] = useState(false);
  const [off, setOff] = useState<ReadonlySet<Insertable>>(new Set());
  const [chosen, setChosen] = useState<Partial<Record<Insertable, string>>>({});
  /** Utsnittet som kartan visar (sätts när kartan ritas). */
  const viewBox = useRef<Box | undefined>(undefined);
  const [ranBox, setRanBox] = useState<Box>();
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const photoTilesOf = (current: ReturnType<typeof useMapProjectLayers>) => {
    const byId = new Map(current.layers.map(row => [row.layerId, row.name]));
    const loadedPhotos = current.loaded.filter(row => byId.get(row.layerId)?.startsWith("Ortofoto"));
    return {
      expected: current.layers.filter(row => row.name.startsWith("Ortofoto")).length,
      photos: loadedPhotos,
      rgb: loadedPhotos.filter(row => !byId.get(row.layerId)!.endsWith(IR_LAYER_SUFFIX)) as PhotoTile[],
      ir: loadedPhotos.filter(row => byId.get(row.layerId)!.endsWith(IR_LAYER_SUFFIX)) as PhotoTile[]
    };
  };
  const { photos, ir: irTiles } = photoTilesOf(layers);
  const areaSymbols = [...symbols.values()].filter(symbol => symbol.kind === "area");
  /** Symbolerna att välja mellan per klass (de som finns i kartan) och den valda. */
  const options = (kind: Insertable) => PHOTO_CLASS_CODES[kind].flatMap(code => areaSymbols.filter(symbol => symbol.code === code));
  const symbolOf = (kind: Insertable) => { const list = options(kind); return list.find(symbol => symbol.id === chosen[kind]) ?? list[0]; };

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus({ kind: "idle" });
  }

  async function run(scope: "view" | "map") {
    if (!session || !scale) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    await Promise.resolve(layersRef.current.loadHidden());
    const deadline = Date.now() + LOAD_HIDDEN_WAIT_MS;
    while (!signal.aborted) {
      const current = photoTilesOf(layersRef.current);
      if (current.expected === 0 || current.photos.length >= current.expected || Date.now() >= deadline) break;
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, LOAD_HIDDEN_POLL_MS);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    if (signal.aborted) return;
    const { rgb: freshRgb, ir: freshIr } = photoTilesOf(layersRef.current);
    if (freshRgb.length === 0 && freshIr.length === 0) { setStatus({ kind: "problem", problem: "noPhoto" }); return; }
    const mmPerM = 1000 / scale, view = viewBox.current;
    let cores: Box[];
    if (scope === "view") {
      if (!view) { setStatus({ kind: "problem", problem: "noView" }); return; }
      if (Math.max(view.maxX - view.minX, view.maxY - view.minY) > PHOTO_FILL_TILE_M * 1.5 * mmPerM) { setStatus({ kind: "problem", problem: "zoomIn" }); return; }
      cores = [view];
    } else {
      cores = input.bounds ? photoTiles(input.bounds, scale) : [];
      if (cores.length > MAX_MAP_TILES) { setStatus({ kind: "problem", problem: "zoomIn" }); return; }
    }
    const started = performance.now(), found = new Map<string, PhotoCellView>();
    const step = PHOTO_FILL_PIXEL_M * mmPerM, margin = PHOTO_FILL_MARGIN_M * mmPerM;
    let zoomIn = false;
    setCells([]);
    for (let index = 0; index < cores.length; index += 1) {
      if (signal.aborted) return;
      setStatus({ kind: "busy", done: index + 1, total: cores.length });
      const core = cores[index]!, box = { minX: core.minX - margin, minY: core.minY - margin, maxX: core.maxX + margin, maxY: core.maxY + margin };
      // Utan färgbild klassas IR-bilden ensam som färgbild (sämre, men bättre än inget).
      const rgb = photoMosaic(freshRgb.length ? freshRgb : freshIr, box, step), ir = freshRgb.length && freshIr.length ? photoMosaic(freshIr, box, step) : undefined;
      if (!rgb) break;
      const result = await new Promise<Parameters<Parameters<MapProjectSession["photoCells"]>[1]>[0] | undefined>(resolve => {
        const onAbort = () => resolve(undefined);
        signal.addEventListener("abort", onAbort, { once: true });
        session.photoCells({ box, core, hidden: input.hidden, includeGround, area: input.area, rgb, ir }, value => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        });
      });
      if (signal.aborted || !result) return;
      if (result.status === "zoomIn") { zoomIn = true; continue; }
      for (const cell of result.cells) found.set(cell.id, cell);
      setCells([...found.values()]);
    }
    if (signal.aborted) return;
    if (abortRef.current === controller) abortRef.current = null;
    const km2 = cores.reduce((sum, core) => sum + (core.maxX - core.minX) * (core.maxY - core.minY), 0) / (mmPerM * mmPerM) / 1e6;
    setRanBox(cores.length === 1 ? cores[0] : input.bounds);
    setStatus(zoomIn && found.size === 0 ? { kind: "problem", problem: "zoomIn" } : { kind: "done", seconds: (performance.now() - started) / 1000, km2 });
  }

  /** Rutorna som läggs in: klassen ikryssad, symbolen finns och rutan är säker (eller osäker men tagen). */
  const taken = cells.filter(cell => cell.guess !== "unsure" && !off.has(cell.guess) && symbolOf(cell.guess) && photoCellTaken(cell, takeUnsure));

  function commit() {
    if (!session || taken.length === 0) return;
    const areas = taken.map(cell => ({ symbol: symbolOf(cell.guess as Insertable)!.id, rings: cell.rings }));
    session.photoCuts(areas, input.hidden, under => {
      const count = input.commitMany(photoChangeList(areas, under, () => crypto.randomUUID()));
      if (count === 0) { setStatus({ kind: "problem", problem: "notSaved" }); return; }
      setCells([]);
      setStatus({ kind: "committed", count: areas.length, cut: under.length });
    });
  }

  /** Utkastet ovanpå kartan: säkra rutor fyllda i klassens färg, osäkra och bortvalda streckade. Minns också utsnittet. */
  function draw(ctx: CanvasRenderingContext2D, current: Viewport) {
    const a = toMap(current, { x: 0, y: 0 }), b = toMap(current, { x: current.width, y: current.height });
    viewBox.current = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    if (cells.length === 0) return;
    const takenIds = new Set(taken.map(cell => cell.id));
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const cell of cells) {
      const on = takenIds.has(cell.id), color = PHOTO_CLASS_COLORS[on ? cell.guess : "unsure"];
      ctx.beginPath();
      for (const ring of cell.rings) ring.forEach((point, index) => {
        const at = toScreen(current, point);
        if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y);
        if (index === ring.length - 1) ctx.closePath();
      });
      ctx.globalAlpha = on ? 0.45 : 0.15; ctx.fillStyle = color; ctx.fill("evenodd");
      ctx.globalAlpha = 0.9; ctx.strokeStyle = color; ctx.setLineDash(on ? [] : [5, 4]); ctx.stroke();
    }
    ctx.restore();
  }

  const counts = PHOTO_CELL_CLASSES.map(kind => {
    const list = cells.filter(cell => cell.guess === kind && photoCellTaken(cell, takeUnsure));
    return { kind, count: list.length, areaM2: list.reduce((sum, cell) => sum + cell.areaM2, 0), on: !off.has(kind), options: options(kind), symbol: symbolOf(kind) };
  });
  const unsure = cells.filter(cell => !photoCellTaken(cell, takeUnsure));
  return {
    cells, status, taken: taken.length, counts, unsure: unsure.length, large: unsure.filter(cell => cell.reason === "large").length,
    infrared: irTiles.length > 0, hasPhoto: photos.length > 0, includeGround, setIncludeGround, takeUnsure, setTakeUnsure, ranBox,
    toggle: (kind: Insertable) => setOff(current => { const next = new Set(current); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; }),
    choose: (kind: Insertable, symbolId: string) => setChosen(current => ({ ...current, [kind]: symbolId })),
    run: (scope: "view" | "map") => { void run(scope); }, cancel, commit, clear: () => { cancel(); setCells([]); }, draw
  };
}
