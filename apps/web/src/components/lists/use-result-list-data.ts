"use client";

import { publicRadioResponseSchema, publicRelayResultsSchema, publicResultListResponseSchema, type PublicRadioResponse,
  type PublicRelayResults, type PublicResultListResponse } from "@o-tid/contracts";
import { useState } from "react";
import { anyStale, staleRetryMs, throwIfBusy } from "../../lib/public-stale";
import { usePublicRaceData } from "../../lib/use-public-race-data";

/** Resultaten och (ADR-0172 beslut 5) mellantiderna vid radiokontrollerna. */
export type ResultListData = { results: PublicResultListResponse; relay: PublicRelayResults; radio?: PublicRadioResponse | undefined };

/**
 * Steg 51: stafettresultaten och radiotiderna hämtas varje gång bara när tävlingen har stafett respektive radio påslagen;
 * annars högst var 30:e sekund (en individuell tävling med 300 besökare sparar två tredjedelar av anropen).
 */
const SIDE_LIST_INTERVAL_MS = 30_000;

export function createResultListReader(now: () => number = Date.now) {
  let side: { relay: PublicRelayResults; radio: PublicRadioResponse | undefined; at: number } | undefined;
  return async (raceId: string, onStale: (retryMs?: number) => void = () => undefined): Promise<ResultListData> => {
    const id = encodeURIComponent(raceId);
    const stale = !side || now() - side.at >= SIDE_LIST_INTERVAL_MS;
    const wantRelay = stale || side!.relay.classes.length > 0;
    const wantRadio = stale || side!.radio?.enabled === true;
    const [results, relay, radio] = await Promise.all([fetch(`/api/public/races/${id}/results`, { cache: "no-store" }),
      wantRelay ? fetch(`/api/public/races/${id}/relay-results`, { cache: "no-store" }) : undefined,
      wantRadio ? fetch(`/api/public/races/${id}/radio`, { cache: "no-store" }) : undefined]);
    throwIfBusy(results, relay, radio);
    if (!results.ok || (relay && !relay.ok) || (radio && !radio.ok)) throw new Error("Resultaten kunde inte hämtas");
    if (anyStale(results, relay, radio)) onStale(staleRetryMs(results, relay, radio));
    const next = { relay: relay ? publicRelayResultsSchema.parse(await relay.json()) : side!.relay,
      radio: radio ? publicRadioResponseSchema.parse(await radio.json()) : side!.radio };
    side = { ...next, at: stale ? now() : side!.at };
    return { results: publicResultListResponseSchema.parse(await results.json()), ...next };
  };
}

/**
 * De publicerade resultaten (individuella och stafett) och radiokontrollernas mellantider för listorna, uppdaterade av sig
 * själva (`usePublicRaceData`). Arbetsytan hämtar mer sällan (`intervalMs`), eftersom servern ändå meddelar ändringar direkt.
 */
export function useResultListData(raceId: string, initial?: ResultListData, active = true, intervalMs = 5_000) {
  const [read] = useState(() => createResultListReader());
  const { data, failed } = usePublicRaceData(raceId, read, initial, active, intervalMs);
  return { data, failed };
}
