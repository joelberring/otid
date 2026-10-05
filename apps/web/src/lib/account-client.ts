import { readOrganizerCsrf } from "./organizer-client";

/**
 * Anrop från kontosidorna (ADR-0172). Skrivande anrop skickar kontots CSRF-värde; saknas det är man inte
 * inloggad och svaret blir 401 utan att något skickas.
 */
export async function accountRequest(path: string, init: { method?: "GET" | "POST"; body?: unknown; csrf?: boolean } = {}):
  Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.csrf) {
    try { headers["x-otid-csrf"] = readOrganizerCsrf(document.cookie, new URL(window.location.href)); }
    catch { return { status: 401, json: undefined }; }
  }
  const response = await fetch(path, { method: init.method ?? "GET", credentials: "same-origin", cache: "no-store", headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
  const text = await response.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) as unknown : undefined; } catch { json = undefined; }
  return { status: response.status, json };
}
