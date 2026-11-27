import type { Texts } from "./language";
import { clubArchiveSv } from "../i18n/club-archive-sv";
import { readOrganizerCsrf } from "./organizer-client";

/**
 * Lätta klientanrop mot `/api/organizer/clubs/...` m.fl. utan tunga beroenden till
 * kartfils-workern (`@o-tid/map-file`) eller banläggningen (`@o-tid/course-setting`).
 */
export const clubBase = (clubId: string) => `/api/organizer/clubs/${encodeURIComponent(clubId)}`;

export function csrf(): string | undefined {
  try { return readOrganizerCsrf(document.cookie, new URL(window.location.href)); } catch { return undefined; }
}

export async function clubRequest(path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET", body?: unknown)
  : Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const value = csrf();
    if (!value) return { status: 401, json: undefined };
    headers["x-otid-csrf"] = value;
  }
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) as unknown : undefined; } catch { json = undefined; }
  return { status: response.status, json };
}

export function clubFailure(status: number, errors: Texts<typeof clubArchiveSv.errors> = clubArchiveSv.errors): string {
  if (status === 401) return errors.session;
  if (status === 400) return errors.invalid;
  if (status === 403) return errors.forbidden;
  if (status === 404) return errors.notFound;
  if (status === 409) return errors.conflict;
  return errors.generic(status);
}
