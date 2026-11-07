import {
  mapLinkCreatedSchema, mapLinkStateSchema, mapLinkViewSchema, type MapLinkCreated, type MapLinkState, type MapLinkView, type MapMakerVerdict
} from "@o-tid/contracts";
import { courseSettingBase } from "./course-setting-api";
import { adminFetch, fetchUntilReached, fetchWithRetry } from "./retrying-fetch";

/**
 * ADR-0214: anropen för kartritarens länk. Banläggaren (inloggad, CSRF) läser läget, skapar och stänger av länken.
 * Sidan med länken (utan konto) läser kartfelen och kartfilen och skickar svar och besked med huvudet `x-otid-map-link`.
 */
export class MapLinkHttpError extends Error {
  constructor(readonly status: number) { super(String(status)); }
}

async function parsed<T>(response: Response, schema: { parse: (value: unknown) => T }): Promise<T> {
  if (!response.ok) throw new MapLinkHttpError(response.status);
  return schema.parse(await response.json());
}

const adminUrl = (raceId: string) => `${courseSettingBase(raceId)}/course-setting/map-link`;
const adminWrite = (raceId: string, method: "POST" | "DELETE", body: unknown) => adminFetch(adminUrl(raceId), { method,
  headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, fetchUntilReached);

export async function fetchMapLinkState(raceId: string): Promise<MapLinkState> {
  return parsed(await fetchWithRetry(adminUrl(raceId), { credentials: "same-origin", cache: "no-store" }), mapLinkStateSchema);
}
export async function createMapLink(raceId: string, request: { lastDay: string | null; showRaceName: boolean }): Promise<MapLinkCreated> {
  return parsed(await adminWrite(raceId, "POST", { formatVersion: 1, ...request }), mapLinkCreatedSchema);
}
export async function revokeMapLink(raceId: string): Promise<MapLinkState> {
  return parsed(await adminWrite(raceId, "DELETE", {}), mapLinkStateSchema);
}

/** Länkens adress på den här servern. */
export const mapLinkUrl = (token: string, origin = window.location.origin) => `${origin}/kartfel/${token}`;

export async function fetchMapLinkView(token: string): Promise<MapLinkView> {
  return parsed(await fetchWithRetry(`/api/public/map-link/${encodeURIComponent(token)}`, { cache: "no-store", credentials: "omit" }),
    mapLinkViewSchema);
}

/** Kartfilen; 404 betyder ingen kartfil (eller att länken inte gäller, som visas när kartfelen läses om). */
export async function fetchMapLinkMap(token: string, signal: AbortSignal): Promise<{ bytes: ArrayBuffer; fileName: string }> {
  const response = await fetchWithRetry(`/api/public/map-link/${encodeURIComponent(token)}/map`, { credentials: "omit", signal });
  if (!response.ok) throw new MapLinkHttpError(response.status);
  const fileName = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "karta.omap";
  return { bytes: await response.arrayBuffer(), fileName };
}

const linkWrite = async (token: string, noteId: string, path: "replies" | "verdict", body: unknown) => {
  const response = await fetchUntilReached(`/api/map-link/${encodeURIComponent(token)}/notes/${encodeURIComponent(noteId)}/${path}`, {
    method: "POST", credentials: "omit", headers: { "content-type": "application/json", "x-otid-map-link": "1" }, body: JSON.stringify(body) });
  if (!response.ok) throw new MapLinkHttpError(response.status);
};

export async function replyWithMapLink(token: string, noteId: string, text: string, name: string | null): Promise<void> {
  await linkWrite(token, noteId, "replies", { formatVersion: 1, requestId: crypto.randomUUID(), text, name });
}
export async function verdictWithMapLink(token: string, noteId: string, verdict: MapMakerVerdict, text: string, name: string | null): Promise<void> {
  await linkWrite(token, noteId, "verdict", { formatVersion: 1, requestId: crypto.randomUUID(), verdict, text, name });
}
