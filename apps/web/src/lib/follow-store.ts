"use client";

import { useSyncExternalStore } from "react";

/**
 * Följ löpare eller klubb (PLAN.md steg 30). Valet finns bara i besökarens webbläsare (localStorage), inget konto och
 * inget skickas till servern. Löparen följs med sitt publika resultat-id i en viss tävling; klubben med namnet, i alla
 * tävlingar. Går webbläsarens lagring inte att använda (privat läge, full, avstängd) gäller valet bara tills sidan
 * stängs: listan i minnet behålls och en varning loggas, inget besked visas för besökaren.
 */
export type FollowedRunner = { raceId: string; publicResultId: string; name: string; club: string | null; className: string };
export type Follows = { readonly runners: readonly FollowedRunner[]; readonly clubs: readonly string[] };

export const FOLLOW_STORAGE_KEY = "otid.follow.v1";
const MAX_RUNNERS = 200, MAX_CLUBS = 50;
export const NO_FOLLOWS: Follows = Object.freeze({ runners: Object.freeze([]), clubs: Object.freeze([]) });

type FollowStorage = Pick<Storage, "getItem" | "setItem">;

const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;

/** Läser det sparade värdet; allt som inte ser rätt ut hoppas över. */
export function parseFollows(raw: string | null): Follows {
  if (!raw) return NO_FOLLOWS;
  const value = JSON.parse(raw) as { runners?: unknown; clubs?: unknown } | null;
  const runners = (Array.isArray(value?.runners) ? value.runners : []).flatMap((row: unknown): FollowedRunner[] => {
    const runner = row as Partial<Record<keyof FollowedRunner, unknown>> | null;
    if (!runner || !text(runner.raceId, 64) || !text(runner.publicResultId, 64) || !text(runner.name, 330) || !text(runner.className, 160)) return [];
    const club = runner.club === null || runner.club === undefined ? null : text(runner.club, 240) ? runner.club : null;
    return [{ raceId: runner.raceId, publicResultId: runner.publicResultId, name: runner.name, club, className: runner.className }];
  }).slice(0, MAX_RUNNERS);
  const clubs = (Array.isArray(value?.clubs) ? value.clubs : []).filter((club: unknown): club is string => text(club, 240)).slice(0, MAX_CLUBS);
  return { runners, clubs: [...new Set(clubs)] };
}

export type FollowStore = ReturnType<typeof createFollowStore>;

export function createFollowStore(storage: () => FollowStorage | undefined) {
  let current: Follows | undefined;
  const listeners = new Set<() => void>();
  const load = (): Follows => {
    try {
      return parseFollows(storage()?.getItem(FOLLOW_STORAGE_KEY) ?? null);
    } catch (error) {
      console.warn("Följda löpare och klubbar kunde inte läsas från webbläsaren; listan börjar tom", error);
      return NO_FOLLOWS;
    }
  };
  const set = (next: Follows) => {
    current = next;
    try {
      storage()?.setItem(FOLLOW_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn("Följda löpare och klubbar kunde inte sparas i webbläsaren; valet gäller tills sidan stängs", error);
    }
    for (const listener of listeners) listener();
  };
  const snapshot = () => (current ??= load());
  return {
    getSnapshot: snapshot,
    getServerSnapshot: () => NO_FOLLOWS,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      // En annan flik ändrade valet: läs om.
      const onStorage = (event: StorageEvent) => {
        if (event.key !== FOLLOW_STORAGE_KEY) return;
        current = load();
        listener();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => { listeners.delete(listener); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
    },
    isRunner: (raceId: string, publicResultId: string) => snapshot().runners.some(row => row.raceId === raceId && row.publicResultId === publicResultId),
    isClub: (club: string) => snapshot().clubs.includes(club),
    toggleRunner(runner: FollowedRunner) {
      const state = snapshot();
      const followed = state.runners.some(row => row.raceId === runner.raceId && row.publicResultId === runner.publicResultId);
      set({ ...state, runners: followed
        ? state.runners.filter(row => !(row.raceId === runner.raceId && row.publicResultId === runner.publicResultId))
        : [runner, ...state.runners].slice(0, MAX_RUNNERS) });
    },
    toggleClub(club: string) {
      const state = snapshot();
      set({ ...state, clubs: state.clubs.includes(club) ? state.clubs.filter(row => row !== club) : [club, ...state.clubs].slice(0, MAX_CLUBS) });
    }
  };
}

function browserStorage(): FollowStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

/** En gemensam lista för sidan: stjärnorna i Live och i resultatlistan visar samma val. */
export const followStore = createFollowStore(browserStorage);

/** Följda löpare och klubbar. Tom på servern och vid första ritningen, sedan webbläsarens val. */
export function useFollows(store: FollowStore = followStore): Follows {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
