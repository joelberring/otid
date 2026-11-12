import { mapProjectOsmRequestSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { OSM_ATTRIBUTION, mergeOverpass, osmTiles, osmToSourceData, overpassQuery, validLaserBox, type SourceData } from "@o-tid/map-revision";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubFailure, ClubProof } from "./club-access";
import { requireMapProject } from "./map-project-access";

/**
 * ADR-0219 tillägget om hämtningen (K4c): underlag från öppna källor till kartprojektet. Servern hämtar åt webbläsaren (inga
 * nycklar eller CORS i webbläsaren, en gräns per konto) och svarar med lager och objekt som en vektorfil; webbläsaren väljer
 * symboler och lämnar kandidaterna som förslag (K4b). Inget sparas här.
 */
export interface MapSourceRuntime {
  /** Overpass-tjänsten; `OTID_OVERPASS_URL` i driften (t.ex. en egen eller en falsk i testerna). */
  readonly overpassUrl: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}
export const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export function mapSourceRuntimeFromEnvironment(environment: Record<string, string | undefined>): MapSourceRuntime {
  return { overpassUrl: environment.OTID_OVERPASS_URL?.trim() || DEFAULT_OVERPASS_URL };
}

/** Högst så många hämtningar per konto och timme (Overpass är en delad tjänst). */
const FETCHES_PER_HOUR = 20;
const MAX_RESPONSE_BYTES = 80 * 1024 * 1024;

export type MapSourceFailure = ClubFailure | { status: "too-large" } | { status: "throttled" } | { status: "unavailable"; detail: string };

/** Läser svaret, högst `max` byte. */
async function readLimited(response: Response, max: number): Promise<string | undefined> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return undefined; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** OpenStreetMap för rutan (den som får föreslå i ett öppet projekt). */
export async function fetchMapProjectOsm(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: MapSourceRuntime,
  now = new Date()): Promise<MapSourceFailure | { status: "ok"; data: SourceData; attribution: string }> {
  const parsed = mapProjectOsmRequestSchema.safeParse(input.request);
  const allowed = await db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    if (!validLaserBox(parsed.data.box)) return { status: "too-large" } as const;
    if (!await consumeAccountRequestAllowance(tx, { scope: "MAP_SOURCE_ACCOUNT", key: access.accountId, limit: FETCHES_PER_HOUR, windowMs: 3_600_000 }, now)) {
      return { status: "throttled" } as const;
    }
    return { status: "ok" } as const;
  });
  if (allowed.status !== "ok") return allowed;
  const fetcher = runtime.fetch ?? fetch;
  // Ett stort område hämtas ruta för ruta, en i taget (Overpass är en delad tjänst).
  const answers: unknown[] = [];
  let bytes = 0;
  for (const box of osmTiles(parsed.data!.box)) {
    let response: Response;
    try {
      response = await fetcher(runtime.overpassUrl, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "O-Tid kartprojekt" },
        body: new URLSearchParams({ data: overpassQuery(box) }).toString(), signal: AbortSignal.timeout(runtime.timeoutMs ?? 120_000), redirect: "error"
      });
    } catch (error) {
      return { status: "unavailable", detail: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
    }
    if (response.status === 429 || response.status === 504) return { status: "unavailable", detail: "busy" };
    if (!response.ok) return { status: "unavailable", detail: `http-${response.status}` };
    const text = await readLimited(response, MAX_RESPONSE_BYTES - bytes);
    if (text === undefined) return { status: "too-large" };
    bytes += text.length;
    try { answers.push(JSON.parse(text) as unknown); } catch { return { status: "unavailable", detail: "format" }; }
  }
  try {
    return { status: "ok", data: osmToSourceData(mergeOverpass(answers)), attribution: OSM_ATTRIBUTION };
  } catch {
    return { status: "unavailable", detail: "format" };
  }
}
