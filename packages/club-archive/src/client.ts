import type { SourceFile } from "./scan-core";

/**
 * ADR-0194 beslut 6–7: anropen till ägarens egen server, med importnyckeln i `Authorization`. Kartfilen skickas som en ström
 * (ingen kopia i minnet); banfilerna och träningarna som JSON i omgångar.
 */
export class ImportHttpError extends Error {
  constructor(readonly status: number, readonly body: string) { super(importErrorText(status, body)); }
}

/** Serverns svar som besked på svenska (ägarens 2026-11-03: "401 UNAUTHORIZED" sa inget). */
export function importErrorText(status: number, body: string): string {
  if (status === 401) return "Importnyckeln är fel, har gått ut eller är återkallad. Skapa en ny under Klubbarkiv → Import.";
  if (status === 404) return "Klubben finns inte.";
  if (status === 403) return "Servern tog inte emot anropet (403). Kontrollera adressen till servern.";
  if (status === 413) return "Filen är för stor för servern.";
  let code = "";
  try { code = (JSON.parse(body) as { error?: string }).error ?? ""; } catch { code = body.slice(0, 200); }
  if (code === "STORAGE_QUOTA_EXCEEDED") return "Ditt utrymme för kartor på servern är fullt.";
  return `Servern svarade ${status}${code ? ` (${code})` : ""}. Försök igen om en stund.`;
}

export interface ImportClient {
  /** Klubben som nyckeln hör till; anropen därefter går till den klubben. */
  club(): Promise<{ clubId: string; clubName: string }>;
  check(sha256: readonly string[]): Promise<{ clubName: string; known: Set<string> }>;
  uploadMap(sha256: string, file: SourceFile): Promise<{ stored: "new" | "existing" }>;
  batch(body: unknown): Promise<{ maps: { created: number; versionsAdded: number }; entries: { created: number; existing: number; courseFilesAdded: number };
    missingContent: string[] }>;
}

/** Bara https, utom mot den egna datorn (provning). */
export function checkServerUrl(server: string): URL {
  const url = new URL(server);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Servern måste ha https:// (http bara mot localhost)");
  return url;
}

export function createImportClient(options: { server: string; token: string; fetch?: typeof fetch }): ImportClient {
  const base = checkServerUrl(options.server);
  const doFetch = options.fetch ?? fetch;
  // Klubben ur nyckeln (ADR-0194: nyckeln hör till en klubb); `club()` anropas först.
  let clubId: string | undefined;
  const url = (path: string) => {
    if (!clubId) throw new Error("Klubben är inte hämtad (club() först)");
    return new URL(`/api/club-import/${encodeURIComponent(clubId)}/${path}`, base);
  };
  const headers = { authorization: `Bearer ${options.token}` };

  async function json<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) throw new ImportHttpError(response.status, text);
    return JSON.parse(text) as T;
  }

  return {
    async club() {
      const body = await json<{ clubId: string; clubName: string }>(await doFetch(new URL("/api/club-import/token", base), { headers }));
      clubId = body.clubId;
      return { clubId: body.clubId, clubName: body.clubName };
    },
    async check(sha256) {
      const response = await doFetch(url("check"), { method: "POST", headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ formatVersion: 1, sha256 }) });
      const body = await json<{ clubName: string; known: string[] }>(response);
      return { clubName: body.clubName, known: new Set(body.known) };
    },
    async uploadMap(sha256, file) {
      const iterator = file.open()[Symbol.asyncIterator]();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await iterator.next();
          if (next.done) controller.close(); else controller.enqueue(next.value);
        },
        async cancel() { await iterator.return?.(); }
      });
      const response = await doFetch(url(`content/${sha256}`), { method: "PUT", body: stream,
        headers: { ...headers, "content-type": "application/octet-stream", "x-otid-file-name": encodeURIComponent(file.path.split("/").pop() ?? "karta"),
          "x-otid-file-size": String(file.size) },
        duplex: "half" } as RequestInit & { duplex: "half" });
      return json<{ stored: "new" | "existing" }>(response);
    },
    async batch(body) {
      const response = await doFetch(url("batch"), { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
      return json(response);
    }
  };
}
