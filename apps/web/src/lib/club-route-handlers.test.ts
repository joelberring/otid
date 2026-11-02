import { describe, expect, it } from "vitest";
import type { Database } from "@o-tid/database";
import { clubCreateRoute, clubImportBatchRoute, clubImportContentRoute, clubMapVersionTargetRoute } from "./club-route-handlers";

/**
 * ADR-0194: anropen avvisas innan databasen används – fel Origin på arrangörens skrivningar, importen utan nyckel eller med
 * fel innehållstyp. Databasen är en tom stomme: ett anrop som når den skulle kasta.
 */
const db = {} as Database;
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.klubb.se" } as const;
const club = "10000000-0000-4000-8000-000000000001";

describe("klubbarkivets anrop", () => {
  it("arrangörens skrivningar kräver rätt Origin", async () => {
    const response = await clubCreateRoute(db, new Request("https://tid.klubb.se/api/organizer/clubs", { method: "POST",
      headers: { origin: "https://annan.se", "content-type": "application/json" }, body: "{}" }), env);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("Använd igen kräver tävlingens id i rubriken", async () => {
    const response = await clubMapVersionTargetRoute(db, new Request(`https://tid.klubb.se/api/organizer/clubs/${club}/map-versions/${club}/race`,
      { method: "POST", headers: { origin: env.O_TID_PUBLIC_ORIGIN } }), club, club, "race", env);
    expect(response.status).toBe(400);
  });

  it("importen: utan nyckel 401, fel innehållstyp 400, en för stor fil 422 – innan något läses", async () => {
    const put = (headers: Record<string, string>) => new Request(`https://tid.klubb.se/api/club-import/${club}/content/${"a".repeat(64)}`,
      { method: "PUT", headers, body: "x" });
    expect((await clubImportContentRoute(db, put({ "content-type": "application/octet-stream" }), club, "a".repeat(64))).status).toBe(401);
    const bearer = { authorization: `Bearer otid-imp-${"A".repeat(43)}` };
    expect((await clubImportContentRoute(db, put({ ...bearer, "content-type": "text/plain" }), club, "a".repeat(64))).status).toBe(400);
    const large = await clubImportContentRoute(db, put({ ...bearer, "content-type": "application/octet-stream", "content-length": String(200 * 1024 * 1024) }),
      club, "a".repeat(64));
    expect(large.status).toBe(422);
    expect(await large.json()).toEqual({ formatVersion: 1, error: "MAP_FILE_TOO_LARGE" });
    const batch = await clubImportBatchRoute(db, new Request(`https://tid.klubb.se/api/club-import/${club}/batch`, { method: "POST",
      headers: { ...bearer, "content-type": "text/plain" }, body: "{}" }), club);
    expect(batch.status).toBe(400);
  });
});
