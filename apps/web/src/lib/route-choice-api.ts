import {
  adminRouteChoiceSchema, routeChoiceCalibrationRoutesSchema, routeChoiceProblemSchema, type AdminRouteChoice, type RouteChoiceCalibrationRoutes,
  type RouteChoicePublishRequest, type RouteChoiceProblem, type RouteChoiceSettingsDto
} from "@o-tid/contracts";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { fetchWithRetry } from "./retrying-fetch";

/**
 * Steg 60: vägvalsanalysens anrop från arbetsytan. Egna anrop (inte arbetsytans gemensamma operation), så att kartfilen
 * kan hämtas och vägvalen räknas utan att avbryta något annat. Bara admin; servern kontrollerar behörigheten.
 */
const base = (raceId: string) => `/api/admin/races/${encodeURIComponent(raceId)}/administrator`;

function csrf(): string {
  const value = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
  if (!value) throw new Error("csrf");
  return value;
}

export async function fetchRouteChoice(raceId: string, signal?: AbortSignal): Promise<AdminRouteChoice> {
  const response = await fetchWithRetry(`${base(raceId)}/route-choice`, { credentials: "same-origin", cache: "no-store", signal: signal ?? null });
  if (!response.ok) throw new Error(String(response.status));
  const value = adminRouteChoiceSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("scope");
  return value;
}

/** Originalfilen (bara admin), för att räkna i webbläsaren. */
export async function fetchMapSource(raceId: string, signal?: AbortSignal): Promise<{ bytes: ArrayBuffer; fileName: string }> {
  const response = await fetchWithRetry(`${base(raceId)}/map/source`, { credentials: "same-origin", cache: "no-store", signal: signal ?? null });
  if (!response.ok) throw new Error(String(response.status));
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "karta.omap";
  return { bytes: await response.arrayBuffer(), fileName };
}

export async function saveRouteChoiceSettings(raceId: string, settings: RouteChoiceSettingsDto): Promise<void> {
  const response = await fetch(`${base(raceId)}/route-choice/settings`, { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": csrf() }, body: JSON.stringify({ formatVersion: 1, settings }) });
  if (!response.ok) throw new Error(String(response.status));
}

/** "Visa bästa vägval publikt" eller ta bort det. Ger det begripliga felet vid 422. */
export async function publishRouteChoice(raceId: string, request: RouteChoicePublishRequest): Promise<"ok" | RouteChoiceProblem> {
  const response = await fetch(`${base(raceId)}/route-choice/published`, { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": csrf() }, body: JSON.stringify(request) });
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
