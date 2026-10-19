import {
  entryStatusReceiptSchema, entryStatusResponseSchema,
  type EntryStatusDecision, type EntryStatusReceipt, type EntryStatusRequest, type EntryStatusResponse
} from "@o-tid/contracts";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { fetchWithRetry } from "./retrying-fetch";

/** Arbetsytans anrop mot löparens status (ADR-0173 beslut 1: ett statusflöde, en route). */
function statusUrl(raceId: string, entryId: string): string {
  return `/api/admin/races/${encodeURIComponent(raceId)}/administrator/entries/${encodeURIComponent(entryId)}/status`;
}

export async function fetchEntryStatus(raceId: string, entryId: string): Promise<EntryStatusResponse> {
  const response = await fetch(statusUrl(raceId, entryId), { credentials: "same-origin" });
  if (!response.ok) throw new Error("status");
  const value = entryStatusResponseSchema.parse(await response.json());
  if (value.raceId !== raceId || value.entryId !== entryId) throw new Error("scope");
  return value;
}

export function entryStatusRequest(status: EntryStatusResponse, decision: EntryStatusDecision): EntryStatusRequest {
  return { formatVersion: 1, requestId: crypto.randomUUID(), expectedRevision: status.headRevision, decision };
}

/** Skickar beslutet. "conflict": underlaget har ändrats sedan läget lästes. Kastar när utfallet är okänt. */
export async function postEntryStatus(raceId: string, entryId: string, request: EntryStatusRequest):
  Promise<{ status: "decided"; receipt: EntryStatusReceipt } | { status: "conflict" }> {
  const csrf = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
  if (!csrf) throw new Error("csrf");
  const response = await fetchWithRetry(statusUrl(raceId, entryId), { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": csrf, "idempotency-key": `entry-status:${request.requestId}` },
    body: JSON.stringify(request) });
  if (response.status === 409) return { status: "conflict" };
  if (!response.ok) throw new Error("commit");
  const receipt = entryStatusReceiptSchema.parse(await response.json());
  if (receipt.raceId !== raceId || receipt.entryId !== entryId || receipt.requestId !== request.requestId) throw new Error("receipt");
  return { status: "decided", receipt };
}
