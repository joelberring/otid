import type { MetadataRoute } from "next";
import { AI_BOTS, NO_INDEX_PATH_PREFIXES } from "../lib/no-index";

/**
 * robots.txt: de publika sidorna om löpare (resultat, startlistor, tävlingssidan /t/, fester och träningsgrupper) och hela
 * API:t stängs för alla robotar och uttryckligen för kända AI-robotar (ägarens beslut 2026-10-24, ADR-0186; tidigare bara
 * /fest/ och /g/). Sidorna har dessutom X-Robots-Tag (next.config) och robots-meta (`lib/no-index.ts`).
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [...NO_INDEX_PATH_PREFIXES];
  return { rules: [{ userAgent: "*", disallow }, { userAgent: [...AI_BOTS], disallow }] };
}
