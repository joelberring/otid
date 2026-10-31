/**
 * Säkerhetshuvudenas innehåll (PLAN.md steg 46). Används av `proxy.ts` (Next-sidorna, med nonce) och `next.config.ts`
 * (alla svar, avläsningsskalet och API:t). Inga sidor får bäddas in i en ram: inget i O-Tid behöver det.
 *
 * - Sidorna: bara skript med sidans nonce (och de som de laddar, 'strict-dynamic') får köras. Stilar, bilder och anrop
 *   begränsas inte: React sätter style-attribut och festens färger, och det enda som laddas är från samma värd.
 * - Utvecklingsläget behöver 'unsafe-eval' (React bygger om felstackar med eval), aldrig i drift.
 * - Steg 59: kartfilen läses och ritas i en Worker från samma värd (byggverktyget kan starta den via en blob:-adress).
 */
export function pageContentSecurityPolicy(nonce: string, development: boolean): string {
  if (!/^[A-Za-z0-9+/=]{16,64}$/.test(nonce)) throw new Error("Ogiltig nonce");
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

/** Avläsningsskalet (/readout/): statiska filer från samma värd, inga inbäddade skript, service worker och Web Serial. */
export const READOUT_SHELL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; " +
  "connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** Avläsningen och bardisken läser stationen med Web Serial (dator) eller WebUSB (Android). */
export const READOUT_PERMISSIONS_POLICY = "camera=(), geolocation=(), microphone=(), serial=(self), usb=(self)";

/** Alla svar: ingen MIME-gissning, ingen full adress till andra sajter och ingen inbäddning i ram. */
export const BASE_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" }
] as const;
