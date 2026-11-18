"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parseRaceMode, raceModeStorageKey, type RaceMode, type RaceNavContext } from "../../lib/race-tabs";
import type { SectionId } from "../../lib/race-sections";

/**
 * Tävlingsraden (ADR-0227 tillägg 2026-11-18): det som delas mellan arrangemangets layout (raden, överraden) och arbetsytan
 * (som visar delen och har osparat att skydda). Läget är det automatiska tills man väljer själv; valet gäller arrangemanget i
 * den här fliken (sessionStorage) och ligger inte på servern.
 */
export interface RaceWorkspaceHandle {
  /** Byter del i arbetsytan med samma regel som sidopanelen (osparat stoppar). */
  navigate: (section: SectionId) => void;
  /** False när något inte är sparat; då stannar man kvar och får beskedet. */
  mayLeave: () => boolean;
  refresh: () => void;
}

interface RaceNavValue {
  context: RaceNavContext;
  mode: RaceMode;
  setMode: (mode: RaceMode) => void;
  /** Delen som arbetsytan visar (undefined utanför arbetsytan). */
  section: SectionId | undefined;
  setSection: (section: SectionId | undefined) => void;
  workspace: React.RefObject<RaceWorkspaceHandle | undefined>;
}

const RaceNav = createContext<RaceNavValue | null>(null);

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}
/** Utan sessionStorage (privat läge, avstängd lagring) gäller det automatiska läget; valet håller då bara på sidan. */
function readMode(raceId: string): RaceMode | null {
  try { return parseRaceMode(window.sessionStorage.getItem(raceModeStorageKey(raceId))) ?? null; }
  catch { return null; }
}

export function RaceNavProvider({ context, autoMode, children }: { context: RaceNavContext; autoMode: RaceMode; children: React.ReactNode }) {
  const stored = useSyncExternalStore(subscribe, () => readMode(context.raceId), () => null);
  const [unsaved, setUnsaved] = useState<RaceMode>();
  const [section, setSection] = useState<SectionId>();
  const workspace = useRef<RaceWorkspaceHandle | undefined>(undefined);
  const setMode = useCallback((mode: RaceMode) => {
    try { window.sessionStorage.setItem(raceModeStorageKey(context.raceId), mode); }
    catch { setUnsaved(mode); }
    for (const listener of listeners) listener();
  }, [context.raceId]);
  const mode = stored ?? unsaved ?? autoMode;
  const value = useMemo(() => ({ context, mode, setMode, section, setSection, workspace }), [context, mode, setMode, section]);
  return <RaceNav.Provider value={value}>{children}</RaceNav.Provider>;
}

/** Raden och läget, eller null utanför ett arrangemang (eller utan roll i det). */
export function useRaceNav(): RaceNavValue | null {
  return useContext(RaceNav);
}

/** Arbetsytan anmäler delen som visas och hur raden byter del, så att raden inte går förbi osparat. */
export function useRaceWorkspace(section: SectionId, handle: RaceWorkspaceHandle) {
  const nav = useRaceNav();
  const setSection = nav?.setSection, ref = nav?.workspace;
  useEffect(() => { if (ref) ref.current = handle; });
  useEffect(() => { setSection?.(section); }, [section, setSection]);
  useEffect(() => () => { setSection?.(undefined); if (ref) ref.current = undefined; }, [setSection, ref]);
}
