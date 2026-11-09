import { readOrganizerCsrf } from "./organizer-client";
import { trainingGroupSv } from "../i18n/training-group-sv";

/**
 * Steg 68: anropen från Mina grupper och ledarnas vy. Skrivningar skickar kontots CSRF-värde; saknas det är man inte
 * inloggad och svaret blir 401 utan att något skickas.
 */
export async function groupRequest(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown)
  : Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    try { headers["x-otid-csrf"] = readOrganizerCsrf(document.cookie, new URL(window.location.href)); }
    catch { return { status: 401, json: undefined }; }
  }
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) as unknown : undefined; } catch { json = undefined; }
  return { status: response.status, json };
}

/** Ett begripligt besked för ett misslyckat anrop. */
export function groupFailure(status: number, errors: typeof trainingGroupSv.leader.errors = trainingGroupSv.leader.errors): string {
  if (status === 401) return errors.session;
  if (status === 400) return errors.invalid;
  if (status === 404) return errors.notFound;
  if (status === 409) return errors.conflict;
  return errors.generic(status);
}

/** ISO-veckodag (1 = måndag) för ÅÅÅÅ-MM-DD. */
export function weekdayOf(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Antal tillfällen i en upprepning (samma regel som servern, för knappens text). */
export function repetitionCount(firstDate: string, lastDate: string): number {
  const first = Date.parse(`${firstDate}T12:00:00Z`), last = Date.parse(`${lastDate}T12:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return 0;
  return Math.floor((last - first) / (7 * 86_400_000)) + 1;
}
