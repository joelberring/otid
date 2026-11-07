import {
  adminRouteChoiceSchema, routeChoiceCalibrationRoutesSchema, routeChoiceProblemSchema, type AdminRouteChoice, type RouteChoiceCalibrationRoutes,
  type RouteChoicePublishRequest, type RouteChoiceProblem, type RouteChoiceSettingsDto
} from "@o-tid/contracts";
import { readWithProgress } from "./download-progress";
import { adminFetch, fetchWithRetry } from "./retrying-fetch";

/**
 * Steg 60: vägvalsanalysens anrop från arbetsytan. Egna anrop (inte arbetsytans gemensamma operation), så att kartfilen
 * kan hämtas och vägvalen räknas utan att avbryta något annat. Bara admin; servern kontrollerar behörigheten.
 */
const base = (raceId: string) => `/api/admin/races/${encodeURIComponent(raceId)}/administrator`;

export async function fetchRouteChoice(raceId: string, signal?: AbortSignal): Promise<AdminRouteChoice> {
  const response = await fetchWithRetry(`${base(raceId)}/route-choice`, { credentials: "same-origin", cache: "no-store", signal: signal ?? null });
  if (!response.ok) throw new Error(String(response.status));
  const value = adminRouteChoiceSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("scope");
  return value;
}

/** Adressen till kartfilen; med filens sha256 får webbläsaren spara den (ADR-0218). */
export function mapSourceUrl(raceId: string, sha256?: string): string {
  return sha256 && /^[a-f0-9]{64}$/.test(sha256) ? `${base(raceId)}/map/source/${sha256}` : `${base(raceId)}/map/source`;
}

/**
 * Originalfilen (bara admin), för att räkna i webbläsaren. Med `sha256` (filen som tävlingen har enligt banläggningen)
 * används webbläsarens cache: samma fil hämtas inte igen (ADR-0218). `onProgress` får andelen som hämtats (0–1).
 */
export async function fetchMapSource(raceId: string, signal?: AbortSignal,
  options: { readonly sha256?: string | undefined; readonly onProgress?: ((fraction: number) => void) | undefined } = {})
  : Promise<{ bytes: ArrayBuffer; fileName: string }> {
  const url = mapSourceUrl(raceId, options.sha256);
  const response = await fetchWithRetry(url, { credentials: "same-origin", cache: url.endsWith("/map/source") ? "no-store" : "default",
    signal: signal ?? null });
  if (!response.ok) throw new Error(String(response.status));
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "karta.omap";
  return { bytes: await readWithProgress(response, options.onProgress), fileName };
}

export async function saveRouteChoiceSettings(raceId: string, settings: RouteChoiceSettingsDto): Promise<void> {
  const response = await adminFetch(`${base(raceId)}/route-choice/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formatVersion: 1, settings }) });
  if (!response.ok) throw new Error(String(response.status));
}

/** "Visa bästa vägval publikt" eller ta bort det. Ger det begripliga felet vid 422. */
export async function publishRouteChoice(raceId: string, request: RouteChoicePublishRequest): Promise<"ok" | RouteChoiceProblem> {
  const response = await adminFetch(`${base(raceId)}/route-choice/published`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  if (response.status === 422) {
    const parsed = routeChoiceProblemSchema.safeParse(await response.json());
    if (parsed.success) return parsed.data.error;
  }
  if (!response.ok) throw new Error(String(response.status));
  return "ok";
}

export async function fetchCalibrationRoutes(raceId: string, courseId: string): Promise<RouteChoiceCalibrationRoutes> {
  const response = await fetchWithRetry(`${base(raceId)}/courses/${encodeURIComponent(courseId)}/route-choice-calibration`,
    { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  const value = routeChoiceCalibrationRoutesSchema.parse(await response.json());
  if (value.raceId !== raceId || value.courseId !== courseId) throw new Error("scope");
  return value;
}
