/**
 * ADR-0206: från länksidan till inloggningen eller registreringen och tillbaka. Länksidan sparar adressen, sidan att hamna på och
 * om det gällde "Skapa konto" eller "Logga in" i webbläsaren (localStorage, ett dygn: bekräftelselänken öppnas ofta i en ny flik).
 * Inget av det ger någon behörighet; det fyller bara i adressen och väljer sidan efter inloggningen. Adressen står aldrig i en URL.
 */
const KEY = "otid.inbjudan";
const LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface InvitationHandoff { email: string; next: string; mode: "register" | "login"; expiresAt: number }

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Bara en sökväg i O-Tid (aldrig en annan webbplats; `//värd` vore en adress till en annan värd). */
export const safePath = (path: unknown): path is string => typeof path === "string" && /^\/(?!\/)[A-Za-z0-9/_-]{1,200}$/.test(path);

function storage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function saveInvitationHandoff(handoff: Omit<InvitationHandoff, "expiresAt">, now = Date.now()): void {
  try { storage()?.setItem(KEY, JSON.stringify({ ...handoff, expiresAt: now + LIFETIME_MS })); } catch { /* utan lagring: bara utan ifyllning */ }
}

export function readInvitationHandoff(now = Date.now()): InvitationHandoff | undefined {
  let value: unknown;
  try { value = JSON.parse(storage()?.getItem(KEY) ?? "null"); } catch { return undefined; }
  if (!value || typeof value !== "object") return undefined;
  const { email, next, mode, expiresAt } = value as Record<string, unknown>;
  if (typeof email !== "string" || !safePath(next) || (mode !== "register" && mode !== "login") || typeof expiresAt !== "number"
    || expiresAt <= now) {
    clearInvitationHandoff();
    return undefined;
  }
  return { email, next, mode, expiresAt };
}

export function clearInvitationHandoff(): void {
  try { storage()?.removeItem(KEY); } catch { /* inget att ta bort */ }
}

/** Efter inloggning eller bekräftelse: sidan i inbjudan om kontot har inbjudans adress (och glöm den), annars undefined. */
export function takeInvitationNext(accountEmail: string, now = Date.now()): string | undefined {
  const handoff = readInvitationHandoff(now);
  if (!handoff) return undefined;
  clearInvitationHandoff();
  return sameEmail(handoff.email, accountEmail) ? handoff.next : undefined;
}
