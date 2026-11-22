import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";

/**
 * Granskningen 3.1: de strömmande skrivningarna (kartfil, kartlager, DWG, kartan till tävlingen, återställning av tävling)
 * prövar sessionen och CSRF mot databasen innan kroppen börjar läsas. En påhittad kaka ger 401 och 403 utan att något
 * lagras: `stageMapContent` anropas aldrig och kroppen är orörd.
 */
const state = vi.hoisted(() => ({ auth: "unauthorized" as "unauthorized" | "forbidden" | "authenticated", staged: 0, authCalls: 0, previewed: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@o-tid/application", async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual,
    authenticateAccountSessionForWrite: async () => { state.authCalls += 1; return { status: state.auth }; },
    stageMapContent: async () => { state.staged += 1; return { kind: "empty" }; },
    previewRaceBackup: async () => { state.previewed += 1; return { status: "unauthorized" }; } };
});

const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.klubb.se" } as const;
const id = "10000000-0000-4000-8000-000000000001";
const db = {} as Database;

function post(path: string, headers: Record<string, string> = {}) {
  let read = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { read = true; controller.enqueue(new Uint8Array(8)); controller.close(); } }, { highWaterMark: 0 });
  const request = new Request(`https://tid.klubb.se${path}`, { method: "POST", body, duplex: "half",
    headers: { origin: env.O_TID_PUBLIC_ORIGIN, cookie: `__Host-otid-organizer-session=${"s".repeat(40)}; __Host-otid-organizer-csrf=${"c".repeat(43)}`,
      "x-otid-csrf": "c".repeat(43), ...headers } } as RequestInit);
  return { request, bodyRead: () => read };
}

const octet = { "content-type": "application/octet-stream", "content-length": "8" };
const routes = {
  "kartprojekt från fil": async (request: Request) => (await import("./map-project-route-handlers")).mapProjectUploadRoute(db, request, env),
  "kartlager": async (request: Request) => (await import("./map-project-layer-route-handlers")).mapProjectLayersRoute(db, request, id, env),
  "DWG-jobb": async (request: Request) => (await import("./geo-dwg-route-handlers")).geoDwgJobRoute(db, request, id, env),
  "kartan till tävlingen": async (request: Request) => (await import("./map-project-race-route-handlers")).mapProjectRaceRoute(db, request, id, env),
  "Använd igen": async (request: Request) => (await import("./club-route-handlers")).clubMapVersionTargetRoute(db, request, id, id, "race", env)
};

describe("strömmande skrivningar kräver giltig session före kroppen", { timeout: 60_000 }, () => {
  beforeEach(() => { state.auth = "unauthorized"; state.staged = 0; state.authCalls = 0; state.previewed = 0; });

  it.each(Object.entries(routes))("%s: ogiltig session ger 401 utan att kroppen läses eller lagras", async (_name, call) => {
    const { request, bodyRead } = post("/x", { ...octet, "x-otid-race-id": id, "content-type": _name === "kartan till tävlingen" || _name === "Använd igen" ? "multipart/form-data; boundary=abc" : "application/octet-stream" });
    const response = await call(request);
    expect(response.status).toBe(401);
    expect(state.authCalls).toBe(1);
    expect(state.staged).toBe(0);
    expect(bodyRead()).toBe(false);
  });

  it.each(Object.entries(routes))("%s: fel CSRF ger 403 före kroppen", async (_name, call) => {
    state.auth = "forbidden";
    const { request, bodyRead } = post("/x", { ...octet, "x-otid-race-id": id, "content-type": _name === "kartan till tävlingen" || _name === "Använd igen" ? "multipart/form-data; boundary=abc" : "application/octet-stream" });
    expect((await call(request)).status).toBe(403);
    expect(state.staged).toBe(0);
    expect(bodyRead()).toBe(false);
  });

  it("återställning av tävling: förhandsvisningen läser inte säkerhetskopian för en ogiltig session", async () => {
    const { raceRestorePreviewRoute, raceRestoreRoute } = await import("./race-restore-route-handlers");
    for (const route of [raceRestorePreviewRoute, raceRestoreRoute]) {
      const { request, bodyRead } = post("/api/organizer/restore", { "content-type": "application/zip", "content-length": "8" });
      expect((await route(db, request, env)).status).toBe(401);
      expect(bodyRead()).toBe(false);
    }
    expect(state.previewed).toBe(0);
  });
});
