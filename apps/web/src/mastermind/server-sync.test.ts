import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, newGame, scoreGuess } from "@o-tid/domain/mastermind";
import type { SavedState } from "./saved-state";
import { pullMastermind, pushMastermind, pushStation, stationKey, withServer } from "./server-sync";

const RACE = "6f1c2f7e-1d1a-4c3b-9d2e-0a1b2c3d4e5f";
const GAME = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const at = new Date("2026-11-19T10:00:00.000Z");
const game = { ...newGame(7, DEFAULT_SETTINGS, at, { id: () => GAME }), secret: [0, 1, 2, 3] };
const local: SavedState = { settings: DEFAULT_SETTINGS, games: [game], names: {}, version: 4, acked: 1 };

function respond(status: number, body?: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => { calls.push({ url, ...(init ? { init } : {}) });
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }) as typeof fetch;
  return { calls, fetcher };
}

describe("pushMastermind", () => {
  it("sends the whole state with the CSRF header and reads the server's merged state", async () => {
    const server = { formatVersion: 1, raceId: RACE, settings: DEFAULT_SETTINGS, games: [game], names: { "7": { name: "Rävarna", at: at.toISOString() } },
      openStations: true, canOpen: false };
    const { calls, fetcher } = respond(200, server);
    const outcome = await pushMastermind(RACE, local, { fetch: fetcher, csrf: () => "token" });
    expect(outcome).toMatchObject({ kind: "ok", state: { names: server.names }, info: { mode: "staff", openStations: true, canOpen: false } });
    expect(calls[0]!.url).toBe(`/api/admin/races/${RACE}/administrator/mastermind`);
    expect(calls[0]!.init).toMatchObject({ method: "POST", headers: { "x-otid-csrf": "token" } });
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({ formatVersion: 1, games: [{ id: GAME }] });
  });

  it("is not logged in without the CSRF cookie or on 401/403, and offline when fetch fails", async () => {
    expect(await pushMastermind(RACE, local, { fetch: respond(200).fetcher, csrf: () => undefined })).toEqual({ kind: "unauthorized" });
    expect(await pullMastermind(RACE, { fetch: respond(403).fetcher })).toEqual({ kind: "unauthorized" });
    expect(await pullMastermind(RACE, { fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch })).toEqual({ kind: "offline" });
    expect(await pullMastermind(RACE, { fetch: respond(500).fetcher })).toEqual({ kind: "failed", status: 500 });
  });
});

describe("withServer", () => {
  it("keeps what happened here during the request and moves acked to the version that was sent", () => {
    const guess = { colors: [1, 0, 2, 3], score: scoreGuess([0, 1, 2, 3], [1, 0, 2, 3]), at: "2026-11-19T10:01:00.000Z" };
    const meanwhile: SavedState = { ...local, games: [{ ...game, guesses: [guess] }], version: 5 };
    const next = withServer(meanwhile, { settings: DEFAULT_SETTINGS, games: [game], names: {} }, 4);
    expect(next.games[0]!.guesses).toEqual([guess]);
    expect(next).toMatchObject({ version: 5, acked: 4 });
    expect(withServer(local, { settings: DEFAULT_SETTINGS, games: [], names: {} })).toMatchObject({ version: 4, acked: 1 });
  });
});

describe("spela på egen dator", () => {
  const response = { formatVersion: 1, raceId: RACE, eventName: "Vinterträning", raceName: "Vinterträning", shortCode: "abc234",
    settings: { ...DEFAULT_SETTINGS, positions: 3 }, games: [], names: {} };

  it("sends the computer's key and games to the public endpoint and takes the training's settings", async () => {
    const { calls, fetcher } = respond(200, response);
    const outcome = await pushStation(RACE, "k".repeat(43), local, { fetch: fetcher });
    expect(calls[0]!.url).toBe(`/api/public/races/${RACE}/mastermind`);
    expect(calls[0]!.init?.headers).not.toHaveProperty("x-otid-csrf");
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({ stationKey: "k".repeat(43), games: [{ id: GAME }] });
    expect(outcome).toMatchObject({ kind: "ok", info: { mode: "station", shortCode: "abc234" } });
    if (outcome.kind !== "ok") return;
    const local3 = { ...local, settings: DEFAULT_SETTINGS, settingsAt: "2026-11-19T11:00:00.000Z" };
    expect(withServer(local3, outcome.state, 4, "station").settings.positions).toBe(3);
  });

  it("is closed when the organiser has not opened it, and keeps one key per training", async () => {
    expect(await pushStation(RACE, "k".repeat(43), local, { fetch: respond(403, { formatVersion: 1, error: "CLOSED" }).fetcher }))
      .toEqual({ kind: "closed" });
    const stored = new Map<string, string>();
    const storage = { getItem: (name: string) => stored.get(name) ?? null, setItem: (name: string, value: string) => void stored.set(name, value) };
    const key = stationKey(RACE, storage);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stationKey(RACE, storage)).toBe(key);
    expect(stationKey("other", storage)).not.toBe(key);
  });
});
