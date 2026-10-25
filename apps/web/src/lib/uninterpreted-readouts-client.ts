import {
  uninterpretedReadoutListResponseSchema, uninterpretedReadoutRereadResponseSchema,
  type UninterpretedReadoutListResponse, type UninterpretedReadoutRereadRequest, type UninterpretedReadoutRereadResponse
} from "@o-tid/contracts";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { fetchWithRetry } from "./retrying-fetch";

/** Arbetsytans anrop för otolkade avläsningar (steg 45). */
const base = (raceId: string) => `/api/admin/races/${encodeURIComponent(raceId)}/administrator/uninterpreted-readouts`;

export async function listUninterpretedReadouts(raceId: string): Promise<UninterpretedReadoutListResponse> {
  const response = await fetchWithRetry(base(raceId), { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("list");
  const value = uninterpretedReadoutListResponseSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("scope");
  return value;
}

/** "Läs om". 409 = redan omläst på annat sätt; kastar när utfallet är okänt (samma requestId kan skickas igen). */
export async function rereadUninterpretedReadout(raceId: string, request: UninterpretedReadoutRereadRequest):
  Promise<{ ok: true; response: UninterpretedReadoutRereadResponse } | { ok: false; failure: "conflict" | "invalid" }> {
  const csrf = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
  if (!csrf) throw new Error("csrf");
  const response = await fetchWithRetry(`${base(raceId)}/reread`, { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": csrf }, body: JSON.stringify(request) });
  if (response.status === 409) return { ok: false, failure: "conflict" };
  if (response.status === 400 || response.status === 404) return { ok: false, failure: "invalid" };
  if (!response.ok) throw new Error("reread");
  const value = uninterpretedReadoutRereadResponseSchema.parse(await response.json());
  if (value.raceId !== raceId || value.requestId !== request.requestId) throw new Error("receipt");
  return { ok: true, response: value };
}
