import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { courseSettingNoteSchema } from "@o-tid/contracts";
import { subscribeCourseSetting } from "./course-setting-events";
import { mapLinkMapRoute, mapLinkServices, mapLinkViewRoute, mapLinkWriteRoute, type MapLinkServices } from "./map-link-route-handlers";

vi.mock("server-only", () => ({}));

/**
 * ADR-0214: routes med kartritarens länk. Läsningen cachas aldrig delat och kartfilen har ETag; skrivningen kräver samma
 * ursprung och huvudet, och en lyckad skrivning når öppna editorer i banläggningens ström.
 */
const origin = "http://127.0.0.1:3100";
const environment = { NODE_ENV: "test", O_TID_PUBLIC_ORIGIN: origin } as const;
const db = {} as Database;
const token = "C".repeat(43);
const noteId = "10000000-0000-4000-8000-000000000001";
const raceId = "20000000-0000-4000-8000-000000000002";
const view = { formatVersion: 1, raceName: null, map: null, mapErrors: [] };

function services(overrides: Partial<MapLinkServices>): MapLinkServices {
  return { ...mapLinkServices, ...overrides } as MapLinkServices;
}
const write = (headers: Record<string, string>) => new Request(`${origin}/api/map-link/${token}/notes/${noteId}/replies`, { method: "POST",
  body: JSON.stringify({ formatVersion: 1 }), headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.restoreAllMocks());

describe("kartritarens länk i routes (ADR-0214)", () => {
  it("läser kartfelen privat och utan cache; spärren ger 429 och okänd länk 404", async () => {
    const ok = await mapLinkViewRoute(db, new Request(`${origin}/api/public/map-link/${token}`, { headers: { "x-forwarded-for": "198.51.100.4" } }),
      token, services({ view: async (_db, input) => { expect(input).toMatchObject({ token, clientKey: "198.51.100.4" }); return { status: "ok", raceId, response: view as never }; } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(await ok.json()).toEqual(view);
    const limited = await mapLinkViewRoute(db, new Request(`${origin}/x`), token, services({ view: async () => ({ status: "rate-limited" }) }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("600");
    const invalid = await mapLinkViewRoute(db, new Request(`${origin}/x`), token, services({ view: async () => ({ status: "invalid" }) }));
    expect([invalid.status, await invalid.json()]).toEqual([404, { formatVersion: 1, error: "LINK_INVALID" }]);
  });

  it("lämnar ut kartfilen utan filnamn, med ETag och 304 när webbläsaren redan har den", async () => {
    const sha256 = "a".repeat(64);
    const file = await mapLinkMapRoute(db, new Request(`${origin}/x`), token, services({ mapFile: async () => ({ status: "ok", sha256, format: "OCD",
      file: Buffer.from([1, 2, 3]) }) }));
    expect(file.status).toBe(200);
    expect(file.headers.get("etag")).toBe(`"${sha256}"`);
    expect(file.headers.get("cache-control")).toBe("private, no-cache");
    expect(file.headers.get("content-disposition")).toBe("attachment; filename=\"karta.ocd\"");
    let asked: string | undefined;
    const cached = await mapLinkMapRoute(db, new Request(`${origin}/x`, { headers: { "if-none-match": `"${sha256}"` } }), token,
      services({ mapFile: async (_db, input) => { asked = input.ifNoneMatch; return { status: "not-modified", sha256 }; } }));
    expect([cached.status, asked]).toEqual([304, sha256]);
  });

  it("skriver bara från samma ursprung med kartritarens huvud och säger till öppna editorer", async () => {
    let calls = 0;
    const reply = services({ reply: async () => { calls += 1; return { status: "ok", raceId }; } });
    for (const headers of [{}, { origin }, { "x-otid-map-link": "1" }, { origin: "https://annan.example", "x-otid-map-link": "1" },
      { origin, "x-otid-map-link": "1", "sec-fetch-site": "cross-site" }]) {
      expect((await mapLinkWriteRoute(db, write(headers), token, noteId, "reply", environment, reply)).status, JSON.stringify(headers)).toBe(403);
    }
    expect(calls).toBe(0);
    const events: unknown[] = [];
    const stop = subscribeCourseSetting(raceId, { accountId: noteId, displayName: null, level: "EDIT" }, event => events.push(event))!;
    const response = await mapLinkWriteRoute(db, write({ origin, "x-otid-map-link": "1" }), token, noteId, "reply", environment, reply);
    stop();
    expect([response.status, calls]).toEqual([204, 1]);
    expect(events).toContainEqual({ type: "notes", by: "map-link" });
    const conflict = await mapLinkWriteRoute(db, write({ origin, "x-otid-map-link": "1" }), token, noteId, "verdict", environment,
      services({ verdict: async () => ({ status: "conflict" }) }));
    expect(conflict.status).toBe(409);
  });
});

describe("svaren i notisens tråd (ADR-0214)", () => {
  const base = { id: noteId, target: { kind: "POINT", at: { x: 1, y: 1 } }, kind: "MAP_ERROR", at: { x: 1, y: 1 }, course: null, text: "Sten",
    status: "OPEN", createdAt: "2026-11-05T10:00:00.000Z", createdBy: { accountId: noteId, displayName: "Bea" }, resolvedAt: null, resolvedBy: null,
    photo: null };
  const reply = (fields: Record<string, unknown>) => courseSettingNoteSchema.safeParse({ ...base, replies: [{ id: raceId, text: "Hej",
    createdAt: "2026-11-05T10:00:00.000Z", ...fields }] }).success;

  it("har ett konto eller kartritarens länk, och tom text bara i ett besked", () => {
    expect(reply({ createdBy: { accountId: noteId, displayName: "Bea" } })).toBe(true);
    expect(reply({ createdBy: null, mapMaker: { name: null } })).toBe(true);
    expect(reply({ createdBy: null, mapMaker: { name: "Kim" }, verdict: "FIXED", text: "" })).toBe(true);
    expect(reply({ createdBy: null })).toBe(false);
    expect(reply({ createdBy: { accountId: noteId, displayName: "Bea" }, mapMaker: { name: null } })).toBe(false);
    expect(reply({ createdBy: null, mapMaker: { name: null }, text: "" })).toBe(false);
    expect(reply({ createdBy: { accountId: noteId, displayName: "Bea" }, editedAt: "2026-11-05T11:00:00.000Z" })).toBe(true);
  });
});
