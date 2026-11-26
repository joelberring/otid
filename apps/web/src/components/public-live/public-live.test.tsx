import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicLiveResponse } from "@o-tid/contracts";
import { createLiveReader, PublicLive } from "./public-live";

/** PLAN.md steg 30: Live-sidan som besökaren ser den vid första ritningen (innan webbläsarens följval läses). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raceId = id(99);
const runner = (n: number, given: string, club: string | null, className = "H21") =>
  ({ publicResultId: id(n), givenName: given, familyName: "Ek", organisationName: club, className });
const live: PublicLiveResponse = { formatVersion: 1, raceId, generatedAt: "2026-10-20T19:03:12.000Z", timeZone: "Europe/Stockholm",
  newLeaderWindowMs: 300_000,
  finishes: [{ ...runner(2, "Bo", "IFK Lidingö"), finishedAt: "2026-10-20T19:02:00.000Z", status: "MP" },
    { ...runner(1, "Anna", "OK Ek"), finishedAt: "2026-10-20T19:00:00.000Z", status: "OK", elapsedMs: 1_812_000, place: 1 }],
  leaders: [{ ...runner(1, "Anna", "OK Ek"), elapsedMs: 1_812_000, since: "2026-10-20T19:00:00.000Z", newLeader: true },
    { ...runner(3, "Cia", "OK Ek", "D21"), elapsedMs: 2_000_000, since: "2026-10-20T18:00:00.000Z", newLeader: false }],
  radio: { enabled: true, onTheWay: [], latest: [{ ...runner(4, "Dan", "OK Ek"), controlCode: 50, label: "Radio 1",
    passedAt: "2026-10-20T19:01:00.000Z", elapsedMs: 372_000, place: 2, finished: false }] } };

describe("Live-sidan", () => {
  it("visar senast i mål, ledare med Ny ledare, radiopassagen och när den uppdaterades", () => {
    const html = renderToStaticMarkup(<PublicLive raceId={raceId} initial={live} />);
    for (const label of ["Uppdaterad 21:03:12", "Senast i mål", "Ledare per klass", "Vid radiokontrollerna", "passerade Radio 1 6:12, 2:a",
      "30:12", "1:a", "Felstämplad", "Ny ledare", "Följ Anna Ek", "Följ en klubb"]) expect(html).toContain(label);
    // Bara den nya ledaren är märkt, och felstämplad har ingen placering.
    expect(html.match(/Ny ledare/g)).toHaveLength(1);
    expect(html).not.toMatch(/Felstämplad<\/span><span[^>]*>\d+:[ae]</);
    expect(html.indexOf("Bo Ek")).toBeLessThan(html.indexOf("Anna Ek"));
  });

  it("före första målgången: ett lugnt tomläge", () => {
    const html = renderToStaticMarkup(<PublicLive raceId={raceId} initial={{ ...live, finishes: [], leaders: [],
      radio: { enabled: false, latest: [], onTheWay: [] } }} />);
    expect(html).toContain("Inga målgångar än – sidan uppdateras av sig själv.");
    expect(html).not.toContain("Ledare per klass");
    expect(html).not.toContain("Följer");
  });

  describe("klient-304 med svag ETag", () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it("skickar If-None-Match och återanvänder befintligt Live-objekt vid 304", async () => {
      const seen: (string | null)[] = [];
      let count = 0;
      vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("if-none-match"));
        count += 1;
        if (count === 1) return new Response(JSON.stringify(live), { status: 200, headers: { etag: 'W/"live-1"' } });
        return new Response(null, { status: 304, headers: { etag: 'W/"live-1"', "x-otid-stale": "1" } });
      });
      const read = createLiveReader();
      const first = await read(raceId);
      const onStale = vi.fn();
      const second = await read(raceId, onStale);
      expect(seen).toEqual([null, 'W/"live-1"']);
      expect(second).toBe(first);
      expect(onStale).toHaveBeenCalledTimes(1);
    });
  });
});
