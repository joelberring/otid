import { mapProjectOsmRequestSchema as mapProjectLaserSearchRequestSchema, type GeoExtraItem } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { validLaserBox } from "@o-tid/map-revision";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubProof } from "./club-access";
import { aiGate, sessionGate, type MapProjectGate } from "./map-project-access";
import { allowedSourceUrl, lantmaterietAuthorization, type LantmaterietFailure, type LantmaterietRuntime } from "./map-project-lantmateriet";
import { openMapSourceCredential, type MapSourceSecret } from "./map-source-credentials";

/**
 * ADR-0219 K5 (ägaren 2026-11-08): laserdata (Laserdata Nedladdning, skog) från Lantmäteriets `stac-hojd` med kontots egna
 * uppgifter. Servern söker rutorna (2,5 × 2,5 km, LAZ); geo-arbetaren hämtar filerna genom servern, så att uppgifterna aldrig
 * lämnar den. Laserdata gäller under CC BY 4.0 med källan ©Lantmäteriet och kan innehålla personuppgifter (Lantmäteriets villkor).
 */
export const DEFAULT_LM_STAC_HOJD_URL = "https://api.lantmateriet.se/stac-hojd/v1";
const SEARCHES_PER_HOUR = 30;
const MAX_SEARCH_BYTES = 10 * 1024 * 1024;
/** Högst så stor laserruta (en ruta på 2,5 × 2,5 km är oftast 50–400 MB). */
export const MAX_LASER_BYTES = 1536 * 1024 * 1024;

/** G8: Lantmäteriets vektorprodukter (Marktäcke, Byggnad) i `stac-vektor`. Inte provat mot riktiga Lantmäteriet; `OTID_LM_STAC_VEKTOR_URL` ändrar adressen. */
export const DEFAULT_LM_STAC_VEKTOR_URL = "https://api.lantmateriet.se/stac-vektor/v1";
export interface LaserRuntime extends LantmaterietRuntime { readonly hojdUrl: string; readonly laserCollection: string | undefined; readonly vektorUrl?: string | undefined }
export function laserRuntimeFromEnvironment(base: LantmaterietRuntime): LaserRuntime {
  return { ...base, vektorUrl: (base.environment.OTID_LM_STAC_VEKTOR_URL?.trim() || DEFAULT_LM_STAC_VEKTOR_URL).replace(/\/$/, ""),
    hojdUrl: (base.environment.OTID_LM_STAC_HOJD_URL?.trim() || DEFAULT_LM_STAC_HOJD_URL).replace(/\/$/, ""),
    laserCollection: base.environment.OTID_LM_LASER_COLLECTION?.trim() || undefined };
}
/** Lantmäteriets adresser, eller den inställda höjdtjänstens värd (testerna). */
export const allowedLaserUrl = (href: string, runtime: LaserRuntime) => allowedSourceUrl(href, { ...runtime, stacUrl: runtime.hojdUrl });

export interface LaserItem {
  readonly id: string; readonly collection: string | null; readonly datetime: string | null;
  readonly bbox: readonly [number, number, number, number] | null;
  readonly href: string; readonly bytes: number | null; readonly epsg: number | null;
}

export function laserItems(json: unknown, runtime: LaserRuntime): LaserItem[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error("Inget STAC-svar");
  const items: LaserItem[] = [];
  for (const feature of features as { id?: unknown; collection?: unknown; bbox?: unknown;
    properties?: { datetime?: unknown; "proj:epsg"?: unknown; "proj:code"?: unknown };
    assets?: Record<string, { href?: unknown; type?: unknown; "file:size"?: unknown }> }[]) {
    const asset = Object.values(feature.assets ?? {}).find(entry => typeof entry.href === "string"
      && (/\.la[sz]($|\?)/i.test(entry.href) || (typeof entry.type === "string" && /las|laz|laszip/i.test(entry.type))));
    if (!asset || typeof feature.id !== "string" || !allowedLaserUrl(String(asset.href), runtime)) continue;
    const bbox = Array.isArray(feature.bbox) && feature.bbox.length >= 4 && feature.bbox.slice(0, 4).every(Number.isFinite)
      ? feature.bbox.slice(0, 4) as [number, number, number, number] : null;
    const code = feature.properties?.["proj:epsg"] ?? (typeof feature.properties?.["proj:code"] === "string" ? Number(String(feature.properties["proj:code"]).replace(/^EPSG:/i, "")) : null);
    items.push({ id: feature.id, collection: typeof feature.collection === "string" ? feature.collection : null,
      datetime: typeof feature.properties?.datetime === "string" ? feature.properties.datetime : null, bbox, href: String(asset.href),
      bytes: typeof asset["file:size"] === "number" ? asset["file:size"] : null, epsg: typeof code === "number" && Number.isInteger(code) ? code : null });
  }
  return items.sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? "") || a.id.localeCompare(b.id)).slice(0, 200);
}

/** Samlingen med laserdata för skog: inställd, annars den vars id eller titel nämner laser och skog. */
export function laserCollectionOf(json: unknown): string | undefined {
  const collections = (json as { collections?: unknown } | null)?.collections;
  if (!Array.isArray(collections)) return undefined;
  const found = (collections as { id?: unknown; title?: unknown }[]).find(entry => {
    if (typeof entry.id !== "string") return false;
    const words = `${entry.id} ${typeof entry.title === "string" ? entry.title : ""}`;
    return /laser/i.test(words) && /skog/i.test(words);
  });
  return typeof found?.id === "string" ? found.id : undefined;
}

async function getJson(url: string, auth: string, runtime: LaserRuntime, body?: unknown): Promise<{ ok: true; json: unknown } | LantmaterietFailure> {
  let response: Response;
  try {
    response = await (runtime.fetch ?? fetch)(url, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { authorization: auth, accept: "application/geo+json, application/json", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (error) {
    return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
  if (response.status === 401 || response.status === 403) return { status: "rejected" };
  if (!response.ok) return { status: "unavailable", detail: `http-${response.status}` };
  if (Number(response.headers.get("content-length") ?? 0) > MAX_SEARCH_BYTES) return { status: "too-large" };
  const text = await response.text();
  if (text.length > MAX_SEARCH_BYTES) return { status: "too-large" };
  try { return { ok: true, json: JSON.parse(text) as unknown }; } catch { return { status: "unavailable", detail: "format" }; }
}

/** Vilken vektorprodukt en samling är, ur dess id och titel. */
const EXTRA_WORDS: readonly (readonly [GeoExtraItem["kind"], RegExp])[] = [["LAND_COVER", /markt[aä]cke/i], ["BUILDINGS", /byggnad/i]];

/** Zip-filerna (GeoPackage per kommun) i ett STAC-svar, som jobbets extra hämtningar. */
export function vectorExtras(json: unknown, kind: GeoExtraItem["kind"], runtime: LaserRuntime): GeoExtraItem[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: GeoExtraItem[] = [];
  for (const feature of features as { id?: unknown; assets?: Record<string, { href?: unknown; type?: unknown }> }[]) {
    const asset = Object.values(feature.assets ?? {}).find(entry => typeof entry.href === "string"
      && (/\.zip($|\?)/i.test(entry.href) || (typeof entry.type === "string" && /zip|geopackage/i.test(entry.type))));
    if (asset && typeof feature.id === "string" && allowedLaserUrl(String(asset.href), runtime)) out.push({ kind, id: feature.id.slice(0, 200), href: String(asset.href) });
  }
  return out.slice(0, 3);
}

/**
 * Marktäcke och Byggnad för rutan, om kontot kommer åt dem (G8). Ett försök i mån av förmåga: fel och saknad behörighet ger
 * en tom lista, så att lasersökningen aldrig faller på det här.
 */
async function searchVectorExtras(auth: string, runtime: LaserRuntime, box: { west: number; south: number; east: number; north: number }): Promise<GeoExtraItem[]> {
  if (!runtime.vektorUrl) return [];
  const listed = await getJson(`${runtime.vektorUrl}/collections`, auth, runtime);
  if (!("ok" in listed)) return [];
  const collections = (listed.json as { collections?: { id?: unknown; title?: unknown }[] } | null)?.collections;
  if (!Array.isArray(collections)) return [];
  const out: GeoExtraItem[] = [];
  for (const [kind, words] of EXTRA_WORDS) {
    const collection = collections.find(entry => typeof entry.id === "string" && words.test(`${entry.id} ${typeof entry.title === "string" ? entry.title : ""}`)
      && !/inspire|visning|direkt/i.test(`${entry.id} ${typeof entry.title === "string" ? entry.title : ""}`));
    if (typeof collection?.id !== "string") continue;
    const found = await getJson(`${runtime.vektorUrl}/search`, auth, runtime, { bbox: [box.west, box.south, box.east, box.north], collections: [collection.id], limit: 10 });
    if ("ok" in found) out.push(...vectorExtras(found.json, kind, runtime));
  }
  return out;
}

/** Söker laserrutor för rutan (den som får föreslå i ett öppet projekt, med sparade uppgifter). */
export async function searchMapProjectLaser(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: LaserRuntime,
  now = new Date()): Promise<LaserSearchResult> {
  return searchLaser(db, sessionGate(input, now), input.request, runtime, now);
}
/** Samma sökning för AI-kopplingen (kontot bakom den; inte när projektets AI-läge är bara läsa). */
export async function searchMapProjectLaserAsAi(db: Database, input: { accountId: string; projectId: string; request: unknown }, runtime: LaserRuntime,
  now = new Date()): Promise<LaserSearchResult> {
  return searchLaser(db, aiGate(input.accountId, input.projectId, now), input.request, runtime, now);
}
type LaserSearchResult = LantmaterietFailure | { status: "ok"; items: LaserItem[]; collection: string; extras: GeoExtraItem[] };

async function searchLaser(db: Database, gate: MapProjectGate, request: unknown, runtime: LaserRuntime, now: Date): Promise<LaserSearchResult> {
  const parsed = mapProjectLaserSearchRequestSchema.safeParse(request);
  const allowed = await db.transaction(async tx => {
    const access = await gate(tx, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    if (!validLaserBox(parsed.data.box)) return { status: "too-large" } as const;
    if (!await consumeAccountRequestAllowance(tx, { scope: "MAP_SOURCE_ACCOUNT", key: access.accountId, limit: SEARCHES_PER_HOUR, windowMs: 3_600_000 }, now)) {
      return { status: "throttled" } as const;
    }
    return { status: "ok", accountId: access.accountId } as const;
  });
  if (allowed.status !== "ok") return allowed;
  const secret = await openMapSourceCredential(db, allowed.accountId, runtime.environment);
  if (!secret) return { status: "no-credential" };
  let auth: string | undefined;
  try { auth = await lantmaterietAuthorization(secret, runtime); } catch { return { status: "unavailable", detail: "network" }; }
  if (!auth) return { status: "rejected" };
  let collection = runtime.laserCollection;
  if (!collection) {
    const listed = await getJson(`${runtime.hojdUrl}/collections`, auth, runtime);
    if (!("ok" in listed)) return listed;
    collection = laserCollectionOf(listed.json);
    if (!collection) return { status: "unavailable", detail: "no-laser-collection" };
  }
  const box = parsed.data!.box;
  const found = await getJson(`${runtime.hojdUrl}/search`, auth, runtime, { bbox: [box.west, box.south, box.east, box.north], collections: [collection], limit: 200 });
  if (!("ok" in found)) return found;
  const extras = await searchVectorExtras(auth, runtime, box).catch(() => []);
  try { return { status: "ok", items: laserItems(found.json, runtime), collection, extras }; }
  catch { return { status: "unavailable", detail: "format" }; }
}

/**
 * Hämtar en laserfil med uppgifterna (för geo-arbetaren, genom servern). Omdirigeringar följs bara till Lantmäteriets adresser.
 * Svaret strömmas vidare; storleken kontrolleras mot `MAX_LASER_BYTES`.
 */
export async function fetchLaserFile(secret: MapSourceSecret, href: string, runtime: LaserRuntime)
  : Promise<LantmaterietFailure | { status: "ok"; response: Response }> {
  let url = allowedLaserUrl(href, runtime);
  if (!url) return { status: "invalid-request" };
  try {
    const auth = await lantmaterietAuthorization(secret, runtime);
    if (!auth) return { status: "rejected" };
    for (let hop = 0; hop < 4; hop += 1) {
      const response: Response = await (runtime.fetch ?? fetch)(url.href, { redirect: "manual", signal: AbortSignal.timeout(15 * 60_000),
        headers: { authorization: auth } });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const next = response.headers.get("location");
        url = next ? allowedLaserUrl(new URL(next, url).href, runtime) : undefined;
        if (!url) return { status: "unavailable", detail: "redirect" };
        continue;
      }
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return { status: "rejected" }; }
      if (response.status !== 200) { await response.body?.cancel(); return { status: "unavailable", detail: `http-${response.status}` }; }
      if (Number(response.headers.get("content-length") ?? 0) > MAX_LASER_BYTES) { await response.body?.cancel(); return { status: "too-large" }; }
      return { status: "ok", response };
    }
    return { status: "unavailable", detail: "redirect" };
  } catch (error) {
    return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
}
