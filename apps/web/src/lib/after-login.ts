import { isLoginReturnPath } from "./safe-return";

/**
 * ADR-0219 (K2): tillbaka till godkännandet av en AI-koppling efter inloggningen. Användartestet 2026-11-12: också tillbaka
 * till tävlingens sida (/admin/…) eller en undersida under Mina tävlingar (/organizer/…) där inloggningen saknades. Bara de
 * sökvägarna sparas (sessionStorage i fliken, högst en halvtimme); inget annat kan bli målet. Ger ingen behörighet.
 */
const KEY = "otid.efterInloggning";
const LIFETIME_MS = 30 * 60_000;
const OAUTH = /^\/oauth\/authorize\?[A-Za-z0-9._~%&=+:/-]{1,4000}$/;
const allowed = (path: string) => OAUTH.test(path) || isLoginReturnPath(path);

function storage(): Storage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

export function saveAfterLogin(path: string, now = Date.now()): void {
  if (!allowed(path)) return;
  try { storage()?.setItem(KEY, JSON.stringify({ path, expiresAt: now + LIFETIME_MS })); } catch { /* utan lagring: personen går tillbaka själv */ }
}

/** Sidan att gå till efter inloggningen (och glöm den), eller undefined. */
export function takeAfterLogin(now = Date.now()): string | undefined {
  let value: unknown;
  try { value = JSON.parse(storage()?.getItem(KEY) ?? "null"); } catch { return undefined; }
  try { storage()?.removeItem(KEY); } catch { /* inget att ta bort */ }
  if (!value || typeof value !== "object") return undefined;
  const { path, expiresAt } = value as { path?: unknown; expiresAt?: unknown };
  return typeof path === "string" && allowed(path) && typeof expiresAt === "number" && expiresAt > now ? path : undefined;
}

/** Användartestet 2026-11-12: sidan man står på, att komma tillbaka till efter inloggningen under Mina tävlingar. */
export function rememberCurrentPageForLogin(): void {
  saveAfterLogin(`${window.location.pathname}${window.location.search}`);
}
