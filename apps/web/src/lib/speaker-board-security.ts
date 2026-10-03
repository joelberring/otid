import { speakerBoardErrorResponseSchema, type EntryClassAdminErrorCode } from "@o-tid/contracts";
import {
  SPEAKER_BOARD_LOOPBACK_COOKIE_NAMES,
  SPEAKER_BOARD_PRODUCTION_COOKIE_NAMES,
  isSpeakerBoardLoopbackHostname,
  type SpeakerBoardCookieNames
} from "./speaker-board-cookies";

const SAFE_COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;
export const privateSpeakerBoardHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
} as const;
export interface SpeakerBoardSecurityPolicy { publicOrigin: string; cookieNames: SpeakerBoardCookieNames; secureCookies: boolean; }
export interface SpeakerBoardSessionProof { sessionToken: string | null; csrfCookie: string | null; csrfHeader: string | null; }
export class SpeakerBoardConfigurationError extends Error {}
export class SpeakerBoardRequestError extends Error {}

function configuredOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new SpeakerBoardConfigurationError("Ogiltig origin"); }
  if (value !== url.origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new SpeakerBoardConfigurationError("Icke-kanonisk origin");
  }
  return url;
}
export function speakerBoardSecurityPolicy(environment: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">> = process.env): SpeakerBoardSecurityPolicy {
  if (!environment.O_TID_PUBLIC_ORIGIN) throw new SpeakerBoardConfigurationError("Origin saknas");
  const origin = configuredOrigin(environment.O_TID_PUBLIC_ORIGIN);
  if (environment.NODE_ENV === "production") {
    if (origin.protocol !== "https:") throw new SpeakerBoardConfigurationError("HTTPS krävs");
    return { publicOrigin: origin.origin, cookieNames: SPEAKER_BOARD_PRODUCTION_COOKIE_NAMES, secureCookies: true };
  }
  if (origin.protocol !== "http:" || !isSpeakerBoardLoopbackHostname(origin.hostname)) {
    throw new SpeakerBoardConfigurationError("Endast loopback tillåts");
  }
  return { publicOrigin: origin.origin, cookieNames: SPEAKER_BOARD_LOOPBACK_COOKIE_NAMES, secureCookies: false };
}
export function hasExpectedSpeakerBoardOrigin(request: Request, policy: SpeakerBoardSecurityPolicy): boolean {
  return request.headers.get("origin") === policy.publicOrigin;
}
function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie"); if (!header) return null;
  let value: string | undefined;
  for (const part of header.split(";")) { const at = part.indexOf("="); if (at < 0 || part.slice(0, at).trim() !== name) continue;
    if (value !== undefined) return null; const candidate = part.slice(at + 1).trim(); if (!candidate || !SAFE_COOKIE_VALUE.test(candidate)) return null; value = candidate; }
  return value ?? null;
}
export function speakerBoardSessionProof(request: Request, policy: SpeakerBoardSecurityPolicy, requireCsrf: boolean): SpeakerBoardSessionProof {
  return { sessionToken: cookie(request, policy.cookieNames.session), csrfCookie: requireCsrf ? cookie(request, policy.cookieNames.csrf) : null,
    csrfHeader: requireCsrf ? request.headers.get("x-otid-csrf") : null };
}
export async function readSpeakerBoardJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json" || !request.body) throw new SpeakerBoardRequestError("Ogiltig body");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > 4096)) throw new SpeakerBoardRequestError("Ogiltig bodylängd");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength;
      if (length > 4096) throw new SpeakerBoardRequestError("Bodyn är för stor"); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  if (length === 0) throw new SpeakerBoardRequestError("Ogiltig body");
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; } catch { throw new SpeakerBoardRequestError("Ogiltig JSON"); }
}
export async function hasNoSpeakerBoardRequestBody(request: Request): Promise<boolean> {
  if (request.headers.get("content-type") !== null || (request.headers.get("content-length") !== null && request.headers.get("content-length") !== "0")) return false;
  if (request.body === null) return true;
  const reader = request.body.getReader();
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) return true; if (chunk.value.byteLength > 0) return false; } }
  finally { await reader.cancel(); }
}
function setCookie(name: string, value: string, policy: SpeakerBoardSecurityPolicy, httpOnly: boolean, expires: Date): string {
  if (!SAFE_COOKIE_VALUE.test(value)) throw new SpeakerBoardConfigurationError("Ogiltig cookie");
  return [`${name}=${value}`, "Path=/", `Expires=${expires.toUTCString()}`, "SameSite=Strict", ...(httpOnly ? ["HttpOnly"] : []), ...(policy.secureCookies ? ["Secure"] : [])].join("; ");
}
export function setSpeakerBoardCookies(response: Response, policy: SpeakerBoardSecurityPolicy, values: { sessionToken: string; csrfToken: string; expiresAt: string }): Response {
  const expires = new Date(values.expiresAt); if (!Number.isFinite(expires.getTime())) throw new SpeakerBoardConfigurationError("Ogiltig expiry");
  response.headers.append("set-cookie", setCookie(policy.cookieNames.session, values.sessionToken, policy, true, expires));
  response.headers.append("set-cookie", setCookie(policy.cookieNames.csrf, values.csrfToken, policy, false, expires)); return response;
}
export function clearSpeakerBoardCookies(response: Response, policy: SpeakerBoardSecurityPolicy): Response {
  const expired = new Date(0);
  response.headers.append("set-cookie", setCookie(policy.cookieNames.session, "deleted", policy, true, expired) + "; Max-Age=0");
  response.headers.append("set-cookie", setCookie(policy.cookieNames.csrf, "deleted", policy, false, expired) + "; Max-Age=0"); return response;
}
export function speakerBoardJson(body: unknown, status = 200): Response { return Response.json(body, { status, headers: privateSpeakerBoardHeaders }); }
export function speakerBoardFailure(status: 400 | 401 | 403 | 404 | 500, error: EntryClassAdminErrorCode): Response {
  return speakerBoardJson(speakerBoardErrorResponseSchema.parse({ formatVersion: 1, error }), status);
}
