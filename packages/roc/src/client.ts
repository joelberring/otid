import { createHash } from "node:crypto";
import { fail, RocAdapterError } from "./errors";
import { assertTimeZone, parseRocPunches, type RocPunchList } from "./parse";

/** Var stämplingarna hämtas. Tävlingen väljer källa; båda talar samma protokoll. */
export type RocSource = "ROC" | "ORESULTS";

/**
 * ROC (roc.olresultat.se). Sökvägen är den som tidtagningsprogram brukar använda men är inte
 * kontrollerad mot den riktiga tjänsten härifrån – ägaren verifierar den (STATUS.md, docs/drift.md).
 */
export const ROC_ORIGIN = "https://roc.olresultat.se";
export const ROC_PATH = "/ver7.1/getpunches.php";
/** OResults ROC-kompatibla adress (docs.oresults.eu/integrations/roc). */
export const ORESULTS_ORIGIN = "https://api.oresults.eu";
export const ORESULTS_PATH = "/roc";

const ORIGIN: Record<RocSource, string> = { ROC: ROC_ORIGIN, ORESULTS: ORESULTS_ORIGIN };
const PATH: Record<RocSource, string> = { ROC: ROC_PATH, ORESULTS: ORESULTS_PATH };
const UNIT_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Ett svar är några rader per stämpling; 2 MB räcker till tiotusentals. */
export const MAX_ROC_RESPONSE_BYTES = 2 * 1024 * 1024;

export function isPlausibleRocUnitId(value: string): boolean {
  return UNIT_ID.test(value);
}

/** Basadressen som driften angett för test: absolut http(s)-adress utan användaruppgifter, sökväg eller fråga. */
export function normalizeRocBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { fail("INVALID_INPUT"); }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) fail("INVALID_INPUT");
  return url.origin;
}

/** Adressen som anropas för en källa (med testserverns ursprung om driften angett ett). */
export function rocEndpoint(source: RocSource, input: { unitId: string; lastId: number }, baseUrl?: string): string {
  if (!isPlausibleRocUnitId(input.unitId) || !Number.isSafeInteger(input.lastId) || input.lastId < 0) fail("INVALID_INPUT");
  const origin = baseUrl ? normalizeRocBaseUrl(baseUrl) : ORIGIN[source];
  return `${origin}${PATH[source]}?unitId=${encodeURIComponent(input.unitId)}&lastId=${input.lastId}`;
}

export interface RocClientOptions {
  readonly source: RocSource;
  /** Bara för test (driftens `OTID_ROC_BASE_URL`): ersätter tjänstens ursprung, sökvägen behålls. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface RocFetchResult extends RocPunchList {
  /** SHA-256 av svaret, för felsökning utan innehåll. */
  readonly bodyHash: string;
}

async function readBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_ROC_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => undefined);
    fail("RESPONSE_TOO_LARGE");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) fail("TIMEOUT");
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_ROC_RESPONSE_BYTES) fail("RESPONSE_TOO_LARGE");
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof RocAdapterError) throw error;
    fail(signal.aborted ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE");
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

/**
 * Hämtar nya stämplingar från ROC eller OResults med `lastId`. Ingen nyckel, inga omdirigeringar,
 * tidsgräns och storleksgräns. Felen är koder utan innehåll från tjänsten.
 */
export function rocClient(options: RocClientOptions) {
  if (options.source !== "ROC" && options.source !== "ORESULTS") fail("INVALID_INPUT");
  const baseUrl = options.baseUrl ? normalizeRocBaseUrl(options.baseUrl) : undefined;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  return {
    /** Stämplingarna efter `lastId`, med lokal tid tolkad i `timeZone`. */
    async fetchPunches(input: { unitId: string; lastId: number; timeZone: string }): Promise<RocFetchResult> {
      assertTimeZone(input.timeZone);
      const url = rocEndpoint(options.source, input, baseUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImplementation(url, { method: "GET", redirect: "error", cache: "no-store", credentials: "omit",
            signal: controller.signal, headers: { Accept: "text/plain, */*;q=0.5" } });
        } catch {
          fail(controller.signal.aborted ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE");
        }
        if (response.status === 401 || response.status === 403) { void response.body?.cancel().catch(() => undefined); fail("REJECTED"); }
        if (response.status === 404) { void response.body?.cancel().catch(() => undefined); fail("NOT_FOUND"); }
        if (!response.ok) { void response.body?.cancel().catch(() => undefined); fail("UPSTREAM_UNAVAILABLE"); }
        const bytes = await readBody(response, controller.signal);
        const body = new TextDecoder("utf-8").decode(bytes);
        // En HTML-sida (felsida, inloggning) är inga stämplingar.
        if (/^\s*</.test(body.replace(/^\uFEFF/, ""))) fail("INVALID_RESPONSE");
        const parsed = parseRocPunches(body, input.timeZone);
        if (parsed.punches.length === 0 && parsed.duplicateLines === 0 && parsed.malformedLines > 0) fail("INVALID_RESPONSE");
        return { ...parsed, bodyHash: createHash("sha256").update(bytes).digest("hex") };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export type RocClient = ReturnType<typeof rocClient>;
