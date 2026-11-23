import type { MapObject, MapSymbol, Point } from "@o-tid/map-file";
import { newKey, type Box, type MapNorm, type ObjectKey, type ObjectRef } from "@o-tid/map-revision";
import { classifyPhotoCell, photoCellStats, photoFillArea, photoFillCells, photoFillCuts, type PhotoCellClass, type PhotoRaster } from "@o-tid/map-revision/base-map";
import type { FillChange } from "./map-project-fill-over";
import type { UnderChange } from "./map-project-fill-under";

/**
 * Fyll ytor ur flygbilden (ägaren 2026-11-23: «skulle man kunna använda flygbildanalys med AI för att förstå vilka ytor som är
 * vägar/hårdgjord mark?»). Sidan ritar ortofotot (och IR-bilden när den finns) för en ruta till en bild i kartans mm och skickar
 * den till kartans Worker, som räknar rutorna med samma ytmotor som Fyll över (`photoFillCells`) och klassar varje ruta ur
 * bildpunkterna (`classifyPhotoCell`). Inläggningen klipper grundkartans markytor under alla valda rutor på en gång och rensar
 * under hårdgjord yta (`photoFillCuts`), som en ångringsbar grupp.
 */
/** Största rutan som räknas i ett svep (m åt varje håll); hela kartan tas i etapper om så stora rutor. */
export const PHOTO_FILL_TILE_M = 400;
/** Etappernas marginal (m): rutor som når ut i den räknas i nästa etapp. */
export const PHOTO_FILL_MARGIN_M = 120;
/** Bildpunktens storlek (m), som Lantmäteriets ortofoto; klassningens textur är ställd för den. */
export const PHOTO_FILL_PIXEL_M = 0.25;

export interface PhotoCellsQuery {
  /** Rutan som räknas (med marginal) och etappens kärna (kartans mm). */
  readonly box: Box; readonly core: Box;
  readonly hidden: readonly string[]; readonly includeGround: boolean;
  readonly area?: readonly (readonly Point[])[] | undefined;
  readonly rgb: PhotoRaster; readonly ir?: PhotoRaster | undefined;
}

export interface PhotoCellView {
  readonly id: string; readonly rings: Point[][]; readonly at: Point; readonly areaM2: number;
  readonly state: "empty" | "ground"; readonly groundCodes: readonly string[];
  readonly guess: PhotoCellClass; readonly confidence: number; readonly reason: string;
}

export type PhotoCellsResult = { readonly status: "done"; readonly cells: PhotoCellView[] } | { readonly status: "zoomIn" };

interface WorkerMap { readonly objects: readonly MapObject[]; readonly boxes: readonly Box[]; readonly symbols: ReadonlyMap<string, MapSymbol>; readonly scale: number; readonly norm: MapNorm }

/** I Workern: rutorna i frågans ruta, klassade. */
export function photoCells(map: WorkerMap, query: PhotoCellsQuery): PhotoCellsResult {
  const cells = photoFillCells(map, query.box, { hidden: new Set(query.hidden), includeGround: query.includeGround, core: query.core, area: query.area });
  if (!cells) return { status: "zoomIn" };
  return { status: "done", cells: cells.map(cell => ({ ...cell, ...classifyPhotoCell(photoCellStats(query.rgb, cell.rings, query.ir), cell.areaM2) })) };
}

/** I Workern: det som ändras under de valda rutorna (nycklar och referenser som Fyll över). */
export function photoCuts(map: WorkerMap & { readonly keys: readonly ObjectKey[]; readonly refs: ReadonlyMap<ObjectKey, ObjectRef> },
  cells: readonly { readonly rings: readonly (readonly Point[])[]; readonly symbol: string }[], hidden: readonly string[]): UnderChange[] {
  return photoFillCuts(map, cells, new Set(hidden)).map(cut => {
    const key = map.keys[cut.index]!;
    return { key, ref: map.refs.get(key) ?? null, objects: cut.objects };
  });
}

/**
 * De nya ytorna och det som ändras under dem som en grupp (Ångra tar allt på en gång): ytorna läggs till, och ett klippt objekt
 * ändras (första delen), tas bort (inga delar) eller får fler delar.
 */
export function photoChangeList(areas: readonly { readonly symbol: string; readonly rings: readonly (readonly Point[])[] }[], under: readonly UnderChange[],
  id: () => string): FillChange[] {
  const group = id(), point = areas[0]?.rings[0]?.[0];
  const changes: FillChange[] = areas.map(area => ({ key: newKey(id()), ref: null, kind: "ADD", after: { kind: "OBJECT", object: photoFillArea(area.symbol, area.rings) }, group }));
  for (const change of under) {
    const [first, ...rest] = change.objects;
    changes.push(first ? { key: change.key, ref: change.ref, kind: "RESHAPE", after: { kind: "OBJECT", object: first }, group }
      : { key: change.key, ref: change.ref, kind: "DELETE", after: { kind: "DELETED" }, point, group });
    for (const object of rest) changes.push({ key: newKey(id()), ref: null, kind: "ADD", after: { kind: "OBJECT", object }, group });
  }
  return changes;
}

/** Etapperna (kärnor) som täcker `bounds`, högst `PHOTO_FILL_TILE_M` i sida (kartans mm). */
export function photoTiles(bounds: Box, scale: number): Box[] {
  const side = PHOTO_FILL_TILE_M * 1000 / scale, tiles: Box[] = [];
  for (let x = bounds.minX; x < bounds.maxX; x += side) for (let y = bounds.maxY; y > bounds.minY; y -= side) {
    tiles.push({ minX: x, minY: Math.max(bounds.minY, y - side), maxX: Math.min(bounds.maxX, x + side), maxY: y });
  }
  return tiles;
}

/** Ett underlag som bild: bildens pixlar (mitten) → kartans mm (som `DrawnLayer`). */
export interface PhotoTile { readonly image: CanvasImageSource & { readonly width: number; readonly height: number };
  readonly toMap: { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number };
  /** Bildens storlek i underlaget när den lästs nedskalad. */
  readonly size?: { readonly width: number; readonly height: number } | undefined }

/** Bildrutorna ritade i en bild över `box` med `step` mm per bildpunkt (y nedåt), eller undefined utan canvas. */
export function photoMosaic(tiles: readonly PhotoTile[], box: Box, step: number): PhotoRaster | undefined {
  const width = Math.max(1, Math.ceil((box.maxX - box.minX) / step)), height = Math.max(1, Math.ceil((box.maxY - box.minY) / step));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  for (const { image, toMap, size } of tiles) {
    context.setTransform(toMap.a / step, -toMap.d / step, toMap.b / step, -toMap.e / step, (toMap.c - box.minX) / step, (box.maxY - toMap.f) / step);
    if (size) context.drawImage(image, -0.5, -0.5, size.width, size.height); else context.drawImage(image, -0.5, -0.5);
  }
  const data = context.getImageData(0, 0, width, height).data;
  return { width, height, data, minX: box.minX, maxY: box.maxY, step };
}
