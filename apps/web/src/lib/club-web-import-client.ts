import type { BatchResult, ImportUploader, SourceFile } from "@o-tid/club-archive";
import { sourceBlob } from "@o-tid/club-archive/browser";
import type { ClubImportCheckResponse } from "@o-tid/contracts";
import { clubWebImportSv } from "../i18n/club-import-web-sv";
import type { Texts } from "./language";
import { clubBase, csrf } from "./club-archive-client";

/**
 * ADR-0204: importens anrop från webbläsaren med inloggningen (kakan och CSRF, samma Origin), till
 * `/api/organizer/clubs/{id}/import/…`. Samma uppladdning som kommandots (`uploadPlan`); kartfilen skickas som Blob (strömmade
 * kroppar finns bara i Chrome), och allt kan avbrytas med `signal`.
 */
type ImportErrors = Texts<typeof clubWebImportSv.errors>;

export class WebImportError extends Error {}

const CHECK_MAX = 1000, KEYS_MAX = 5000;

function errorText(errors: ImportErrors, status: number, body: string, fileName?: string): string {
  if (status === 401) return errors.session;
  if (status === 403) return errors.forbidden;
  if (status === 404) return errors.notFound;
  if (status === 413) return errors.tooLarge(fileName ?? "Filen");
  let code = "";
  try { code = (JSON.parse(body) as { error?: string }).error ?? ""; } catch { code = ""; }
  if (code === "MAP_FILE_TOO_LARGE") return errors.tooLarge(fileName ?? "Kartfilen");
  if (code === "STORAGE_QUOTA_EXCEEDED") return errors.quota;
  if (code === "HASH_MISMATCH") return errors.hashMismatch(fileName ?? "Filen");
  if (code === "INVALID_MAP_FILE") return errors.invalidMap(fileName ?? "Filen");
  return errors.generic(status);
}

export interface WebImportClient extends ImportUploader {
  /** Kartfilerna och träningarna som servern redan har (förhandsgranskningen). */
  status(sha256: readonly string[], importKeys: readonly string[]): Promise<{ known: Set<string>; knownEntries: Set<string> }>;
}

export function createWebImportClient(clubId: string, signal: AbortSignal, errors: ImportErrors = clubWebImportSv.errors): WebImportClient {
  const base = `${clubBase(clubId)}/import`;

  async function send(path: string, init: RequestInit, fileName?: string): Promise<unknown> {
    const token = csrf();
    if (!token) throw new WebImportError(errors.session);
    let response: Response;
    try {
      response = await fetch(`${base}/${path}`, { ...init, credentials: "same-origin", cache: "no-store", signal,
        headers: { ...init.headers as Record<string, string>, "x-otid-csrf": token } });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new WebImportError(errors.network);
    }
    const text = await response.text();
    if (!response.ok) throw new WebImportError(errorText(errors, response.status, text, fileName));
    return JSON.parse(text) as unknown;
  }

  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function status(sha256: readonly string[], importKeys: readonly string[]) {
    const known = new Set<string>(), knownEntries = new Set<string>();
    const unique = [...new Set(sha256)], keys = [...new Set(importKeys)];
    // Högst 1000 kartfiler och 5000 träningar per fråga (kontraktet).
    const rounds = Math.max(1, Math.ceil(unique.length / CHECK_MAX), Math.ceil(keys.length / KEYS_MAX));
    for (let round = 0; round < rounds; round++) {
      const response = await send("check", json({ formatVersion: 1, sha256: unique.slice(round * CHECK_MAX, (round + 1) * CHECK_MAX),
        importKeys: keys.slice(round * KEYS_MAX, (round + 1) * KEYS_MAX) })) as ClubImportCheckResponse;
      for (const sha of response.known) known.add(sha);
      for (const key of response.knownEntries ?? []) knownEntries.add(key);
    }
    return { known, knownEntries };
  }

  return {
    status,
    async check(sha256) { return { known: (await status(sha256, [])).known }; },
    async uploadMap(sha256, file: SourceFile) {
      const name = file.path.split("/").pop() ?? "karta";
      const body = await sourceBlob(file);
      return await send(`content/${sha256}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body }, name) as { stored: "new" | "existing" };
    },
    async batch(body) { return await send("batch", json(body)) as BatchResult; }
  };
}
