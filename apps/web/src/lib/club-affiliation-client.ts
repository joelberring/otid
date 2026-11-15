import { clubRequest } from "./club-archive-client";

/** ADR-0209: som `clubRequest`, men ett nätfel blir status 0 i stället för ett undantag (knapparna låses aldrig upp annars). */
export async function affiliationRequest(path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET", body?: unknown)
  : Promise<{ status: number; json: unknown }> {
  try { return await clubRequest(path, method, body); } catch { return { status: 0, json: undefined }; }
}

/** Ägaren 2026-11-15: tävlingens arrangörsklubb (eller ingen) med samma anrop som Inställningar → Klubben och klubbarkivet. */
export async function saveRaceOrganiser(raceId: string, organisationId: string | null): Promise<boolean> {
  const result = await affiliationRequest(`/api/organizer/races/${encodeURIComponent(raceId)}/club-archive`, "PUT",
    { formatVersion: 1, organisationId });
  return result.status === 200;
}
