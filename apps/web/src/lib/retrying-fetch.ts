/**
 * Automatiska omförsök för arbetsytans anrop (ADR-0169 beslut 4: appen gör omförsök själv).
 *
 * Bara anrop som säkert kan skickas igen försöks om: läsningar (GET/HEAD) och skrivningar som bär en
 * idempotensnyckel eller ett requestId. Servern sparar sådana bara en gång och svarar med samma kvitto.
 * Omförsök görs vid nätfel och när en mellanliggande server inte nådde appen (502/503/504).
 */
export const RETRY_DELAYS_MS: readonly number[] = [400, 1_200];
const RETRY_STATUSES = new Set([502, 503, 504]);

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

/** Om anropet kan skickas igen utan risk att något sparas två gånger. */
export function canRetry(init: RequestInit = {}): boolean {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return true;
  if (header(init, "idempotency-key")) return true;
  return typeof init.body === "string" && /"requestId"\s*:\s*"[^"]+"/.test(init.body);
}

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException("Avbrutet", "AbortError");
    if (signal?.aborted) { reject(aborted()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    function abort() { clearTimeout(timer); reject(aborted()); }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Som `fetch`, men ett säkert anrop skickas om upp till två gånger vid nätfel eller 502/503/504.
 * Ett avbrutet anrop (signal) försöks aldrig om. Det sista felet eller svaret lämnas till anroparen.
 */
export async function fetchWithRetry(input: string, init: RequestInit = {},
  options: { delays?: readonly number[]; fetchImpl?: typeof fetch } = {}): Promise<Response> {
  const delays = canRetry(init) ? options.delays ?? RETRY_DELAYS_MS : [];
  const fetchImpl = options.fetchImpl ?? fetch;
  for (let attempt = 0; ; attempt += 1) {
    const last = attempt >= delays.length;
    try {
      const response = await fetchImpl(input, init);
      if (last || !RETRY_STATUSES.has(response.status)) return response;
    } catch (error) {
      if (last || init.signal?.aborted || !(error instanceof TypeError)) throw error;
    }
    await wait(delays[attempt]!, init.signal);
  }
}
