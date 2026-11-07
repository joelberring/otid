/**
 * Steg 54 (ADR-0177): sökvägarna som Caddy skickar till publikens instanser (`web-public`/`web-public2`) när besökaren inte
 * har någon sessionskaka. Samma lista, i samma ordning och med Caddys syntax, står i matchern `@public` i `deploy/Caddyfile`;
 * `public-paths.test.ts` kräver att de stämmer. Ändra båda samtidigt (och kör `dc restart caddy` på servern, docs/drift.md).
 *
 * Caddys `path`: utan `*` hela sökvägen, `*` sist = prefix, `*` mitt i = tecken utom `/`.
 * Allt annat (arbetsytan, admin, konto, inloggning, svaren på kartritarens länk) går till `web`.
 */
export const PUBLIC_PATHS = [
  "/", "/om", "/integritet",
  "/results", "/results/*", "/starts", "/starts/*", "/t/*", "/fest/*", "/g/*", "/kartfel/*",
  "/api/public/*", "/api/races/*/start-list", "/api/races/*/start-list/*",
  "/_next/static/*", "/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest", "/icons/*", "/robots.txt"
] as const;
