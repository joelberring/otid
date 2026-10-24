import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaceRoleRequest } from "@o-tid/application";

/**
 * ADR-0172 beslut 3: varje adminroute (alla filer under app/api/admin och tävlingens import) anropas som funktionär.
 * Funktionären ska få 403 överallt utom i den uttryckliga listan nedan, och administratören ska aldrig få 403.
 * Listan här är skriven för hand och oberoende av `race-roles.ts`, så att en ny route eller en ändrad tabell syns.
 */
const FUNCTIONARY_ALLOWED: Record<string, readonly string[]> = {
  "admin/races/[raceId]/administrator/session": ["GET", "DELETE"],
  "admin/races/[raceId]/administrator/transfer-candidates": ["GET"],
  "admin/races/[raceId]/administrator/readout-package": ["GET"],
  "admin/races/[raceId]/administrator/readouts": ["POST"],
  "admin/races/[raceId]/administrator/unknown-readout-resolution": ["GET", "POST"],
  /** PLAN.md steg 25: direktanmälan på avläsningssidan. */
  "admin/races/[raceId]/administrator/readout-registrations": ["POST"],
  /** PLAN.md steg 29: sökning i löpardatabasen (uppdatera och radera bara administratören). */
  "admin/races/[raceId]/administrator/runner-database/search": ["POST"],
  "admin/races/[raceId]/administrator/forest-watch": ["GET"],
  "admin/races/[raceId]/administrator/manual-return": ["POST"],
  "admin/races/[raceId]/administrator/manual-return-withdrawal": ["POST"],
  "admin/races/[raceId]/administrator/start-correction": ["POST"],
  "admin/races/[raceId]/administrator/speaker-board": ["GET"],
  "admin/races/[raceId]/administrator/relay": ["GET"],
  /** PLAN.md steg 40: festens läge, gästnamn och bardiskens in- och utcheckning (varor och ångra bara administratören). */
  "admin/races/[raceId]/administrator/party": ["GET"],
  "admin/races/[raceId]/administrator/party-guests": ["POST"],
  "admin/races/[raceId]/administrator/party-desk-events": ["POST"]
};
/** Publika routes under api/races (startlistor) har ingen inloggning och ingår inte. */
const PUBLIC = ["races/[raceId]/start-list", "races/[raceId]/start-list/iof"];

const origin = "http://127.0.0.1:3100";
const uuid = "10000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ role: "FUNCTIONARY" as "FUNCTIONARY" | "ADMIN", calls: 0 }));
const authenticate = vi.hoisted(() => async (_db: unknown, input: RaceRoleRequest) => {
  state.calls += 1;
  // Samma regel som tjänsterna: administratören får allt, funktionären bara funktionärens åtgärder.
  if (state.role === "FUNCTIONARY" && input.role === "ADMIN") return { status: "forbidden" as const };
  const id = "10000000-0000-4000-8000-000000000001";
  return { status: "authenticated" as const, principal: { accountId: id, sessionId: id, raceId: input.raceId, eventId: id,
    grantId: id, grantRole: state.role === "ADMIN" ? "OWNER" as const : "FUNCTIONARY" as const, role: state.role,
    expiresAt: "2026-10-05T20:00:00.000Z" } };
});

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: {}, pool: {}, database: {} }));
vi.mock("@o-tid/application", async (importOriginal) => ({
  ...await importOriginal<typeof import("@o-tid/application")>(), requireRaceRole: authenticate
}));

const api = fileURLToPath(new URL("../app/api/", import.meta.url));
function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? routeFiles(join(directory, entry.name)) : entry.name === "route.ts" ? [join(directory, entry.name)] : []);
}
const routes = [...routeFiles(join(api, "admin")), ...routeFiles(join(api, "races"))]
  .map(file => ({ file, path: relative(api, file).split(sep).slice(0, -1).join("/") }))
  .filter(route => !PUBLIC.includes(route.path)).sort((a, b) => a.path.localeCompare(b.path));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

async function call(route: { file: string; path: string }, method: string): Promise<number> {
  const handlers = await import(route.file) as Record<string, (request: Request, context: unknown) => Promise<Response>>;
  const params = Promise.resolve({ raceId: uuid, entryId: uuid, classId: uuid, courseId: uuid, finalizationId: uuid });
  const write = method !== "GET";
  const response = await handlers[method]!(new Request(`${origin}/api/${route.path.replaceAll(/\[[a-zA-Z]+\]/g, uuid)}`, {
    method, ...(write ? { body: "{}" } : {}), headers: {
      origin, cookie: `otid_organizer_session=otid_user_session_v1.${uuid}.${"s".repeat(43)}; otid_organizer_csrf=${"c".repeat(43)}`,
      "x-otid-csrf": "c".repeat(43), ...(write ? { "content-type": "application/json" } : {})
    } }), { params });
  return response.status;
}

describe("behörighet per adminroute (ADR-0172 beslut 3)", () => {
  beforeAll(() => {
    vi.stubEnv("O_TID_PUBLIC_ORIGIN", origin);
    vi.stubEnv("NODE_ENV", "test");
    // Tjänsterna får en tom databas; ett tillåtet anrop slutar därför i ett internt fel, inte i 403.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterAll(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  beforeEach(() => { state.calls = 0; });

  it("hittar adminroutes och alla tillåtna routes finns", () => {
    expect(routes.length).toBeGreaterThan(70);
    for (const path of Object.keys(FUNCTIONARY_ALLOWED)) expect(routes.map(route => route.path), path).toContain(path);
  });

  it("ger funktionären 403 överallt utom avläsning, direktanmälan, kvar i skogen, start och speaker", { timeout: 60_000 }, async () => {
    state.role = "FUNCTIONARY";
    const checked: string[] = [];
    for (const route of routes) {
      const handlers = await import(route.file) as Record<string, unknown>;
      for (const method of METHODS.filter(name => typeof handlers[name] === "function")) {
        const status = await call(route, method);
        const allowed = FUNCTIONARY_ALLOWED[route.path]?.includes(method) ?? false;
        const label = `${method} /api/${route.path} → ${status}`;
        if (allowed) expect([401, 403, 405], label).not.toContain(status);
        else expect(status, label).toBe(403);
        checked.push(label);
      }
    }
    expect(checked.length).toBeGreaterThan(85);
  });

  it("ger administratören (som också har funktionärens rättigheter) tillträde till varje route", { timeout: 60_000 }, async () => {
    state.role = "ADMIN";
    for (const route of routes) {
      const handlers = await import(route.file) as Record<string, unknown>;
      for (const method of METHODS.filter(name => typeof handlers[name] === "function")) {
        const status = await call(route, method);
        expect([401, 403, 405], `${method} /api/${route.path} → ${status}`).not.toContain(status);
      }
    }
    expect(state.calls).toBeGreaterThan(85);
  });
});
