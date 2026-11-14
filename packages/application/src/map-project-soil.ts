import { mapProjectOsmRequestSchema, type MapProjectSoilArea } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { validLaserBox } from "@o-tid/map-revision";
import { classifySoil } from "@o-tid/map-revision/base-map";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubProof } from "./club-access";
import { aiGate, sessionGate, type MapProjectGate } from "./map-project-access";
import type { MapSourceFailure } from "./map-project-sources";

/**
 * Ägaren 2026-11-13 («synka mot jordartskartor för att få bort sankmarker på flacka sandhedar»): SGU:s öppna jordartskarta
 * (OGC API Features, grundlagret) för rutan, klassad som torr, blöt eller annan mark. Webbläsaren och kartjobbet tar bort
 * sankmark på sand och grus med den (`marshOffDrySoil`). Inget sparas här.
 */
export const DEFAULT_SOIL_URL = "https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1/collections/grundlager/items";
export const SOIL_ATTRIBUTION = "Jordarter 1:25 000–1:100 000 © SGU";
const FETCHES_PER_HOUR = 20;
const PAGE = 1000;
const MAX_PAGES = 10;

export interface SoilRuntime { readonly url: string; readonly fetch?: typeof fetch; readonly timeoutMs?: number }
export function soilRuntimeFromEnvironment(environment: Record<string, string | undefined>): SoilRuntime {
  return { url: environment.OTID_SGU_JORDARTER_URL?.trim() || DEFAULT_SOIL_URL };
}

/** Jordarternas ytor (SWEREF 99 TM, öst–nord) ur ett svar från tjänsten, och adressen till nästa sida. Ett svar som inte är GeoJSON ger ett fel. */
export function soilFromFeatureCollection(json: unknown): { areas: MapProjectSoilArea[]; next: string | null } {
  const body = json as { features?: unknown[]; links?: { rel?: unknown; href?: unknown }[] } | null | undefined;
  if (!body || !Array.isArray(body.features)) throw new Error("Inte GeoJSON");
  const areas: MapProjectSoilArea[] = [];
  for (const feature of body.features as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[]) {
    const geometry = feature?.geometry;
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates) ? geometry.coordinates as unknown[] : [];
    const rawCode = feature.properties?.jg2, code = typeof rawCode === "number" ? rawCode : typeof rawCode === "string" && /^\d+$/.test(rawCode) ? Number(rawCode) : null;
    const text = typeof feature.properties?.jg2_tx === "string" ? feature.properties.jg2_tx : "";
    const cls = classifySoil(code, text);
    for (const polygon of polygons as unknown[][]) {
      const rings = (Array.isArray(polygon) ? polygon : []).map(ring => (Array.isArray(ring) ? ring : []).filter((point): point is [number, number] =>
        Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])).map(([x, y]) => [x, y] as [number, number]))
        .filter(ring => ring.length >= 4);
      if (rings.length) areas.push({ rings, cls, code, text });
    }
  }
  const next = Array.isArray(body.links) ? body.links.find(link => link?.rel === "next" && typeof link.href === "string")?.href as string | undefined : undefined;
  return { areas, next: next ?? null };
}

export async function fetchMapProjectSoil(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: SoilRuntime,
  now = new Date()): Promise<SoilResult> {
  return fetchSoil(db, sessionGate(input, now), input.request, runtime, now);
}
/** Samma hämtning för AI-kopplingen (kontot bakom den; inte när projektets AI-läge är bara läsa). */
export async function fetchMapProjectSoilAsAi(db: Database, input: { accountId: string; projectId: string; request: unknown }, runtime: SoilRuntime,
  now = new Date()): Promise<SoilResult> {
  return fetchSoil(db, aiGate(input.accountId, input.projectId, now), input.request, runtime, now);
}
type SoilResult = MapSourceFailure | { status: "ok"; areas: MapProjectSoilArea[]; attribution: string };

async function fetchSoil(db: Database, gate: MapProjectGate, request: unknown, runtime: SoilRuntime, now: Date): Promise<SoilResult> {
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
  const { south, west, north, east } = parsed.data!.box;
  const first = new URL(runtime.url);
  first.search = new URLSearchParams({ f: "json", limit: String(PAGE), bbox: [west, south, east, north].join(","), crs: "http://www.opengis.net/def/crs/EPSG/0/3006" }).toString();
  const areas: MapProjectSoilArea[] = [];
  let target: string | null = first.href;
  for (let page = 0; page < MAX_PAGES && target; page += 1) {
    let response: Response;
    try {
      response = await (runtime.fetch ?? fetch)(target, { headers: { accept: "application/geo+json, application/json", "user-agent": "O-Tid kartprojekt" },
        signal: AbortSignal.timeout(runtime.timeoutMs ?? 60_000), redirect: "error" });
    } catch (error) {
      return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
    }
    if (!response.ok) return { status: "unavailable", detail: `http-${response.status}` };
    try {
      const read = soilFromFeatureCollection(await response.json());
      areas.push(...read.areas);
      // Nästa sida följs bara på tjänstens egen adress (länken kommer från svaret).
      target = read.next && new URL(read.next, target).origin === first.origin ? new URL(read.next, target).href : null;
    } catch {
      return { status: "unavailable", detail: "format" };
    }
  }
  return { status: "ok", areas, attribution: SOIL_ATTRIBUTION };
}
