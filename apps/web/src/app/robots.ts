import type { MetadataRoute } from "next";

/**
 * robots.txt (PLAN.md steg 40): fest-sidorna (/fest/) och deras API stängs för alla robotar och särskilt för kända
 * AI-robotar. Tävlingssidorna påverkas inte. Fest-sidan har dessutom X-Robots-Tag (next.config) och en robots-meta.
 */
const PARTY = ["/fest/", "/api/public/parties/"];
const AI_BOTS = ["GPTBot", "ChatGPT-User", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended", "PerplexityBot", "Bytespider",
  "Applebot-Extended"];

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: PARTY }, { userAgent: AI_BOTS, disallow: PARTY }] };
}
