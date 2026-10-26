"use client";

import { useEffect, useRef, useState } from "react";
import { startPublicResultEventStream } from "./public-result-event-stream-client";
import { PublicBusyError } from "./public-stale";

/**
 * Steg 51: när resultatströmmen är öppen väcker den sidan vid varje nytt resultat, och sidan hämtar då av sig själv bara
 * var 10:e sekund, för det som inte väcker strömmen (till exempel "Resultaten är klara"). Utan öppen ström var femte sekund.
 */
export const STREAM_OPEN_INTERVAL_MS = 10_000;

/**
 * Steg 51: gällde svaret en äldre version (servern räknade just om listan, `x-otid-stale`) hämtar sidan igen efter
 * 1,5–2,5 s, när den nya listan är räknad. Annars kunde en besökare som öppnade sidan just efter sista avläsningen (och
 * därför inte väcks av den) stå kvar med listan före avläsningen tills reservhämtningen. Målet är att en ny avläsning
 * syns inom 5 s.
 */
export const STALE_RETRY_MS = { minMs: 1_500, spreadMs: 1_000 };
/** `onStale(ms)`: svaret gällde en äldre version; hämta igen efter `ms` (steg 54, under tryck) eller 1,5–2,5 s. */
export type PublicRead<T> = (raceId: string, onStale: (retryMs?: number) => void) => Promise<T>;

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
export function usePublicRaceData<T>(raceId: string, read: PublicRead<T>, initial?: T, active = true, intervalMs = 5_000) {
  const [data, setData] = useState<T | undefined>(initial);
  const [failed, setFailed] = useState(false);
  const [online, setOnline] = useState(true);
  const running = useRef(false), warned = useRef(false), streamOpen = useRef(false), lastFetch = useRef(0);
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let retry: number | undefined;
    const retryStale = (retryMs?: number) => {
      if (retry !== undefined || stopped) return;
      retry = window.setTimeout(() => { retry = undefined; void refresh(); },
        (retryMs ?? STALE_RETRY_MS.minMs) + Math.random() * STALE_RETRY_MS.spreadMs);
    };
    const refresh = async () => {
      if (running.current || stopped) return;
      running.current = true;
      lastFetch.current = Date.now();
      try {
        const value = await reader.current(raceId, retryStale);
        warned.current = false;
        if (!stopped) { setData(value); setFailed(false); }
      } catch (error) {
        // Steg 54: servern har många besökare (503). Det som visas ligger kvar utan felbesked; nytt försök efter Retry-After.
        if (error instanceof PublicBusyError) { retryStale(error.retryAfterMs); return; }
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
      stopped = true; window.clearInterval(timer); window.clearTimeout(retry); stopStream?.();
      window.removeEventListener("online", network); window.removeEventListener("offline", network);
    };
    // `initial` är bara startvärdet: effekten startas om bara för en annan tävling, paus eller ett annat intervall.
  }, [raceId, active, intervalMs]);
  return { data, failed, online };
}
