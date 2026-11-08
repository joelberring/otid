/**
 * ADR-0219 (K2): tillbaka till godkännandet av en AI-koppling efter inloggningen. Bara sidan /oauth/authorize med sina
 * frågeparametrar sparas (sessionStorage i fliken, högst en halvtimme); inget annat kan bli målet. Ger ingen behörighet.
 */
const KEY = "otid.efterInloggning";
const LIFETIME_MS = 30 * 60_000;
const ALLOWED = /^\/oauth\/authorize\?[A-Za-z0-9._~%&=+:/-]{1,4000}$/;

function storage(): Storage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

export function saveAfterLogin(path: string, now = Date.now()): void {
  if (!ALLOWED.test(path)) return;
  try { storage()?.setItem(KEY, JSON.stringify({ path, expiresAt: now + LIFETIME_MS })); } catch { /* utan lagring: personen går tillbaka själv */ }
}

/** Sidan att gå till efter inloggningen (och glöm den), eller undefined. */
export function takeAfterLogin(now = Date.now()): string | undefined {
  let value: unknown;
  try { value = JSON.parse(storage()?.getItem(KEY) ?? "null"); } catch { return undefined; }
  try { storage()?.removeItem(KEY); } catch { /* inget att ta bort */ }
  if (!value || typeof value !== "object") return undefined;
  const { path, expiresAt } = value as { path?: unknown; expiresAt?: unknown };
  return typeof path === "string" && ALLOWED.test(path) && typeof expiresAt === "number" && expiresAt > now ? path : undefined;
}
