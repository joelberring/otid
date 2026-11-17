import { mapProjectOsmRequestSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { wgs84ToProjected } from "@o-tid/map-file";
import { validLaserBox } from "@o-tid/map-revision";
import { NMD_ATTRIBUTION } from "@o-tid/map-revision/base-map";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubProof } from "./club-access";
import { aiGate, sessionGate, type MapProjectGate } from "./map-project-access";
import { decodeRgbaPng } from "./map-project-job-labels";
import type { MapSourceFailure } from "./map-project-sources";

/**
 * Ägaren 2026-11-17 («kör NMD»): Naturvårdsverkets Nationella marktäckedata (NMD2023 v2.x, 10 m, CC0) för rutan. Tjänsten har
 * ingen WCS med data, bara en visningstjänst (WMS, GeoServer); varje klass har en egen färg i dess färgkarta (typen «values»),
 * så kartbilden i exakt 10 m per bildpunkt läses tillbaka till klasskoder med färgkartan (GetLegendGraphic som JSON). Prövat
 * 2026-11-17 för Gömmaren, Lida och Nåttarö: alla bildpunkter hade en färg ur färgkartan. Inget sparas här.
 */
export const DEFAULT_NMD_URL = "https://geodata.naturvardsverket.se/inspire/lc-nmd/ows";
export const NMD_LAYER = "LC.LandCoverRaster.Bas.2023.v2.x";
const CELL = 10;
/** GeoServers gräns för en bild är 2 048 bildpunkter; större rutor hämtas i delar. */
const TILE = 2000;
const FETCHES_PER_HOUR = 20;

export interface LandCoverRuntime { readonly url: string; readonly fetch?: typeof fetch; readonly timeoutMs?: number }
export function landCoverRuntimeFromEnvironment(environment: Record<string, string | undefined>): LandCoverRuntime {
  return { url: environment.OTID_NMD_URL?.trim() || DEFAULT_NMD_URL };
}

export interface LandCoverResult { readonly minX: number; readonly maxY: number; readonly cell: number; readonly width: number; readonly height: number;
  /** Klasskoderna (Uint16, little-endian, rad 0 i norr) som base64; 0 = ingen klass. */
  readonly codes: string; readonly unknown: number; readonly attribution: string }

/** Färgkartan ur GetLegendGraphic (JSON) som färg (#RRGGBB, versaler) till klasskod. */
export function nmdColorMap(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const legend = (json as { Legend?: { rules?: { symbolizers?: { Raster?: { colormap?: { entries?: { color?: unknown; quantity?: unknown }[] } } }[] }[] }[] } | null)?.Legend;
  for (const layer of Array.isArray(legend) ? legend : []) for (const rule of layer.rules ?? []) for (const symbolizer of rule.symbolizers ?? []) {
    for (const entry of symbolizer.Raster?.colormap?.entries ?? []) {
      const code = Number(entry.quantity);
      if (typeof entry.color === "string" && /^#[0-9a-f]{6}$/i.test(entry.color) && Number.isInteger(code) && code > 0 && code < 65_536) {
        // Två klasser kan dela färg (200 och 224 är båda öppen våtmark); den första vinner.
        if (!out.has(entry.color.toUpperCase())) out.set(entry.color.toUpperCase(), code);
      }
    }
  }
  return out;
}

/** Bildens bildpunkter som klasskoder med färgkartan; genomskinligt och okända färger blir 0. */
export function nmdCodes(rgba: Uint8Array, cells: number, colors: ReadonlyMap<string, number>): { codes: Uint16Array; unknown: number } {
  const codes = new Uint16Array(cells);
  let unknown = 0;
  for (let i = 0; i < cells; i += 1) {
    if (rgba[i * 4 + 3]! < 128) continue;
    const hex = `#${[rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    const code = colors.get(hex);
    if (code === undefined) unknown += 1; else codes[i] = code;
  }
  return { codes, unknown };
}

export async function fetchMapProjectLandCover(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: LandCoverRuntime,
  now = new Date()): Promise<LandCoverOutcome> {
  return fetchLandCover(db, sessionGate(input, now), input.request, runtime, now);
}
/** Samma hämtning för AI-kopplingen (kontot bakom den; inte när projektets AI-läge är bara läsa). */
export async function fetchMapProjectLandCoverAsAi(db: Database, input: { accountId: string; projectId: string; request: unknown }, runtime: LandCoverRuntime,
  now = new Date()): Promise<LandCoverOutcome> {
  return fetchLandCover(db, aiGate(input.accountId, input.projectId, now), input.request, runtime, now);
}
export type LandCoverOutcome = MapSourceFailure | ({ status: "ok" } & LandCoverResult);

async function fetchLandCover(db: Database, gate: MapProjectGate, request: unknown, runtime: LandCoverRuntime, now: Date): Promise<LandCoverOutcome> {
  const parsed = mapProjectOsmRequestSchema.safeParse(request);
  const allowed = await db.transaction(async tx => {
    const access = await gate(tx, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    if (!validLaserBox(parsed.data.box)) return { status: "too-large" } as const;
    if (!await consumeAccountRequestAllowance(tx, { scope: "MAP_SOURCE_ACCOUNT", key: access.accountId, limit: FETCHES_PER_HOUR, windowMs: 3_600_000 }, now)) {
      return { status: "throttled" } as const;
    }
    return { status: "ok" } as const;
  });
  if (allowed.status !== "ok") return allowed;
  return readLandCover(parsed.data!.box, runtime);
}

/** Hämtningen själv (utan behörighet), för rutan i latitud och longitud. Rutnätet följer NMD:s 10 m-rutor. */
export async function readLandCover(box: { south: number; west: number; north: number; east: number }, runtime: LandCoverRuntime): Promise<LandCoverOutcome> {
  const crs = { kind: "EPSG", code: 3006 } as const;
  const corners = [[box.south, box.west], [box.south, box.east], [box.north, box.west], [box.north, box.east]].map(([lat, lon]) => wgs84ToProjected(crs, lat!, lon!));
  const minX = Math.floor(Math.min(...corners.map(c => c.easting)) / CELL) * CELL, maxX = Math.ceil(Math.max(...corners.map(c => c.easting)) / CELL) * CELL;
  const minY = Math.floor(Math.min(...corners.map(c => c.northing)) / CELL) * CELL, maxY = Math.ceil(Math.max(...corners.map(c => c.northing)) / CELL) * CELL;
  const width = (maxX - minX) / CELL, height = (maxY - minY) / CELL;
  if (width <= 0 || height <= 0 || width * height > 25_000_000) return { status: "too-large" };
  const get = async (query: Record<string, string>) => {
    const url = new URL(runtime.url);
    url.search = new URLSearchParams({ service: "WMS", version: "1.3.0", ...query }).toString();
    return (runtime.fetch ?? fetch)(url.href, { headers: { "user-agent": "O-Tid kartprojekt" }, signal: AbortSignal.timeout(runtime.timeoutMs ?? 60_000), redirect: "error" });
  };
  try {
    const legend = await get({ request: "GetLegendGraphic", format: "application/json", layer: NMD_LAYER });
    if (!legend.ok) return { status: "unavailable", detail: `http-${legend.status}` };
    const colors = nmdColorMap(await legend.json());
    if (colors.size < 10) return { status: "unavailable", detail: "format" };
    const codes = new Uint16Array(width * height);
    let unknown = 0;
    for (let top = 0; top < height; top += TILE) for (let left = 0; left < width; left += TILE) {
      const w = Math.min(TILE, width - left), h = Math.min(TILE, height - top);
      const x0 = minX + left * CELL, y1 = maxY - top * CELL;
      // WMS 1.3.0 med EPSG:3006: axlarna i bbox är nord, öst.
      const response = await get({ request: "GetMap", layers: NMD_LAYER, styles: "", crs: "EPSG:3006", bbox: [y1 - h * CELL, x0, y1, x0 + w * CELL].join(","),
        width: String(w), height: String(h), format: "image/png", transparent: "true" });
      if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("image/png")) return { status: "unavailable", detail: `http-${response.status}` };
      const image = decodeRgbaPng(new Uint8Array(await response.arrayBuffer()));
      if (!image || image.width !== w || image.height !== h) return { status: "unavailable", detail: "format" };
      const tile = nmdCodes(image.data, w * h, colors);
      unknown += tile.unknown;
      for (let row = 0; row < h; row += 1) codes.set(tile.codes.subarray(row * w, row * w + w), (top + row) * width + left);
    }
    const bytes = Buffer.alloc(codes.length * 2);
    for (let i = 0; i < codes.length; i += 1) bytes.writeUInt16LE(codes[i]!, i * 2);
    return { status: "ok", minX, maxY, cell: CELL, width, height, codes: bytes.toString("base64"), unknown, attribution: NMD_ATTRIBUTION };
  } catch (error) {
    return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
}
