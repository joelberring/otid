"use client";

import { useEffect, useRef, useState } from "react";
import { startPublicResultEventStream } from "./public-result-event-stream-client";

/**
 * Steg 51: när resultatströmmen är öppen väcker den sidan vid varje nytt resultat, och sidan hämtar då av sig själv bara
 * var 15:e sekund, för det som inte väcker strömmen (till exempel "Resultaten är klara"). Utan öppen ström var femte sekund.
 */
export const STREAM_OPEN_INTERVAL_MS = 15_000;

/** Ska sidans egen timer hämta nu? Med öppen ström bara när förra hämtningen är äldre än reservintervallet. */
export function timerShouldFetch(streamOpen: boolean, lastFetchAt: number, now: number, intervalMs: number): boolean {
  return !streamOpen || now - lastFetchAt >= Math.max(intervalMs, STREAM_OPEN_INTERVAL_MS) - 500;
}

/**
 * Publikt innehåll som uppdateras av sig självt (resultatlistan, Live): hämtas var femte sekund när sidan syns och
 * direkt när resultatströmmen säger att något ändrats. Ett misslyckat försök visas (`failed`) och senast hämtade data
 * ligger kvar; nästa försök sker vid nästa intervall eller väckning. `online` följer webbläsarens nätstatus.
 * `active` false pausar hämtningen (arbetsytan när Resultat inte visas).
 */
export function usePublicRaceData<T>(raceId: string, read: (raceId: string) => Promise<T>, initial?: T, active = true, intervalMs = 5_000) {
  const [data, setData] = useState<T | undefined>(initial);
  const [failed, setFailed] = useState(false);
  const [online, setOnline] = useState(true);
  const running = useRef(false), warned = useRef(false), streamOpen = useRef(false), lastFetch = useRef(0);
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = async () => {
      if (running.current || stopped) return;
      running.current = true;
      lastFetch.current = Date.now();
      try {
        const value = await reader.current(raceId);
        warned.current = false;
        if (!stopped) { setData(value); setFailed(false); }
      } catch (error) {
        // Visas som besked på sidan; senast hämtade data ligger kvar och nästa försök sker av sig självt.
        // Loggas en gång per avbrott, inte var femte sekund.
        if (!warned.current) console.warn("Publika uppgifter kunde inte hämtas", error);
        warned.current = true;
        if (!stopped) setFailed(true);
      } finally { running.current = false; }
    };
    if (initial === undefined) void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (!timerShouldFetch(streamOpen.current, lastFetch.current, Date.now(), intervalMs)) return;
      void refresh();
    }, intervalMs);
    const stopStream = typeof window.EventSource === "function"
      ? startPublicResultEventStream(raceId, window.EventSource, () => { void refresh(); }, undefined, (open) => { streamOpen.current = open; })
      : undefined;
    const network = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void refresh();
    };
    setOnline(navigator.onLine);
    window.addEventListener("online", network); window.addEventListener("offline", network);
    return () => {
      stopped = true; window.clearInterval(timer); stopStream?.();
      window.removeEventListener("online", network); window.removeEventListener("offline", network);
    };
    // `initial` är bara startvärdet: effekten startas om bara för en annan tävling, paus eller ett annat intervall.
  }, [raceId, active, intervalMs]);
  return { data, failed, online };
}
