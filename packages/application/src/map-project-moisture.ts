import { mapProjectOsmRequestSchema as moistureRequestSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { wgs84ToProjected } from "@o-tid/map-file";
import { validOsmBox } from "@o-tid/map-revision";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubFailure, ClubProof } from "./club-access";
import { imageDimensions } from "./image-dimensions";
import { requireMapProject } from "./map-project-access";

/**
 * ADR-0219 K5c (del 1): SLU:s markfuktighetskarta (Skogsstyrelsens öppna WMS, 2 m) som underlag, för att hitta våtmarker och
 * fuktstråk. Servern hämtar bilden för rutan i SWEREF 99 TM (inga CORS-problem i webbläsaren) och svarar med bilden och dess
 * världsfil; webbläsaren lägger den som ett underlag (K4a). Inget sparas här.
 */
export const DEFAULT_SLU_MOISTURE_WMS = "https://geodata.skogsstyrelsen.se/arcgis/services/Publikt/Markfuktighet_SLU_2_0/ImageServer/WMSServer";
export const MOISTURE_ATTRIBUTION = "Markfuktighetskarta SLU (Skogsstyrelsen)";
const FETCHES_PER_HOUR = 20;
/** Rastrets upplösning (2 m) och bildens största sida. */
const METERS_PER_PIXEL = 2;
const MAX_PIXELS = 4000;
const MAX_BYTES = 40 * 1024 * 1024;

export interface MoistureRuntime { readonly wmsUrl: string; readonly layer: string | undefined; readonly fetch?: typeof fetch }
export function moistureRuntimeFromEnvironment(environment: Record<string, string | undefined>): MoistureRuntime {
  return { wmsUrl: environment.OTID_SLU_MOISTURE_WMS_URL?.trim() || DEFAULT_SLU_MOISTURE_WMS, layer: environment.OTID_SLU_MOISTURE_LAYER?.trim() || undefined };
}

export type MoistureFailure = ClubFailure | { status: "too-large" } | { status: "throttled" } | { status: "unavailable"; detail: string };

/** Rutan i SWEREF 99 TM och bildens storlek (2 m per pixel, högst 4000 pixel åt något håll). */
export function moistureRequestBox(box: { south: number; west: number; north: number; east: number }) {
  const crs = { kind: "EPSG" as const, code: 3006 };
  const corners = [[box.south, box.west], [box.south, box.east], [box.north, box.west], [box.north, box.east]]
    .map(([lat, lon]) => wgs84ToProjected(crs, lat!, lon!));
  const minE = Math.floor(Math.min(...corners.map(c => c.easting))), maxE = Math.ceil(Math.max(...corners.map(c => c.easting)));
  const minN = Math.floor(Math.min(...corners.map(c => c.northing))), maxN = Math.ceil(Math.max(...corners.map(c => c.northing)));
  const meters = Math.max(METERS_PER_PIXEL, (Math.max(maxE - minE, maxN - minN)) / MAX_PIXELS);
  const width = Math.max(1, Math.round((maxE - minE) / meters)), height = Math.max(1, Math.round((maxN - minN) / meters));
  const a = (maxE - minE) / width, e = -(maxN - minN) / height;
  // Världsfilen pekar på mitten av första pixeln.
  return { minE, minN, maxE, maxN, width, height, world: [a, 0, 0, e, minE + a / 2, maxN + e / 2].join("\n") + "\n" };
}

const layerNames = new Map<string, string>();
/** Första lagrets namn ur tjänstens GetCapabilities (sparas tills servern startas om). */
async function layerName(runtime: MoistureRuntime): Promise<string | undefined> {
  if (runtime.layer) return runtime.layer;
  const cached = layerNames.get(runtime.wmsUrl);
  if (cached) return cached;
  const response = await (runtime.fetch ?? fetch)(`${runtime.wmsUrl}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1`, { redirect: "error",
    signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return undefined;
  const text = (await response.text()).slice(0, 2_000_000);
  // Lagren med namn (det första är oftast hela tjänsten utan namn).
  const name = /<Layer[^>]*>\s*<Name>([^<]{1,100})<\/Name>/.exec(text)?.[1]?.trim();
  if (name) layerNames.set(runtime.wmsUrl, name);
  return name;
}

/** Markfuktighetskartan för rutan (den som får föreslå i ett öppet projekt). */
export async function fetchMapProjectMoisture(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: MoistureRuntime,
  now = new Date()): Promise<MoistureFailure | { status: "ok"; png: Uint8Array; world: string; crs: 3006; attribution: string }> {
  const parsed = moistureRequestSchema.safeParse(input.request);
  const allowed = await db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    if (!validOsmBox(parsed.data.box)) return { status: "too-large" } as const;
    if (!await consumeAccountRequestAllowance(tx, { scope: "MAP_SOURCE_ACCOUNT", key: access.accountId, limit: FETCHES_PER_HOUR, windowMs: 3_600_000 }, now)) {
      return { status: "throttled" } as const;
    }
    return { status: "ok" } as const;
  });
  if (allowed.status !== "ok") return allowed;
  const box = moistureRequestBox(parsed.data!.box);
  try {
    const layer = await layerName(runtime);
    if (!layer) return { status: "unavailable", detail: "capabilities" };
    // WMS 1.1.1: BBOX är alltid östlig, nordlig (1.3.0 vänder axlarna för EPSG:3006).
    const query = new URLSearchParams({ SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: layer, STYLES: "", SRS: "EPSG:3006",
      BBOX: [box.minE, box.minN, box.maxE, box.maxN].join(","), WIDTH: String(box.width), HEIGHT: String(box.height), FORMAT: "image/png", TRANSPARENT: "TRUE" });
    const response = await (runtime.fetch ?? fetch)(`${runtime.wmsUrl}?${query}`, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return { status: "unavailable", detail: `http-${response.status}` };
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return { status: "too-large" };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return { status: "too-large" };
    const image = imageDimensions(bytes);
    if (image?.mediaType !== "image/png") return { status: "unavailable", detail: "format" };
    return { status: "ok", png: bytes, world: box.world, crs: 3006, attribution: MOISTURE_ATTRIBUTION };
  } catch (error) {
    return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
}
