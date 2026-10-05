"use client";

import { useEffect, useRef, useState } from "react";
import { publicRelayResultsSchema, publicResultListResponseSchema, type PublicRelayResults,
  type PublicResultListResponse } from "@o-tid/contracts";
import { startPublicResultEventStream } from "../../lib/public-result-event-stream-client";

export type ResultListData = { results: PublicResultListResponse; relay: PublicRelayResults };

async function read(raceId: string): Promise<ResultListData> {
  const id = encodeURIComponent(raceId);
  const [results, relay] = await Promise.all([fetch(`/api/public/races/${id}/results`, { cache: "no-store" }),
    fetch(`/api/public/races/${id}/relay-results`, { cache: "no-store" })]);
  if (!results.ok || !relay.ok) throw new Error("Resultaten kunde inte hämtas");
  return { results: publicResultListResponseSchema.parse(await results.json()), relay: publicRelayResultsSchema.parse(await relay.json()) };
}

/**
 * De publicerade resultaten (individuella och stafett) för listorna. Hämtas var femte sekund och direkt när
 * servern säger att något ändrats. Ett misslyckat försök visas (`failed`); senast hämtade data ligger kvar.
 * `active` false pausar hämtningen (arbetsytan när Resultat inte visas). Arbetsytan hämtar mer sällan
 * (`intervalMs`), eftersom servern ändå meddelar ändringar direkt.
 */
export function useResultListData(raceId: string, initial?: ResultListData, active = true, intervalMs = 5_000) {
  const [data, setData] = useState<ResultListData | undefined>(initial);
  const [failed, setFailed] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = async () => {
      if (running.current || stopped) return;
      running.current = true;
      try {
        const value = await read(raceId);
        if (!stopped) { setData(value); setFailed(false); }
      } catch {
        // Visas som besked ovanför listan; nästa försök sker om fem sekunder.
        if (!stopped) setFailed(true);
      } finally { running.current = false; }
    };
    if (!initial) void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, intervalMs);
    const stopStream = typeof window.EventSource === "function"
      ? startPublicResultEventStream(raceId, window.EventSource, () => { void refresh(); }) : undefined;
    return () => { stopped = true; window.clearInterval(timer); stopStream?.(); };
  }, [raceId, active, intervalMs]);
  return { data, failed };
}
