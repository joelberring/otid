/**
 * Inget publikt innehåll om löpare indexeras (ägarens beslut 2026-10-24, ADR-0186): många tävlingar har barn. Tre lager,
 * eftersom robotar läser olika saker: robots.txt (`app/robots.ts`), X-Robots-Tag på svaren (`next.config.ts`, också
 * API:t och bilder) och robots-meta på sidorna (layouterna under `/results`, `/starts` och `/t`).
 *
 * Startsidan, Om och Integritet indexeras som förut: de har inga löpare.
 */

/**
 * Sökvägar som robots.txt stänger (prefix). Fest (steg 40) och träningsgrupper (steg 68) fanns före beslutet. Hela API:t.
 * ADR-0214: kartritarens länk (/kartfel/<nyckel>).
 */
export const NO_INDEX_PATH_PREFIXES = ["/results/", "/starts/", "/t/", "/fest/", "/g/", "/kartfel/", "/api/"] as const;

/** next.config `headers()`-källor som får X-Robots-Tag. */
export const NO_INDEX_HEADER_SOURCES = ["/results/:path*", "/starts/:path*", "/t/:path*", "/fest/:path*", "/g/:path*", "/kartfel/:path*",
  "/api/:path*"] as const;

export const NO_INDEX_HEADER = { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noai, noimageai" } as const;

/** Next `Metadata.robots` för de publika sidorna: `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">`. */
export const NO_INDEX_ROBOTS = { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true } as const;

/** Kända AI-robotar som också stängs uttryckligen (somliga läser bara sitt eget avsnitt i robots.txt). */
export const AI_BOTS = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai", "CCBot",
  "Google-Extended", "PerplexityBot", "Perplexity-User", "Bytespider", "Applebot-Extended", "meta-externalagent", "Amazonbot"] as const;
