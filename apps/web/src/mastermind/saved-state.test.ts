import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, newGame } from "@o-tid/domain/mastermind";
import { EMPTY_SAVED, parseSavedState, upsertGame } from "./saved-state";

const at = new Date("2026-11-11T20:00:00Z");

describe("parseSavedState", () => {
  it("survives broken storage", () => {
    expect(parseSavedState("{not json")).toEqual(EMPTY_SAVED);
    const game = newGame(5, DEFAULT_SETTINGS, at, { id: () => "a" });
    const saved = parseSavedState(JSON.stringify({ settings: { codes: [1] }, games: [game, { cardNumber: "x" }, game], version: 3, acked: 2 }));
    expect(saved).toMatchObject({ settings: DEFAULT_SETTINGS, games: [game], version: 3, acked: 2 });
  });

  it("reads the first version: games get ids, names get a time older than anything else, and everything is sent", () => {
    const old: Record<string, unknown> = { ...newGame(5, DEFAULT_SETTINGS, at, { id: () => "unused" }) };
    delete old.id;
    const saved = parseSavedState(JSON.stringify({ settings: DEFAULT_SETTINGS, games: [old], results: [{ cardNumber: 5 }], names: { "5": "Rävarna", x: "?" } }),
      () => "new-id");
    expect(saved.games.map((game) => game.id)).toEqual(["new-id"]);
    expect(saved.names).toEqual({ "5": { name: "Rävarna", at: "1970-01-01T00:00:00.000Z" } });
    expect(saved.version).toBeGreaterThan(saved.acked);
  });
});

describe("upsertGame", () => {
  it("replaces a game with the same id and appends a new one", () => {
    const a = newGame(1, DEFAULT_SETTINGS, at, { id: () => "a" });
    const b = newGame(2, DEFAULT_SETTINGS, at, { id: () => "b" });
    const moved = { ...a, guesses: [] };
    expect(upsertGame([a], b)).toEqual([a, b]);
    expect(upsertGame([a, b], moved)).toEqual([moved, b]);
  });
});
