import {
  readoutRereadCommitResponseSchema, readoutRereadPreviewResponseSchema,
  type ReadoutRereadCommitResponse, type ReadoutRereadItem, type ReadoutRereadPreviewResponse
} from "@o-tid/contracts";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { fetchWithRetry } from "./retrying-fetch";

/** Arbetsytans anrop för "Läs om avläsningar från rådata" (PLAN.md steg 36). */
const base = (raceId: string) => `/api/admin/races/${encodeURIComponent(raceId)}/administrator/readout-reread`;

export type ReadoutRereadFailure = "conflict" | "invalid" | "failed";

function csrf(): string {
  const value = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
  if (!value) throw new Error("csrf");
  return value;
}

function failure(status: number): ReadoutRereadFailure {
  return status === 409 ? "conflict" : status === 400 || status === 404 ? "invalid" : "failed";
}

/** Vilka avläsningar som blir andra vid omläsning (hela tävlingen, eller en deltagare). */
export async function previewReadoutReread(raceId: string, entryId?: string):
  Promise<{ ok: true; preview: ReadoutRereadPreviewResponse } | { ok: false; failure: ReadoutRereadFailure }> {
  const response = await fetchWithRetry(`${base(raceId)}/preview`, { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
    body: JSON.stringify({ formatVersion: 1, ...(entryId ? { entryId } : {}) }) });
  if (!response.ok) return { ok: false, failure: failure(response.status) };
  const preview = readoutRereadPreviewResponseSchema.parse(await response.json());
  if (preview.raceId !== raceId || (entryId && preview.entryId !== entryId)) throw new Error("scope");
  return { ok: true, preview };
}

/** Sparar de valda. Kastar när utfallet är okänt (samma requestId kan skickas igen). */
export async function applyReadoutReread(raceId: string, items: readonly ReadoutRereadItem[], requestId: string):
  Promise<{ ok: true; receipt: ReadoutRereadCommitResponse } | { ok: false; failure: ReadoutRereadFailure }> {
  const response = await fetchWithRetry(base(raceId), { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `readout-reread:${requestId}` },
    body: JSON.stringify({ formatVersion: 1, requestId,
      items: items.map((item) => ({ readoutId: item.readoutId, entryId: item.entryId, itemHash: item.itemHash })) }) });
  if (response.status === 409 || response.status === 400 || response.status === 404) return { ok: false, failure: failure(response.status) };
  if (!response.ok) throw new Error("commit");
  const receipt = readoutRereadCommitResponseSchema.parse(await response.json());
  if (receipt.raceId !== raceId || receipt.requestId !== requestId) throw new Error("receipt");
  return { ok: true, receipt };
}
