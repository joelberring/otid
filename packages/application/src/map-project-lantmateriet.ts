import { createHash } from "node:crypto";
import { mapProjectOsmRequestSchema as mapProjectOrthoSearchRequestSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { validOsmBox } from "@o-tid/map-revision";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";
import { openMapSourceCredential, type MapSourceSecret } from "./map-source-credentials";

/**
 * ADR-0219 tillägget om hämtningen (K4c): ortofoton från Lantmäteriet med kontots egna uppgifter. Servern söker i STAC-tjänsten
 * (`stac-bild`) och släpper igenom webbläsarens läsning av bilden (COG, bara delar med Range), med uppgifterna tillagda; bilden
 * görs till ett underlag i webbläsaren som en egen GeoTIFF (K4a). Bara Lantmäteriets adresser nås. Uppgifterna lämnar aldrig
 * servern och skrivs aldrig i loggar.
 *
 * Provas: adresserna och inloggningen följer Lantmäteriets guider (Basic för Geotorgets konto, OAuth2 med klientnyckel för
 * API-portalen) men är inte provade mot riktiga Lantmäteriet; driften kan ändra dem (`OTID_LM_STAC_BILD_URL`, `OTID_LM_TOKEN_URL`).
 */
export interface LantmaterietRuntime {
  readonly stacUrl: string;
  readonly tokenUrl: string;
  readonly environment: Record<string, string | undefined>;
  readonly fetch?: typeof fetch;
}
export const DEFAULT_LM_STAC_BILD_URL = "https://api.lantmateriet.se/stac-bild/v1";
export const DEFAULT_LM_TOKEN_URL = "https://apimanager.lantmateriet.se/oauth2/token";
export function lantmaterietRuntimeFromEnvironment(environment: Record<string, string | undefined>): LantmaterietRuntime {
  return { stacUrl: (environment.OTID_LM_STAC_BILD_URL?.trim() || DEFAULT_LM_STAC_BILD_URL).replace(/\/$/, ""),
    tokenUrl: environment.OTID_LM_TOKEN_URL?.trim() || DEFAULT_LM_TOKEN_URL, environment };
}

const SEARCHES_PER_HOUR = 30;
const MAX_SEARCH_BYTES = 10 * 1024 * 1024;
/** En del av bilden per anrop (COG läses i delar). */
export const MAX_RANGE_BYTES = 32 * 1024 * 1024;

/** Adressen är Lantmäteriets (eller den inställda tjänstens värd, i testerna). */
export function allowedSourceUrl(href: string, runtime: LantmaterietRuntime): URL | undefined {
  let url: URL;
  try { url = new URL(href); } catch { return undefined; }
  const configured = new URL(runtime.stacUrl);
  if (url.username || url.password) return undefined;
  if (url.protocol === "https:" && (url.hostname === "lantmateriet.se" || url.hostname.endsWith(".lantmateriet.se"))) return url;
  return url.protocol === configured.protocol && url.host === configured.host ? url : undefined;
}

/** OAuth2-biljetter per nyckel (bara en cache; hämtas igen när de gått ut eller servern startats om). */
const tokens = new Map<string, { token: string; expires: number }>();
async function authorization(secret: MapSourceSecret, runtime: LantmaterietRuntime): Promise<string | undefined> {
  const basic = `Basic ${Buffer.from(`${secret.id}:${secret.secret}`, "utf8").toString("base64")}`;
  if (secret.method === "BASIC") return basic;
  const cacheKey = createHash("sha256").update(`${runtime.tokenUrl}\n${secret.id}\n${secret.secret}`).digest("hex");
  const cached = tokens.get(cacheKey);
  if (cached && cached.expires > Date.now() + 30_000) return `Bearer ${cached.token}`;
  const response = await (runtime.fetch ?? fetch)(runtime.tokenUrl, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { authorization: basic, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: "grant_type=client_credentials" });
  if (!response.ok) return undefined;
  const body = await response.json().catch(() => undefined) as { access_token?: unknown; expires_in?: unknown } | undefined;
  if (typeof body?.access_token !== "string") return undefined;
  const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  tokens.set(cacheKey, { token: body.access_token, expires: Date.now() + seconds * 1000 });
  return `Bearer ${body.access_token}`;
}

export interface OrthoItem {
  readonly id: string; readonly collection: string | null; readonly datetime: string | null;
  readonly bbox: readonly [number, number, number, number] | null;
  /** Bildens adress (COG); läses genom `asset`-anropet. */
  readonly href: string; readonly title: string | null;
}
export type LantmaterietFailure = ClubFailure | { status: "no-credential" } | { status: "rejected" } | { status: "too-large" } | { status: "throttled" }
  | { status: "unavailable"; detail: string };

/** STAC-svaret som en lista med en bild per objekt (den första GeoTIFF:en), nyast först. */
export function orthoItems(json: unknown, runtime: LantmaterietRuntime): OrthoItem[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error("Inget STAC-svar");
  const items: OrthoItem[] = [];
  for (const feature of features as { id?: unknown; collection?: unknown; bbox?: unknown; properties?: { datetime?: unknown }; assets?: Record<string, { href?: unknown; type?: unknown; title?: unknown }> }[]) {
    const assets = Object.values(feature.assets ?? {});
    const image = assets.find(asset => typeof asset.href === "string" && ((typeof asset.type === "string" && asset.type.includes("image/tiff")) || /\.tiff?($|\?)/i.test(asset.href)));
    if (!image || typeof feature.id !== "string" || !allowedSourceUrl(String(image.href), runtime)) continue;
    const bbox = Array.isArray(feature.bbox) && feature.bbox.length >= 4 && feature.bbox.slice(0, 4).every(Number.isFinite)
      ? feature.bbox.slice(0, 4) as [number, number, number, number] : null;
    items.push({ id: feature.id, collection: typeof feature.collection === "string" ? feature.collection : null,
      datetime: typeof feature.properties?.datetime === "string" ? feature.properties.datetime : null, bbox, href: String(image.href),
      title: typeof image.title === "string" ? image.title.slice(0, 200) : null });
  }
  return items.sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? "") || a.id.localeCompare(b.id)).slice(0, 200);
}

/** Söker ortofoton för rutan (den som får föreslå i ett öppet projekt, med sparade uppgifter). */
export async function searchMapProjectOrtho(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: LantmaterietRuntime,
  now = new Date()): Promise<LantmaterietFailure | { status: "ok"; items: OrthoItem[] }> {
  const parsed = mapProjectOrthoSearchRequestSchema.safeParse(input.request);
  const allowed = await db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    if (!validOsmBox(parsed.data.box)) return { status: "too-large" } as const;
    if (!await consumeAccountRequestAllowance(tx, { scope: "MAP_SOURCE_ACCOUNT", key: access.accountId, limit: SEARCHES_PER_HOUR, windowMs: 3_600_000 }, now)) {
      return { status: "throttled" } as const;
    }
    return { status: "ok", accountId: access.accountId } as const;
  });
  if (allowed.status !== "ok") return allowed;
  const secret = await openMapSourceCredential(db, allowed.accountId, runtime.environment);
  if (!secret) return { status: "no-credential" };
  const box = parsed.data!.box;
  let response: Response;
  try {
    const auth = await authorization(secret, runtime);
    if (!auth) return { status: "rejected" };
    response = await (runtime.fetch ?? fetch)(`${runtime.stacUrl}/search`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { authorization: auth, "content-type": "application/json", accept: "application/geo+json, application/json" },
      body: JSON.stringify({ bbox: [box.west, box.south, box.east, box.north], limit: 200 }) });
  } catch (error) {
    return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
  if (response.status === 401 || response.status === 403) return { status: "rejected" };
  if (!response.ok) return { status: "unavailable", detail: `http-${response.status}` };
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_SEARCH_BYTES) return { status: "too-large" };
  const text = await response.text();
  if (text.length > MAX_SEARCH_BYTES) return { status: "too-large" };
  try { return { status: "ok", items: orthoItems(JSON.parse(text) as unknown, runtime) }; }
  catch { return { status: "unavailable", detail: "format" }; }
}

export type AssetResult = LantmaterietFailure | { status: "ok"; response: Response };
const RANGE = /^bytes=(\d{1,15})-(\d{1,15})$/;

/**
 * En del av bilden (Range krävs, högst 32 MB) med kontots uppgifter. Omdirigeringar följs bara till Lantmäteriets adresser
 * (uppgifterna skickas bara dit).
 */
export async function readMapProjectOrthoAsset(db: Database, input: ClubProof & { projectId: string; href: string; range: string | null },
  runtime: LantmaterietRuntime, now = new Date()): Promise<AssetResult> {
  const access = await db.transaction(tx => requireMapProject(tx, input, now, "propose", false));
  if (access.status !== "ok") return access;
  const match = input.range ? RANGE.exec(input.range) : null;
  if (!match || Number(match[2]) < Number(match[1]) || Number(match[2]) - Number(match[1]) + 1 > MAX_RANGE_BYTES) return { status: "invalid-request" };
  let url = allowedSourceUrl(input.href, runtime);
  if (!url) return { status: "invalid-request" };
  const secret = await openMapSourceCredential(db, access.accountId, runtime.environment);
  if (!secret) return { status: "no-credential" };
  try {
    const auth = await authorization(secret, runtime);
    if (!auth) return { status: "rejected" };
    for (let hop = 0; hop < 4; hop += 1) {
      const response: Response = await (runtime.fetch ?? fetch)(url.href, { redirect: "manual", signal: AbortSignal.timeout(60_000),
        headers: { authorization: auth, range: input.range! } });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const next: string | null = response.headers.get("location");
        url = next ? allowedSourceUrl(new URL(next, url).href, runtime) : undefined;
        if (!url) return { status: "unavailable", detail: "redirect" };
        continue;
      }
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return { status: "rejected" }; }
      if (response.status !== 206 && response.status !== 200) { await response.body?.cancel(); return { status: "unavailable", detail: `http-${response.status}` }; }
      const length = Number(response.headers.get("content-length") ?? 0);
      if (response.status === 200 && (!length || length > MAX_RANGE_BYTES)) { await response.body?.cancel(); return { status: "too-large" }; }
      return { status: "ok", response };
    }
    return { status: "unavailable", detail: "redirect" };
  } catch (error) {
    return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
}
