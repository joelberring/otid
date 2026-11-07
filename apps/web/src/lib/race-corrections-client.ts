import {
  raceCorrectionCommitResponseSchema, raceCorrectionListResponseSchema, raceCorrectionPreviewResponseSchema,
  type RaceCorrectionAction, type RaceCorrectionCommitResponse, type RaceCorrectionListResponse, type RaceCorrectionPreviewResponse
} from "@o-tid/contracts";
import { adminFetch, fetchWithRetry } from "./retrying-fetch";

/** Arbetsytans anrop för rättningar för hela tävlingen (PLAN.md steg 31). */
const base = (raceId: string) => `/api/admin/races/${encodeURIComponent(raceId)}/administrator/race-corrections`;

export type RaceCorrectionFailure = "conflict" | "invalid" | "failed";

export async function fetchRaceCorrections(raceId: string): Promise<RaceCorrectionListResponse> {
  const response = await fetchWithRetry(base(raceId), { credentials: "same-origin" });
  if (!response.ok) throw new Error("list");
  const value = raceCorrectionListResponseSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("scope");
  return value;
}

function failure(status: number): RaceCorrectionFailure {
  return status === 409 ? "conflict" : status === 400 || status === 404 ? "invalid" : "failed";
}

export async function previewRaceCorrection(raceId: string, correction: RaceCorrectionAction):
  Promise<{ ok: true; preview: RaceCorrectionPreviewResponse } | { ok: false; failure: RaceCorrectionFailure }> {
  const response = await adminFetch(`${base(raceId)}/preview`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ formatVersion: 1, correction }) }, fetchWithRetry);
  if (!response.ok) return { ok: false, failure: failure(response.status) };
  const preview = raceCorrectionPreviewResponseSchema.parse(await response.json());
  if (preview.raceId !== raceId) throw new Error("scope");
  return { ok: true, preview };
}

/** Sparar med förhandsbeskedets hash. Kastar när utfallet är okänt (samma requestId kan skickas igen). */
export async function applyRaceCorrection(raceId: string, preview: RaceCorrectionPreviewResponse, requestId: string):
  Promise<{ ok: true; receipt: RaceCorrectionCommitResponse } | { ok: false; failure: RaceCorrectionFailure }> {
  const response = await adminFetch(base(raceId), { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `race-correction:${requestId}` },
    body: JSON.stringify({ formatVersion: 1, requestId, expectedPreviewHash: preview.previewHash, correction: preview.correction }) }, fetchWithRetry);
  if (response.status === 409 || response.status === 400 || response.status === 404) return { ok: false, failure: failure(response.status) };
  if (!response.ok) throw new Error("commit");
  const receipt = raceCorrectionCommitResponseSchema.parse(await response.json());
  if (receipt.raceId !== raceId || receipt.requestId !== requestId) throw new Error("receipt");
  return { ok: true, receipt };
}
