import { describe, expect, it, vi } from "vitest";
import { createFollowStore, FOLLOW_STORAGE_KEY, NO_FOLLOWS, parseFollows } from "./follow-store";

/** PLAN.md steg 30: följda löpare och klubbar sparas bara i webbläsaren. */
const runner = { raceId: "race-1", publicResultId: "00000000-0000-4000-8000-000000000001", name: "Anna Ek", club: "OK Ek", className: "H21" };

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

describe("följ löpare och klubb", () => {
  it("följer och slutar följa, sparar i webbläsaren och läser tillbaka", () => {
    const storage = memoryStorage();
    const store = createFollowStore(() => storage);
    const changes = vi.fn();
    const stop = store.subscribe(changes);
    store.toggleRunner(runner);
    store.toggleClub("OK Ek");
    expect(store.isRunner("race-1", runner.publicResultId)).toBe(true);
    expect(store.isRunner("race-2", runner.publicResultId)).toBe(false);
    expect(store.isClub("OK Ek")).toBe(true);
    expect(changes).toHaveBeenCalledTimes(2);
    expect(parseFollows(storage.values.get(FOLLOW_STORAGE_KEY)!)).toEqual({ runners: [runner], clubs: ["OK Ek"] });
    // En ny sida (omladdning) läser samma val.
    expect(createFollowStore(() => storage).getSnapshot()).toEqual({ runners: [runner], clubs: ["OK Ek"] });
    store.toggleRunner(runner);
    store.toggleClub("OK Ek");
    expect(store.getSnapshot()).toEqual({ runners: [], clubs: [] });
    stop();
  });

  it("utan fungerande lagring behålls valet i minnet och en varning loggas, inget kastas", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };
    const store = createFollowStore(() => broken);
    expect(store.getSnapshot()).toBe(NO_FOLLOWS);
    store.toggleClub("OK Ek");
    expect(store.getSnapshot().clubs).toEqual(["OK Ek"]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("hoppar över skräp i det sparade värdet och servern ser en tom lista", () => {
    const raw = JSON.stringify({ runners: [runner, { raceId: "x" }, null, { ...runner, publicResultId: "b", club: 7 }], clubs: ["OK Ek", "", 3, "OK Ek"] });
    expect(parseFollows(raw)).toEqual({ runners: [runner, { ...runner, publicResultId: "b", club: null }], clubs: ["OK Ek"] });
    expect(parseFollows(null)).toBe(NO_FOLLOWS);
    expect(createFollowStore(() => memoryStorage({ [FOLLOW_STORAGE_KEY]: raw })).getServerSnapshot()).toBe(NO_FOLLOWS);
  });
});
