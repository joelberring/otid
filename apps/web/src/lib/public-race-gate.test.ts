import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-0172 beslut 4: varje publik API-route (resultat, sträckor, karta, resultatströmmen, IOF/CSV-exporter och
 * startlistan) går genom samma grind. En tävling som inte syns ger 404 innan något läses, och en förhandsvisning
 * får aldrig en delad cache.
 */
const state = vi.hoisted(() => ({ access: "NONE" as "NONE" | "PREVIEW" | "PUBLIC", calls: [] as [string, string | null][], cookie: "" }));
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: {}, pool: {}, database: {} }));
vi.mock("@o-tid/application", async (importOriginal) => {
  // Varje tjänst kastar "reached:<namn>" så att testet ser att grinden släppt igenom anropet; grinden själv styrs av `state`.
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([name, value]) => [name, name === "publicRaceAccess"
    ? async (_db: unknown, id: string, token: string | null) => { state.calls.push([id, token]); return state.access; }
    : typeof value === "function" && /^[a-z]/.test(name) ? async () => { throw new Error(`reached:${name}`); } : value]));
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) =>
  state.cookie && name === "otid_organizer_session" ? { name, value: state.cookie } : undefined }) }));

const api = fileURLToPath(new URL("../app/api/", import.meta.url));
function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? routeFiles(join(directory, entry.name)) : entry.name === "route.ts" ? [join(directory, entry.name)] : []);
}
const routes = [...routeFiles(join(api, "public")), ...routeFiles(join(api, "races"))]
  .map(file => ({ file, path: relative(api, file).split(sep).slice(0, -1).join("/") }))
  .filter(route => route.path !== "races/[raceId]/imports").sort((a, b) => a.path.localeCompare(b.path));
const raceId = "10000000-0000-4000-8000-000000000001";

async function call(route: { file: string; path: string }) {
  const handlers = await import(route.file) as Record<string, (request: Request, context: unknown) => Promise<Response>>;
  const params = Promise.resolve({ raceId, publicResultId: raceId, finalizationId: raceId });
  return handlers.GET!(new Request(`http://127.0.0.1:3100/api/${route.path.replaceAll(/\[[a-zA-Z]+\]/g, raceId)}`), { params });
}

describe("publika routes bakom grinden (ADR-0172 beslut 4)", () => {
  beforeEach(() => { state.calls = []; state.cookie = ""; vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterAll(() => { vi.restoreAllMocks(); });

  it("hittar resultat, ström, karta, exporter och startlistor", () => {
    expect(routes.map(route => route.path)).toEqual(expect.arrayContaining([
      "public/races/[raceId]/result-events", "public/races/[raceId]/results", "public/races/[raceId]/iof-results",
      "public/races/[raceId]/map", "races/[raceId]/start-list", "races/[raceId]/start-list/iof"]));
    expect(routes.length).toBeGreaterThanOrEqual(9);
  });

  it.each(routes)("$path ger 404 när tävlingen inte syns och läser inget", async route => {
    state.access = "NONE";
    const response = await call(route);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.calls).toEqual([[raceId, null]]);
  });

  it.each(routes)("$path släpps igenom för en publicerad tävling", async route => {
    state.access = "PUBLIC";
    // Tjänsten nås: den kastar, eller så gör routen själv om felet till ett serverfel. Aldrig grindens 404.
    const outcome = await call(route).then(response => response.status, (error: Error) => error.message);
    expect(String(outcome)).toMatch(/^(reached:|5\d\d$)/);
  });

  it("skickar kontots cookie för förhandsvisning och sparar inte svaret i delad cache", async () => {
    const { publicRaceResponse } = await import("./public-race-gate");
    state.access = "PREVIEW"; state.cookie = "otid_user_session_v1.abc";
    const response = await publicRaceResponse(raceId, () => Response.json({}, { headers: { "cache-control": "public, max-age=60" } }));
    expect(response.headers.get("cache-control")).toBe("private, no-store, no-transform");
    expect(state.calls).toEqual([[raceId, "otid_user_session_v1.abc"]]);
    state.access = "PUBLIC";
    const open = await publicRaceResponse(raceId, () => Response.json({}, { headers: { "cache-control": "public, max-age=60" } }));
    expect(open.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
