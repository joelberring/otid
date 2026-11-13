import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseSettingRequirement, RaceRoleRequest } from "@o-tid/application";

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
  /** Steg 45: avläsningssidan skickar råramarna för en avläsning vars tider inte gick att tolka. */
  "admin/races/[raceId]/administrator/uninterpreted-readouts": ["POST"],
  "admin/races/[raceId]/administrator/unknown-readout-resolution": ["GET", "POST"],
  /** PLAN.md steg 25: direktanmälan på avläsningssidan. */
  "admin/races/[raceId]/administrator/readout-registrations": ["POST"],
  /** PLAN.md steg 29: sökning i löpardatabasen (uppdatera och radera bara administratören). */
  "admin/races/[raceId]/administrator/runner-database/search": ["POST"],
  "admin/races/[raceId]/administrator/forest-watch": ["GET"],
  "admin/races/[raceId]/administrator/manual-return": ["POST"],
  "admin/races/[raceId]/administrator/manual-return-withdrawal": ["POST"],
  "admin/races/[raceId]/administrator/start-correction": ["POST"],
  /** Steg 61: kartor till starten – läsa och skriva ut (reserven bara administratören). */
  "admin/races/[raceId]/administrator/map-bundles": ["GET"],
  "admin/races/[raceId]/administrator/map-print": ["POST"],
  "admin/races/[raceId]/administrator/speaker-board": ["GET"],
  "admin/races/[raceId]/administrator/relay": ["GET"],
  /** PLAN.md steg 40: festens läge, gästnamn och bardiskens in- och utcheckning (varor och ångra bara administratören). */
  "admin/races/[raceId]/administrator/party": ["GET"],
  "admin/races/[raceId]/administrator/party-guests": ["POST"],
  "admin/races/[raceId]/administrator/party-desk-events": ["POST"]
};
/**
 * Steg 66 (ADR-0181 beslut 5): banläggningens routes och vad de kräver. Den som bara har banläggningen (läsa och
 * kommentera) når dessa och inget annat; funktionären (utan banläggning) når inga av dem.
 */
const COURSE_SETTING: Record<string, Record<string, CourseSettingRequirement>> = {
  "admin/races/[raceId]/administrator/course-setting": { GET: "COMMENT", PUT: "EDIT" },
  "admin/races/[raceId]/administrator/course-setting/import": { POST: "EDIT" },
  "admin/races/[raceId]/administrator/course-setting/restore": { POST: "EDIT" },
  "admin/races/[raceId]/administrator/course-setting/revisions": { GET: "COMMENT" },
  "admin/races/[raceId]/administrator/course-setting/revisions/[version]": { GET: "COMMENT" },
  "admin/races/[raceId]/administrator/course-setting/original": { GET: "COMMENT" },
  "admin/races/[raceId]/administrator/course-setting/transfer": { POST: "ADMIN" },
  "admin/races/[raceId]/administrator/course-setting/edits": { POST: "EDIT" },
  "admin/races/[raceId]/administrator/course-setting/mode": { PUT: "ADMIN" },
  // ADR-0181 beslut 8: kartritaren (MAP) läser kartfelen, svarar, markerar klart och tar bort sina svar.
  "admin/races/[raceId]/administrator/course-setting/notes": { GET: "MAP", POST: "COMMENT" },
  "admin/races/[raceId]/administrator/course-setting/notes/[noteId]/replies": { POST: "MAP" },
  "admin/races/[raceId]/administrator/course-setting/notes/[noteId]/status": { PUT: "MAP" },
  "admin/races/[raceId]/administrator/course-setting/notes/[noteId]/photo": { GET: "COMMENT" },
  "admin/races/[raceId]/administrator/course-setting/notes/[noteId]": { DELETE: "COMMENT", PATCH: "COMMENT" },
  "admin/races/[raceId]/administrator/course-setting/notes/[noteId]/replies/[replyId]": { DELETE: "MAP", PATCH: "MAP" },
  // ADR-0214: länken till kartritaren, bara den som får ändra.
  "admin/races/[raceId]/administrator/course-setting/map-link": { GET: "EDIT", POST: "EDIT", DELETE: "EDIT" },
  "admin/races/[raceId]/administrator/course-setting/suggestions": { GET: "COMMENT", POST: "SUGGEST" },
  "admin/races/[raceId]/administrator/course-setting/suggestions/[suggestionId]/decision": { POST: "EDIT" },
  "admin/races/[raceId]/administrator/course-setting/events": { GET: "COMMENT" },
  // Steg 67: bankontrollanten (läsa och kommentera) bockar kontroller som kollade.
  "admin/races/[raceId]/administrator/course-setting/inspections": { GET: "COMMENT", PUT: "COMMENT" },
  // Steg 65: PDF för tryck, bara admin.
  "admin/races/[raceId]/administrator/course-setting/print-jobs": { GET: "ADMIN", POST: "ADMIN" },
  "admin/races/[raceId]/administrator/course-setting/print-jobs/[jobId]": { DELETE: "ADMIN" },
  "admin/races/[raceId]/administrator/course-setting/print-jobs/[jobId]/pdf": { GET: "ADMIN" },
  // Ägaren 2026-11-10: sparade utskrifter.
  "admin/races/[raceId]/administrator/course-setting/print-files": { GET: "COMMENT", POST: "EDIT" },
  "admin/races/[raceId]/administrator/course-setting/print-files/[fileId]": { GET: "COMMENT", DELETE: "EDIT" },
  // ADR-0197: papperets bilder (den som ändrar laddar upp, den som läser ser dem) och kontots mallbibliotek.
  "admin/races/[raceId]/administrator/course-setting/paper-images": { POST: "EDIT" },
  "admin/races/[raceId]/administrator/course-setting/paper-images/[sha256]": { GET: "COMMENT" },
  "admin/races/[raceId]/administrator/course-setting/paper-library": { GET: "EDIT", POST: "EDIT" },
  "admin/races/[raceId]/administrator/course-setting/paper-library/[templateId]": { DELETE: "EDIT" },
  "admin/races/[raceId]/administrator/map/source": { GET: "MAP" },
  "admin/races/[raceId]/administrator/map/source/[sha256]": { GET: "MAP" },
  "admin/races/[raceId]/administrator/map/project": { GET: "COMMENT" }
};
/** Publika routes under api/races (startlistor) har ingen inloggning och ingår inte. */
const PUBLIC = ["races/[raceId]/start-list", "races/[raceId]/start-list/iof"];

const origin = "http://127.0.0.1:3100";
const uuid = "10000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ role: "FUNCTIONARY" as "FUNCTIONARY" | "ADMIN" | "COURSE_COMMENT" | "COURSE_MAP", calls: 0 }));
const authenticate = vi.hoisted(() => async (_db: unknown, input: RaceRoleRequest) => {
  state.calls += 1;
  // Banläggning utan roll på eventet: ingen roll på tävlingen alls.
  if (state.role === "COURSE_COMMENT" || state.role === "COURSE_MAP") return { status: "unauthorized" as const };
  // Samma regel som tjänsterna: administratören får allt, funktionären bara funktionärens åtgärder.
  if (state.role === "FUNCTIONARY" && input.role === "ADMIN") return { status: "forbidden" as const };
  const id = "10000000-0000-4000-8000-000000000001";
  return { status: "authenticated" as const, principal: { accountId: id, sessionId: id, raceId: input.raceId, eventId: id,
    grantId: id, grantRole: state.role === "ADMIN" ? "OWNER" as const : "FUNCTIONARY" as const, role: state.role,
    expiresAt: "2026-10-05T20:00:00.000Z" } };
});

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: {}, pool: {}, database: {} }));
const authenticateCourseSetting = vi.hoisted(() => async (_db: unknown, input: { raceId: string; required: string }) => {
  state.calls += 1;
  const id = "10000000-0000-4000-8000-000000000001";
  // Funktionären har ingen banläggning (403); den med läsa och kommentera når bara COMMENT.
  if (state.role === "FUNCTIONARY") return { status: "forbidden" as const };
  if (state.role === "COURSE_COMMENT" && input.required !== "COMMENT" && input.required !== "MAP") return { status: "forbidden" as const };
  if (state.role === "COURSE_MAP" && input.required !== "MAP") return { status: "forbidden" as const };
  return { status: "authenticated" as const, principal: { accountId: id, displayName: "Anna", raceId: input.raceId, eventId: id,
    level: state.role === "ADMIN" ? "EDIT" as const : state.role === "COURSE_MAP" ? "MAP" as const : "COMMENT" as const, admin: state.role === "ADMIN" } };
});

/** ADR-0214: med kartritarens länk prövas nyckeln i tjänsten; här finns ingen giltig nyckel. */
const linkCalls = vi.hoisted(() => [] as string[]);
const invalidLink = vi.hoisted(() => (name: string) => async (_db: unknown, input: { token: string }) => {
  linkCalls.push(`${name}:${input.token}`);
  return { status: "invalid" as const };
});
vi.mock("@o-tid/application", async (importOriginal) => ({
  ...await importOriginal<typeof import("@o-tid/application")>(), requireRaceRole: authenticate,
  requireCourseSettingAccess: authenticateCourseSetting, readMapLinkView: invalidLink("view"), readMapLinkMapFile: invalidLink("map"),
  replyViaMapLink: invalidLink("reply"), setVerdictViaMapLink: invalidLink("verdict")
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
  const params = Promise.resolve({ raceId: uuid, entryId: uuid, classId: uuid, courseId: uuid, finalizationId: uuid, noteId: uuid,
    replyId: uuid, suggestionId: uuid, jobId: uuid, templateId: uuid, invitationId: uuid, sha256: "a".repeat(64), version: "1" });
  const write = method !== "GET";
  const response = await handlers[method]!(new Request(`${origin}/api/${route.path.replace("[sha256]", "a".repeat(64)).replaceAll(/\[[a-zA-Z]+\]/g, uuid)}`, {
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

  it("ger den som bara har banläggningen (läsa och kommentera) banläggningens läsning och notiser, inget annat", { timeout: 60_000 }, async () => {
    state.role = "COURSE_COMMENT";
    for (const path of Object.keys(COURSE_SETTING)) expect(routes.map(route => route.path), path).toContain(path);
    let reached = 0;
    for (const route of routes) {
      const handlers = await import(route.file) as Record<string, unknown>;
      for (const method of METHODS.filter(name => typeof handlers[name] === "function")) {
        // Strömmen är öppen tills den stängs; den prövas i banläggningens tester.
        // "Har jag en session?" svarar 200 med authenticated: false utan roll på tävlingen.
        if (route.path.endsWith("course-setting/events") || route.path.endsWith("administrator/session")) continue;
        const status = await call(route, method);
        const required = COURSE_SETTING[route.path]?.[method];
        const label = `${method} /api/${route.path} → ${status}`;
        if (required === "COMMENT" || required === "MAP") { expect([401, 403, 405], label).not.toContain(status); reached += 1; }
        else if (required) expect(status, label).toBe(403);
        else expect([401, 403], label).toContain(status);
      }
    }
    expect(reached).toBeGreaterThan(8);
  });

  it("ger kartritaren bara kartfilen och kartfelen (läsa, svara, klar), inte banläggningens dokument", { timeout: 60_000 }, async () => {
    state.role = "COURSE_MAP";
    const reached: string[] = [];
    for (const route of routes) {
      const handlers = await import(route.file) as Record<string, unknown>;
      for (const method of METHODS.filter(name => typeof handlers[name] === "function")) {
        if (route.path.endsWith("course-setting/events") || route.path.endsWith("administrator/session")) continue;
        const status = await call(route, method);
        const label = `${method} /api/${route.path} → ${status}`;
        if (COURSE_SETTING[route.path]?.[method] === "MAP") { expect([401, 403, 405], label).not.toContain(status); reached.push(`${method} ${route.path}`); }
        else expect([401, 403], label).toContain(status);
      }
    }
    expect(reached.sort()).toEqual(["DELETE admin/races/[raceId]/administrator/course-setting/notes/[noteId]/replies/[replyId]",
      "GET admin/races/[raceId]/administrator/course-setting/notes", "GET admin/races/[raceId]/administrator/map/source",
      "GET admin/races/[raceId]/administrator/map/source/[sha256]",
      "PATCH admin/races/[raceId]/administrator/course-setting/notes/[noteId]/replies/[replyId]",
      "POST admin/races/[raceId]/administrator/course-setting/notes/[noteId]/replies",
      "PUT admin/races/[raceId]/administrator/course-setting/notes/[noteId]/status"]);
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

/**
 * ADR-0214: routes som nyckeln i adressen ger behörighet till (kartritarens länk), utan konto och utan rollkontroll. De är
 * dokumenterade här i stället för i rolltabellerna: varje sådan route står i listan, en okänd nyckel ger samma 404
 * (LINK_INVALID) och skrivningarna avvisas (403) utan samma ursprung och kartritarens huvud innan tjänsten nås.
 */
const TOKEN_ROUTES: Record<string, readonly string[]> = {
  "public/map-link/[token]": ["GET"],
  "public/map-link/[token]/map": ["GET"],
  "map-link/[token]/notes/[noteId]/replies": ["POST"],
  "map-link/[token]/notes/[noteId]/verdict": ["POST"]
};

describe("routes med kartritarens länk (ADR-0214)", () => {
  const token = "B".repeat(43);
  const all = routeFiles(api).map(file => ({ file, path: relative(api, file).split(sep).slice(0, -1).join("/") }));
  const tokenRoutes = all.filter(route => route.path.includes("[token]"));
  beforeAll(() => { vi.stubEnv("O_TID_PUBLIC_ORIGIN", origin); vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterAll(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("har bara de dokumenterade routes med nyckel, och ingen av dem under admin", () => {
    expect(tokenRoutes.map(route => route.path).sort()).toEqual(Object.keys(TOKEN_ROUTES).sort());
    expect(tokenRoutes.some(route => route.path.startsWith("admin/"))).toBe(false);
  });

  it("svarar likadant (404) på en okänd nyckel och kräver samma ursprung för att skriva", async () => {
    for (const route of tokenRoutes) {
      const handlers = await import(route.file) as Record<string, (request: Request, context: unknown) => Promise<Response>>;
      expect(METHODS.filter(name => typeof handlers[name] === "function"), route.path).toEqual(TOKEN_ROUTES[route.path]);
      const url = `${origin}/api/${route.path.replace("[token]", token).replace("[noteId]", uuid)}`;
      const params = Promise.resolve({ token, noteId: uuid });
      for (const method of TOKEN_ROUTES[route.path]!) {
        linkCalls.length = 0;
        if (method === "GET") {
          const response = await handlers[method]!(new Request(url), { params });
          expect(response.status, route.path).toBe(404);
          expect(await response.json(), route.path).toEqual({ formatVersion: 1, error: "LINK_INVALID" });
          expect(response.headers.get("cache-control"), route.path).toBe("private, no-store");
          continue;
        }
        const body = JSON.stringify({ formatVersion: 1 });
        const json = { "content-type": "application/json" };
        for (const headers of [json, { ...json, origin: "https://annan.example" }, { ...json, origin }, { ...json, "x-otid-map-link": "1" },
          { ...json, origin: "https://annan.example", "x-otid-map-link": "1" }]) {
          const response = await handlers[method]!(new Request(url, { method, body, headers }), { params });
          expect(response.status, `${route.path} ${JSON.stringify(headers)}`).toBe(403);
        }
        expect(linkCalls, route.path).toEqual([]);
        const response = await handlers[method]!(new Request(url, { method, body, headers: { ...json, origin, "x-otid-map-link": "1" } }), { params });
        expect(response.status, route.path).toBe(404);
        expect(linkCalls.length, route.path).toBe(1);
      }
    }
  });
});
