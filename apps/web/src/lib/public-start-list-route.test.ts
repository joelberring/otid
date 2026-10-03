import { expect, it } from "vitest";
import type { Database } from "@o-tid/database";
import type { getPublicStartList } from "@o-tid/application";
import { publicStartListRoute } from "./public-start-list-route";

it("lämnar bara validerad fryst publik data utan cookies/cache och inget innehåll vid withdrawal/fel", async () => {
  const db = {} as Database;
  const response = { formatVersion: 1 as const, revision: 1, iofExportAvailable: true, publishedAt: "2026-09-04T10:00:00Z",
    content: { eventName: "Träning", raceName: "Medel", raceDate: "2026-09-04", timeZone: "Europe/Stockholm",
      classes: [{ name: "Öppen", startRule: "PUNCH" as const, entries: [{ displayName: "Ada", organisationName: null, fixedStartTime: null }] }] } };
  const published = await publicStartListRoute(db, "race", async () => ({ status: "published", response }));
  expect(published.status).toBe(200); expect(await published.json()).toEqual(response);
  expect(published.headers.get("cache-control")).toContain("no-store");
  expect(published.headers.getSetCookie()).toEqual([]);
  const missing = await publicStartListRoute(db, "race", async () => ({ status: "not-found" }));
  expect(missing.status).toBe(404); expect(await missing.text()).toBe("");
  expect(missing.headers.get("cache-control")).toContain("no-store");
  const unsafe = async () => ({ status: "published", response: { ...response, actorCredentialId: "private" } });
  const failure = await publicStartListRoute(db, "race", unsafe as unknown as typeof getPublicStartList);
  expect(failure.status).toBe(503); expect(await failure.text()).toBe("");
});
