import { mapProjectOsmRequestSchema, type MapProjectClearCut } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { geodeticToGrid, transverseMercatorFor } from "@o-tid/map-file";
import { validOsmBox } from "@o-tid/map-revision";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";
import type { MapSourceFailure } from "./map-project-sources";

/**
 * Ägaren 2026-11-11 («finns det kartunderlag från Skogsstyrelsen så att man kan få fram hyggen och beståndsgränser?»):
 * Skogsstyrelsens utförda avverkningar (öppen ArcGIS-tjänst, skillnadsanalys av satellitbilder sedan 2022, avverkningar
 * från 0,5 ha) för rutan, med avverkningsdatum. Webbläsaren delar in hyggena efter ålder (färskt, sly, ungskog) jämfört med
 * i dag och med laserskanningen. Inget sparas här.
 */
export const DEFAULT_CLEAR_CUT_URL = "https://geodpags.skogsstyrelsen.se/arcgis/rest/services/Geodataportal/GeodataportalVisaUtfordavverkning/MapServer/1";
export const CLEAR_CUT_ATTRIBUTION = "Utförda avverkningar © Skogsstyrelsen";
const FETCHES_PER_HOUR = 20;
const MAX_FEATURES = 2000;

export interface ClearCutRuntime { readonly url: string; readonly fetch?: typeof fetch; readonly timeoutMs?: number }
export function clearCutRuntimeFromEnvironment(environment: Record<string, string | undefined>): ClearCutRuntime {
  return { url: environment.OTID_SKS_AVVERKNING_URL?.trim() || DEFAULT_CLEAR_CUT_URL };
}

type Ring = [number, number][];
/** Tjänstens GeoJSON (SWEREF 99 TM) som hyggen; datumet kommer som millisekunder. */
export function clearCutsFromGeoJson(json: unknown): MapProjectClearCut[] {
  const features = (json as { features?: unknown[] } | undefined)?.features;
  if (!Array.isArray(features)) throw new Error("Inte GeoJSON");
  const cuts: MapProjectClearCut[] = [];
  for (const feature of features as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[]) {
    const geometry = feature.geometry;
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates as unknown[] : [];
    const raw = feature.properties?.Avvdatum ?? feature.properties?.avvdatum;
    const date = typeof raw === "number" ? new Date(raw).toISOString().slice(0, 10) : typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
    const kind = typeof feature.properties?.Avverktyp === "string" ? feature.properties.Avverktyp : null;
    for (const polygon of (polygons ?? []) as unknown[][]) {
      const rings = (polygon ?? []).map(ring => (Array.isArray(ring) ? ring : []).filter((point): point is [number, number] =>
        Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])).map(([x, y]) => [x, y] as [number, number]))
        .filter((ring: Ring) => ring.length >= 4);
      if (rings.length) cuts.push({ rings, date, kind });
    }
  }
  return cuts;
}

export async function fetchMapProjectClearCuts(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: ClearCutRuntime,
  now = new Date()): Promise<MapSourceFailure | { status: "ok"; cuts: MapProjectClearCut[]; attribution: string }> {
  const parsed = mapProjectOsmRequestSchema.safeParse(input.request);
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
  const { south, west, north, east } = parsed.data!.box;
  const projection = transverseMercatorFor(3006)!;
  const corners = [[south, west], [south, east], [north, west], [north, east]].map(([lat, lon]) => geodeticToGrid(projection, lat!, lon!));
  const envelope = [Math.min(...corners.map(c => c.easting)), Math.min(...corners.map(c => c.northing)), Math.max(...corners.map(c => c.easting)),
    Math.max(...corners.map(c => c.northing))].map(value => Math.round(value)).join(",");
  const query = new URLSearchParams({ where: "1=1", geometry: envelope, geometryType: "esriGeometryEnvelope", inSR: "3006", outSR: "3006",
    spatialRel: "esriSpatialRelIntersects", outFields: "Avvdatum,Avverktyp", returnGeometry: "true", resultRecordCount: String(MAX_FEATURES), f: "geojson" });
  let response: Response;
  try {
    response = await (runtime.fetch ?? fetch)(`${runtime.url}/query?${query}`, { headers: { accept: "application/geo+json, application/json", "user-agent": "O-Tid kartprojekt" },
      signal: AbortSignal.timeout(runtime.timeoutMs ?? 60_000), redirect: "error" });
  } catch (error) {
    return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
  if (!response.ok) return { status: "unavailable", detail: `http-${response.status}` };
  try {
    return { status: "ok", cuts: clearCutsFromGeoJson(await response.json()), attribution: CLEAR_CUT_ATTRIBUTION };
  } catch {
    return { status: "unavailable", detail: "format" };
  }
}
