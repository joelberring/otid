import type { SourceFile } from "./scan";

/**
 * ADR-0194 beslut 6–7: anropen till ägarens egen server, med importnyckeln i `Authorization`. Kartfilen skickas som en ström
 * (ingen kopia i minnet); banfilerna och träningarna som JSON i omgångar.
 */
export class ImportHttpError extends Error {
  constructor(readonly status: number, readonly body: string) { super(`Servern svarade ${status}: ${body.slice(0, 300)}`); }
}

export interface ImportClient {
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

export function createImportClient(options: { server: string; clubId: string; token: string; fetch?: typeof fetch }): ImportClient {
  const base = checkServerUrl(options.server);
  const doFetch = options.fetch ?? fetch;
  const url = (path: string) => new URL(`/api/club-import/${encodeURIComponent(options.clubId)}/${path}`, base);
  const headers = { authorization: `Bearer ${options.token}` };

  async function json<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) throw new ImportHttpError(response.status, text);
    return JSON.parse(text) as T;
  }

  return {
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
