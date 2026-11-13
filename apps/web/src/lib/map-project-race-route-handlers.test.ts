import { describe, expect, it } from "vitest";
import type { Database } from "@o-tid/database";
import { mapProjectCurrentFileRoute, mapProjectRaceRoute } from "./map-project-race-route-handlers";

/**
 * Ägarens plan 2026-11-13, etapp 1: kartprojektets karta till banläggningen. Anropen avvisas innan databasen används – fel
 * Origin på skrivningen, utloggad och ett ogiltigt projekt-id. Databasen är en tom stomme: ett anrop som når den skulle kasta.
 * Rollerna (med i projektet, administratör i tävlingen) prövas i tjänsterna (`kartprojekt-banlaggning.test.ts` i application).
 */
const db = {} as Database;
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.klubb.se" } as const;
const id = "10000000-0000-4000-8000-000000000001";
const url = `https://tid.klubb.se/api/organizer/map-projects/${id}`;

describe("kartprojektets karta till banläggningen", () => {
  it("kopplingen (POST): fel Origin 403 och utloggad 401 före kroppen", async () => {
    const post = (headers: Record<string, string>) => new Request(`${url}/race`, { method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=grans", "x-otid-race-id": id, "x-otid-map-sha256": "a".repeat(64), ...headers },
      body: "inte multipart" });
    const foreign = await mapProjectRaceRoute(db, post({ origin: "https://annan.se" }), id, env);
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("cache-control")).toBe("private, no-store");
    expect((await mapProjectRaceRoute(db, post({ origin: env.O_TID_PUBLIC_ORIGIN }), id, env)).status).toBe(401);
  });

  it("ett ogiltigt projekt-id är 404 utan att något läses", async () => {
    expect((await mapProjectCurrentFileRoute(db, new Request(`${url}/current-file`), "inte-ett-id", env)).status).toBe(404);
    expect((await mapProjectRaceRoute(db, new Request(`${url}/race`, { method: "POST", headers: { origin: env.O_TID_PUBLIC_ORIGIN } }), "inte-ett-id", env)).status)
      .toBe(404);
  });
});
