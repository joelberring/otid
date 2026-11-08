import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_INDEX_PATH_PREFIXES } from "./no-index";
import { PUBLIC_PATHS } from "./public-paths";

const webRoot = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(webRoot, "src/app");
const caddyfile = readFileSync(path.resolve(webRoot, "../../deploy/Caddyfile"), "utf8");

/** Sökvägarna i matchern `@public { path … }` i deploy/Caddyfile. */
function caddyPublicPaths(): string[] {
  const block = /^\s*@public\s*\{([\s\S]*?)^\s*\}/m.exec(caddyfile)?.[1];
  if (!block) throw new Error("Hittar inte matchern @public i deploy/Caddyfile");
  const lines = block.split("\n").map(line => line.trim()).filter(line => line.startsWith("path "));
  expect(lines).toHaveLength(1);
  return lines[0]!.split(/\s+/).slice(1);
}

/** Caddys `path`-matchare: utan `*` exakt, `*` sist prefix, annars glob där `*` inte matchar `/`. */
function caddyPathMatches(pattern: string, requestPath: string): boolean {
  if (!pattern.includes("*")) return pattern === requestPath;
  if (pattern.indexOf("*") === pattern.length - 1) return requestPath.startsWith(pattern.slice(0, -1));
  const glob = pattern.split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${glob}$`).test(requestPath);
}

const isPublic = (requestPath: string) => PUBLIC_PATHS.some(pattern => caddyPathMatches(pattern, requestPath));

/** Alla sidor och route handlers under src/app som adresser (dynamiska delar blir `x`), med filens innehåll. */
function appRoutes(dir = appDir): { url: string; source: string }[] {
  const routes: { url: string; source: string }[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) routes.push(...appRoutes(full));
    else if (name === "page.tsx" || name === "route.ts") {
      const segments = path.relative(appDir, dir).split(path.sep).filter(Boolean).map(segment => segment.startsWith("[") ? "x" : segment);
      routes.push({ url: `/${segments.join("/")}`, source: readFileSync(full, "utf8") });
    }
  }
  return routes;
}

/** Översta delar under src/app som aldrig är publika: arbetsytan, admin, konto och inloggningens flöden (ADR-0177). */
const NOT_PUBLIC_SECTIONS = ["admin", "organizer", "superadmin", "konto", "inbjudan", "recover", "verify", "oauth"];
/** API:er som aldrig är publika; `/api/public/…` och startlistan är det. */
const NOT_PUBLIC_API = ["account", "admin", "club-import", "health", "invitation", "map-link", "oauth", "organizer", "superadmin"];
/** ADR-0219 (K2): MCP med åtkomstnyckel och utan kakor går till de publika instanserna (AI tar aldrig tävlingens instans). */
const PUBLIC_API = ["public", "mcp"];

describe("publika sökvägar (ADR-0177): en lista i koden och i deploy/Caddyfile", () => {
  it("matchern @public i Caddyfile har exakt sökvägarna i PUBLIC_PATHS", () => {
    const fromCaddy = caddyPublicPaths();
    expect(new Set(fromCaddy).size).toBe(fromCaddy.length);
    expect([...fromCaddy].sort()).toEqual([...PUBLIC_PATHS].sort());
  });

  it("matchern gäller bara den som saknar sessionskaka", () => {
    expect(caddyfile).toMatch(/@public\s*\{[^}]*not header_regexp Cookie[^}]*__Host-otid-organizer-session/);
  });

  it("varje sida eller route som läser med publikens pool (publicDb) är publik", () => {
    const users = appRoutes().filter(route => /\bpublicDb\b/.test(route.source));
    expect(users.length).toBeGreaterThan(0);
    for (const route of users) expect(isPublic(route.url), route.url).toBe(true);
  });

  it("sidor som inte indexeras (no-index.ts) är publika", () => {
    for (const prefix of NO_INDEX_PATH_PREFIXES.filter(prefix => prefix !== "/api/")) expect(PUBLIC_PATHS, prefix).toContain(`${prefix}*`);
  });

  it("varje avsnitt under src/app är antingen publikt eller uttryckligen inte; inget av admin, konto eller arbetsytan är publikt", () => {
    for (const { url } of appRoutes()) {
      const [section = "", sub = ""] = url.split("/").slice(1);
      if (section === "api") {
        if (PUBLIC_API.includes(sub)) expect(isPublic(url), url).toBe(true);
        else if (/^\/api\/races\/x\/start-list(\/|$)/.test(url)) expect(isPublic(url), url).toBe(true);
        else {
          expect(isPublic(url), url).toBe(false);
          if (sub !== "races") expect(NOT_PUBLIC_API, url).toContain(sub);
        }
      } else if (NOT_PUBLIC_SECTIONS.includes(section)) expect(isPublic(url), url).toBe(false);
      else expect(isPublic(url), url).toBe(true);
    }
    for (const sample of ["/organizer", "/organizer/x", "/admin/x", "/superadmin", "/konto", "/readout/", "/course-setting-sw.js", "/map-project-sw.js",
      "/api/races/x/imports", "/api/admin/races/x/administrator/map/source", "/api/map-link/x/reply"]) {
      expect(isPublic(sample), sample).toBe(false);
    }
  });

  it("webbläsarens filer för de publika sidorna (ikoner och manifest) är publika", () => {
    for (const name of readdirSync(appDir)) {
      const file = { "favicon.ico": "/favicon.ico", "icon.svg": "/icon.svg", "apple-icon.png": "/apple-icon.png",
        "manifest.ts": "/manifest.webmanifest", "robots.ts": "/robots.txt" }[name];
      if (file) expect(isPublic(file), file).toBe(true);
    }
    for (const name of readdirSync(path.join(webRoot, "public/icons"))) expect(isPublic(`/icons/${name}`), name).toBe(true);
    expect(isPublic("/_next/static/chunks/a.js")).toBe(true);
  });

  it("matcharen följer Caddys regler för *", () => {
    expect(caddyPathMatches("/api/races/*/start-list", "/api/races/abc/start-list")).toBe(true);
    expect(caddyPathMatches("/api/races/*/start-list", "/api/races/a/b/start-list")).toBe(false);
    expect(caddyPathMatches("/results/*", "/results/abc/splits")).toBe(true);
    expect(caddyPathMatches("/results", "/results/abc")).toBe(false);
  });
});
