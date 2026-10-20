"use client";

import { useEffect, useRef, useState } from "react";
import { startPublicResultEventStream } from "./public-result-event-stream-client";

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
  const running = useRef(false), warned = useRef(false);
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = async () => {
      if (running.current || stopped) return;
      running.current = true;
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
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, intervalMs);
    const stopStream = typeof window.EventSource === "function"
      ? startPublicResultEventStream(raceId, window.EventSource, () => { void refresh(); }) : undefined;
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
