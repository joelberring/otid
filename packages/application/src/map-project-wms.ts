import {
  WMS_MAX_TILES, WMS_TILE_MAX_PIXELS, mapProjectWmsCapabilitiesRequestSchema, mapProjectWmsImageRequestSchema, type MapProjectWmsCapabilitiesResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { wgs84ToProjected, isSupportedEpsg } from "@o-tid/map-file";
import { validOsmBox } from "@o-tid/map-revision";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubFailure, ClubProof } from "./club-access";
import { imageDimensions } from "./image-dimensions";
import { requireMapProject } from "./map-project-access";
import { PublicFetchError, publicFetch, validatePublicUrl, type PublicFetch, type PublicFetchReason } from "./public-fetch";
import { parseWmsCapabilities, type WmsCapabilities } from "./wms-capabilities";

/**
 * Ortofoto från valfri öppen WMS-tjänst (t.ex. en kommuns) som underlag. Förebilden är markfuktigheten (SLU), men adressen
 * anges av användaren, så all hämtning går genom `public-fetch.ts` (bara publika https-adresser). Servern svarar med en
 * bildruta och dess världsfil per anrop; webbläsaren hämtar rutorna en i taget och lägger dem som underlag. Inget sparas här.
 */
const REQUESTS_PER_HOUR = 20;
/** Bildruta nummer två och framåt räknas separat: en hämtning om 16 rutor ska inte tömma kvoten. */
const TILE_REQUESTS_PER_HOUR = 20 * WMS_MAX_TILES;
const CAPABILITIES_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_MAX_BYTES = 40 * 1024 * 1024;
const CAPABILITIES_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 60_000;
const CACHE_MS = 10 * 60_000;
const CACHE_SIZE = 50;

export type WmsProblem = "NOT_HTTPS" | "BAD_URL" | "PRIVATE_ADDRESS" | "UNREACHABLE" | "NOT_WMS" | "NO_LAYER" | "NO_SWEREF" | "IMAGE_TOO_LARGE"
  | "TOO_MANY_TILES" | "NO_FORMAT" | "NOT_IMAGE";
export type WmsFailure = ClubFailure | { status: "throttled" } | { status: "wms"; code: WmsProblem };

interface CacheEntry { readonly at: number; readonly capabilities: WmsCapabilities; version?: "1.3.0" | "1.1.1" }
export interface WmsRuntime { readonly fetch?: PublicFetch; readonly cache: Map<string, CacheEntry> }
const sharedCache = new Map<string, CacheEntry>();
export function wmsRuntime(): WmsRuntime { return { cache: sharedCache }; }

const URL_PROBLEMS: Readonly<Record<PublicFetchReason, WmsProblem>> = {
  "invalid-url": "BAD_URL", credentials: "BAD_URL", port: "BAD_URL", "not-https": "NOT_HTTPS", "private-address": "PRIVATE_ADDRESS",
  redirect: "UNREACHABLE", timeout: "UNREACHABLE", network: "UNREACHABLE", "too-large": "IMAGE_TOO_LARGE"
};
const problem = (code: WmsProblem): { status: "wms"; code: WmsProblem } => ({ status: "wms", code });
const problemOf = (error: unknown): WmsProblem => error instanceof PublicFetchError ? URL_PROBLEMS[error.reason] : "UNREACHABLE";

/** Tjänstens adress med frågeparametrarna vi själva sätter borttagna (en adress kan ha egna, t.ex. `?map=…`). */
function requestUrl(base: URL, parameters: Record<string, string>): string {
  const url = new URL(base);
  const ours = new Set(Object.keys(parameters).map(key => key.toLowerCase()));
  for (const key of [...url.searchParams.keys()]) if (ours.has(key.toLowerCase()) || /^(service|request|version|transparent|exceptions)$/i.test(key)) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.toString();
}

async function readCapabilities(base: URL, runtime: WmsRuntime): Promise<WmsCapabilities | WmsProblem> {
  const fetcher = runtime.fetch ?? publicFetch;
  // 1.3.0 först; ett svar som inte är en lagerlista (eller ett fel från tjänsten) ger ett nytt försök med 1.1.1.
  for (const version of ["1.3.0", "1.1.1"] as const) {
    try {
      const response = await fetcher(requestUrl(base, { SERVICE: "WMS", REQUEST: "GetCapabilities", VERSION: version }),
        { timeoutMs: CAPABILITIES_TIMEOUT_MS, maxBytes: CAPABILITIES_MAX_BYTES });
      const parsed = response.status === 200 ? parseWmsCapabilities(new TextDecoder().decode(response.body)) : undefined;
      if (parsed) return parsed;
    } catch (error) {
      if (error instanceof PublicFetchError && error.reason === "too-large") return "NOT_WMS";
      return problemOf(error);
    }
  }
  return "NOT_WMS";
}

async function capabilitiesFor(rawUrl: string, runtime: WmsRuntime, now: number): Promise<{ base: URL; entry: CacheEntry } | WmsProblem> {
  const checked = validatePublicUrl(rawUrl);
  if (!checked.ok) return URL_PROBLEMS[checked.reason];
  const key = checked.url.toString();
  const cached = runtime.cache.get(key);
  if (cached && now - cached.at < CACHE_MS) return { base: checked.url, entry: cached };
  const capabilities = await readCapabilities(checked.url, runtime);
  if (typeof capabilities === "string") return capabilities;
  if (runtime.cache.size >= CACHE_SIZE) runtime.cache.delete(runtime.cache.keys().next().value!);
  const entry: CacheEntry = { at: now, capabilities };
  runtime.cache.set(key, entry);
  return { base: checked.url, entry };
}

/** Koordinatsystemet att hämta i: SWEREF 99 TM, annars kartans eget (om O-Tid kan räkna det), annars inget. */
function pickEpsg(codes: ReadonlySet<number>, mapEpsg: number | undefined): number | null {
  if (codes.has(3006)) return 3006;
  return mapEpsg !== undefined && codes.has(mapEpsg) && isSupportedEpsg(mapEpsg) ? mapEpsg : null;
}

export type WmsAccess = { status: "ok"; accountId: string } | WmsFailure;

/** Behörighet (den som får föreslå i ett öppet projekt) och kvot; `request` prövas av anroparen efter dem. */
async function allowed(db: Database, input: ClubProof & { projectId: string }, now: Date, check: () => WmsFailure | undefined, key: (accountId: string) => string,
  limit: number): Promise<WmsAccess> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    const failure = check();
    if (failure) return failure;
    if (!await consumeAccountRequestAllowance(tx, { scope: "MAP_SOURCE_ACCOUNT", key: key(access.accountId), limit, windowMs: 3_600_000 }, now)) {
      return { status: "throttled" } as const;
    }
    return { status: "ok", accountId: access.accountId } as const;
  });
}

/** GetCapabilities för adressen: tjänstens titel och lagren med namn. */
export async function readMapProjectWmsCapabilities(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: WmsRuntime,
  now = new Date()): Promise<WmsFailure | { status: "ok"; response: MapProjectWmsCapabilitiesResponse }> {
  const parsed = mapProjectWmsCapabilitiesRequestSchema.safeParse(input.request);
  const gate = await allowed(db, input, now, () => {
    if (!parsed.success) return { status: "invalid-request" };
    const checked = validatePublicUrl(parsed.data.url);
    return checked.ok ? undefined : problem(URL_PROBLEMS[checked.reason]);
  }, accountId => accountId, REQUESTS_PER_HOUR);
  if (gate.status !== "ok") return gate;
  const found = await capabilitiesFor(parsed.data!.url, runtime, now.getTime());
  if (typeof found === "string") return problem(found);
  const { capabilities } = found.entry;
  const layers = capabilities.layers.map(layer => ({ name: layer.name, title: layer.title, epsg: pickEpsg(layer.epsgCodes, parsed.data!.mapEpsg) }));
  if (!layers.some(layer => layer.epsg !== null)) return problem("NO_SWEREF");
  return { status: "ok", response: { formatVersion: 1, title: capabilities.title, version: capabilities.version, formats: [...capabilities.formats], layers } };
}

export interface WmsTile {
  readonly index: number; readonly minE: number; readonly minN: number; readonly maxE: number; readonly maxN: number;
  readonly width: number; readonly height: number; readonly world: string;
}

/**
 * Rutan i `epsg` (metriskt) och bildrutorna för den: pixlarna är exakt `metersPerPixel` stora och rutnätet börjar i övre
 * vänstra hörnet; en bildruta är högst `maxSide` pixlar på sidan. Fler än `WMS_MAX_TILES` rutor ger `undefined`.
 * Världsfilen pekar på mitten av första pixeln.
 */
export function wmsTilePlan(box: { south: number; west: number; north: number; east: number }, epsg: number, metersPerPixel: number,
  maxSide = WMS_TILE_MAX_PIXELS): readonly WmsTile[] | undefined {
  const crs = { kind: "EPSG" as const, code: epsg };
  const corners = [[box.south, box.west], [box.south, box.east], [box.north, box.west], [box.north, box.east]].map(([lat, lon]) => wgs84ToProjected(crs, lat!, lon!));
  const minE = Math.floor(Math.min(...corners.map(c => c.easting))), maxE = Math.ceil(Math.max(...corners.map(c => c.easting)));
  const minN = Math.floor(Math.min(...corners.map(c => c.northing))), maxN = Math.ceil(Math.max(...corners.map(c => c.northing)));
  const side = Math.max(16, Math.min(maxSide, WMS_TILE_MAX_PIXELS));
  const totalWidth = Math.max(1, Math.ceil((maxE - minE) / metersPerPixel)), totalHeight = Math.max(1, Math.ceil((maxN - minN) / metersPerPixel));
  const columns = Math.ceil(totalWidth / side), rows = Math.ceil(totalHeight / side);
  if (columns * rows > WMS_MAX_TILES) return undefined;
  const round = (value: number) => Number(value.toFixed(4));
  const tiles: WmsTile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const width = Math.min(side, totalWidth - column * side), height = Math.min(side, totalHeight - row * side);
      const west = round(minE + column * side * metersPerPixel), north = round(maxN - row * side * metersPerPixel);
      const east = round(west + width * metersPerPixel), south = round(north - height * metersPerPixel);
      tiles.push({ index: tiles.length, minE: west, minN: south, maxE: east, maxN: north, width, height,
        world: [metersPerPixel, 0, 0, -metersPerPixel, round(west + metersPerPixel / 2), round(north - metersPerPixel / 2)].join("\n") + "\n" });
    }
  }
  return tiles;
}

/** EPSG-koder där WMS 1.3.0 har axelordningen nord, öst (SWEREF 99 TM och de lokala systemen, RT 90). */
const northingFirst = (epsg: number) => epsg === 3006 || (epsg >= 3007 && epsg <= 3018) || epsg === 3021 || epsg === 3847;

export interface WmsImage { readonly image: Uint8Array; readonly mediaType: "image/png" | "image/jpeg"; readonly world: string; readonly crs: number; readonly tile: number; readonly tiles: number }

/** En bildruta av ortofotot för kartans ruta eller en etapp, med världsfil (se `wmsTilePlan`). */
export async function fetchMapProjectWmsImage(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: WmsRuntime,
  now = new Date()): Promise<WmsFailure | ({ status: "ok" } & WmsImage)> {
  const parsed = mapProjectWmsImageRequestSchema.safeParse(input.request);
  const gate = await allowed(db, input, now, () => {
    if (!parsed.success) return { status: "invalid-request" };
    if (!validOsmBox(parsed.data.box)) return problem("TOO_MANY_TILES");
    const checked = validatePublicUrl(parsed.data.url);
    return checked.ok ? undefined : problem(URL_PROBLEMS[checked.reason]);
  }, accountId => parsed.data?.tile ? `${accountId}:tiles` : accountId, parsed.data?.tile ? TILE_REQUESTS_PER_HOUR : REQUESTS_PER_HOUR);
  if (gate.status !== "ok") return gate;
  const request = parsed.data!;
  const found = await capabilitiesFor(request.url, runtime, now.getTime());
  if (typeof found === "string") return problem(found);
  const { capabilities } = found.entry;
  const layer = capabilities.layers.find(row => row.name === request.layer);
  if (!layer) return problem("NO_LAYER");
  const epsg = pickEpsg(layer.epsgCodes, request.mapEpsg);
  if (epsg === null) return problem("NO_SWEREF");
  const format = capabilities.formats.find(row => /^image\/jpe?g$/i.test(row)) ?? capabilities.formats.find(row => /^image\/png$/i.test(row))
    ?? (capabilities.formats.length === 0 ? "image/jpeg" : undefined);
  if (!format) return problem("NO_FORMAT");
  const plan = wmsTilePlan(request.box, epsg, request.metersPerPixel, capabilities.maxSide);
  if (!plan) return problem("TOO_MANY_TILES");
  const tile = plan[request.tile];
  if (!tile) return { status: "invalid-request" };
  // 1.1.1 först (BBOX är alltid öst, nord); finns bara 1.3.0 gäller axelordningen för koordinatsystemet. Den version som lyckades kommer ihåg.
  const versions = found.entry.version ? [found.entry.version] : capabilities.version === "1.3.0" ? ["1.1.1", "1.3.0"] as const : ["1.1.1"] as const;
  let lastProblem: WmsProblem = "NOT_IMAGE";
  for (const version of versions) {
    const flipped = version === "1.3.0" && northingFirst(epsg);
    const bbox = (flipped ? [tile.minN, tile.minE, tile.maxN, tile.maxE] : [tile.minE, tile.minN, tile.maxE, tile.maxN]).join(",");
    const url = requestUrl(found.base, { SERVICE: "WMS", VERSION: version, REQUEST: "GetMap", LAYERS: request.layer, STYLES: "", [version === "1.3.0" ? "CRS" : "SRS"]: `EPSG:${epsg}`,
      BBOX: bbox, WIDTH: String(tile.width), HEIGHT: String(tile.height), FORMAT: format, EXCEPTIONS: version === "1.3.0" ? "XML" : "application/vnd.ogc.se_xml" });
    try {
      const response = await (runtime.fetch ?? publicFetch)(url, { timeoutMs: IMAGE_TIMEOUT_MS, maxBytes: IMAGE_MAX_BYTES });
      const image = response.status === 200 ? imageDimensions(response.body) : undefined;
      if (!image || image.width !== tile.width || image.height !== tile.height) { lastProblem = "NOT_IMAGE"; continue; }
      found.entry.version = version;
      return { status: "ok", image: response.body, mediaType: image.mediaType, world: tile.world, crs: epsg, tile: tile.index, tiles: plan.length };
    } catch (error) {
      return problem(problemOf(error));
    }
  }
  return problem(lastProblem);
}
