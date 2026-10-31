import {
  mapBundleResponseSchema, mapPrintResponseSchema, mapReserveResponseSchema, type MapBundleResponse, type MapPrintList, type MapReserveDto
} from "@o-tid/contracts";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { fetchWithRetry } from "./retrying-fetch";

/** Steg 61: anropen för kartor till starten. */
const base = (raceId: string) => `/api/admin/races/${encodeURIComponent(raceId)}/administrator`;

function csrf(): string {
  const value = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
  if (!value) throw new Error("csrf");
  return value;
}

export async function fetchMapBundles(raceId: string): Promise<MapBundleResponse> {
  const response = await fetchWithRetry(`${base(raceId)}/map-bundles`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  const value = mapBundleResponseSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("scope");
  return value;
}

/** Sparar utskriften. `conflict` när listan har ändrats sedan den lästes in. */
export async function recordMapPrint(raceId: string, list: MapPrintList, stateHash: string): Promise<"printed" | "conflict"> {
  const response = await fetch(`${base(raceId)}/map-print`, { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": csrf() }, body: JSON.stringify({ formatVersion: 1, list, stateHash }) });
  if (response.status === 409) return "conflict";
  if (!response.ok) throw new Error(String(response.status));
  const value = mapPrintResponseSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("scope");
  return "printed";
}

export async function saveMapReserve(raceId: string, reserve: MapReserveDto): Promise<void> {
  const response = await fetch(`${base(raceId)}/map-reserve`, { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": csrf() }, body: JSON.stringify({ formatVersion: 1, reserve }) });
  if (!response.ok) throw new Error(String(response.status));
  if (mapReserveResponseSchema.parse(await response.json()).raceId !== raceId) throw new Error("scope");
}
