import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import robots from "../app/robots";
import { AI_BOTS, NO_INDEX_HEADER, NO_INDEX_ROBOTS } from "./no-index";

/** Sökvägsmönster i next.config (`:namn` och `:namn*`) som reguljärt uttryck, tillräckligt för reglerna här. */
function sourceMatches(source: string, path: string): boolean {
  const pattern = source.replace(/\/:[A-Za-z]+\*/g, "(?:/.*)?").replace(/:[A-Za-z]+/g, "[^/]+");
  return new RegExp(`^${pattern}$`).test(path);
}

async function headersFor(path: string): Promise<Map<string, string>> {
  const rules = await nextConfig.headers!();
  const result = new Map<string, string>();
  for (const rule of rules) {
    if (!sourceMatches(rule.source, path)) continue;
    for (const header of rule.headers) result.set(header.key.toLowerCase(), header.value);
  }
  return result;
}

describe("inget publikt om löpare indexeras (ADR-0186)", () => {
  const closed = ["/results/abc", "/results/abc/splits", "/results/abc/participants/x", "/starts/abc", "/t/abcdef", "/t/abcdef/live",
    "/t/abcdef/qr", "/fest/abcdef", "/g/abcdef", `/kartfel/${"A".repeat(43)}`, `/api/public/map-link/${"A".repeat(43)}`, "/api/public/races/abc/results", "/api/public/races/abc/map",
    "/api/races/abc/start-list", "/api/races/abc/start-list/iof"];

  it("robots.txt stänger sidorna och API:t för alla och för AI-robotarna", () => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    const all = list.find(rule => rule.userAgent === "*");
    const bots = list.find(rule => Array.isArray(rule.userAgent));
    for (const rule of [all, bots]) {
      const disallow = [rule?.disallow ?? []].flat();
      for (const path of closed) expect(disallow.some(prefix => path.startsWith(prefix)), path).toBe(true);
      expect(disallow).not.toContain("/");
    }
    expect(bots?.userAgent).toEqual(expect.arrayContaining(["GPTBot", "ClaudeBot", "CCBot", "Google-Extended"]));
    expect(AI_BOTS.length).toBeGreaterThan(8);
  });

  it("X-Robots-Tag på alla publika sidor om löpare och på API:t, inte på startsidan eller Om", async () => {
    for (const path of closed) expect((await headersFor(path)).get("x-robots-tag"), path).toBe(NO_INDEX_HEADER.value);
    for (const path of ["/", "/om", "/integritet"]) expect((await headersFor(path)).has("x-robots-tag"), path).toBe(false);
  });

  it("robots-meta säger noindex och nofollow", () => {
    expect(NO_INDEX_ROBOTS).toMatchObject({ index: false, follow: false, noarchive: true });
  });

  it("bildoptimeringen är avstängd (next/image används inte)", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });
});
