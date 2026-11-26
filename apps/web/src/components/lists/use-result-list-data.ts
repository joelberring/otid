"use client";

import { publicRadioResponseSchema, publicRelayResultsSchema, publicResultListResponseSchema, type PublicRadioResponse,
  type PublicRelayResults, type PublicResultListResponse } from "@o-tid/contracts";
import { useEffect, useRef, useState } from "react";
import { anyStale, staleRetryMs, throwIfBusy } from "../../lib/public-stale";
import { usePublicRaceData } from "../../lib/use-public-race-data";
import { inLanguage } from "../../lib/in-language";

/** Resultaten och (ADR-0172 beslut 5) mellantiderna vid radiokontrollerna. */
export type ResultListData = { results: PublicResultListResponse; relay: PublicRelayResults; radio?: PublicRadioResponse | undefined };

/**
 * Steg 51: stafettresultaten och radiotiderna hämtas varje gång bara när tävlingen har stafett respektive radio påslagen;
 * annars högst var 30:e sekund (en individuell tävling med 300 besökare sparar två tredjedelar av anropen).
 */
const SIDE_LIST_INTERVAL_MS = 30_000;

type CachedFetch<T> = { url: string; etag: string | null; value: T };

function fetchConditional(url: string, cached: { url: string; etag: string | null } | undefined): Promise<Response> {
  const etag = cached && cached.url === url ? cached.etag : null;
  return fetch(url, etag ? { cache: "no-store", headers: { "if-none-match": etag } } : { cache: "no-store" });
}

export function createResultListReader(now: () => number = Date.now, options: { splits?: boolean | (() => boolean) } = {}) {
  let lastResults: CachedFetch<PublicResultListResponse> | undefined;
  let lastRelay: CachedFetch<PublicRelayResults> | undefined;
  let lastRadio: CachedFetch<PublicRadioResponse> | undefined;
  let lastData: ResultListData | undefined;
  let side: { raceId: string; relay: PublicRelayResults; radio: PublicRadioResponse | undefined; at: number } | undefined;

  return async (raceId: string, onStale: (retryMs?: number) => void = () => undefined): Promise<ResultListData> => {
    const id = encodeURIComponent(raceId);
    const wantSplits = typeof options.splits === "function" ? options.splits() : (options.splits ?? true);
    const resultsUrl = `/api/public/races/${id}/results${wantSplits ? "" : "?splits=0"}`;
    const relayUrl = `/api/public/races/${id}/relay-results`;
    const radioUrl = `/api/public/races/${id}/radio`;
    const stale = !side || side.raceId !== raceId || now() - side.at >= SIDE_LIST_INTERVAL_MS;
    const wantRelay = stale || side!.relay.classes.length > 0;
    const wantRadio = stale || side!.radio?.enabled === true;
    const [results, relay, radio] = await Promise.all([
      fetchConditional(resultsUrl, lastResults),
      wantRelay ? fetchConditional(relayUrl, lastRelay) : undefined,
      wantRadio ? fetchConditional(radioUrl, lastRadio) : undefined
    ]);
    throwIfBusy(results, relay, radio);
    const okOr304 = (response: Response | undefined, cached: CachedFetch<unknown> | undefined, url: string) =>
      !response || response.ok || (response.status === 304 && cached !== undefined && cached.url === url);
    if (!okOr304(results, lastResults, resultsUrl) || !okOr304(relay, lastRelay, relayUrl) || !okOr304(radio, lastRadio, radioUrl)) {
      throw new Error(inLanguage("Resultaten kunde inte hämtas", "The results could not be loaded"));
    }
    if (anyStale(results, relay, radio)) onStale(staleRetryMs(results, relay, radio));

    let changed = false;
    let nextResults: PublicResultListResponse;
    if (results.status === 304 && lastResults && lastResults.url === resultsUrl) {
      lastResults = { ...lastResults, etag: results.headers.get("etag") ?? lastResults.etag };
      nextResults = lastResults.value;
    } else {
      nextResults = publicResultListResponseSchema.parse(await results.json());
      lastResults = { url: resultsUrl, etag: results.headers.get("etag"), value: nextResults };
      changed = true;
    }

    let nextRelay: PublicRelayResults;
    if (!relay) {
      nextRelay = side!.relay;
    } else if (relay.status === 304 && lastRelay && lastRelay.url === relayUrl) {
      lastRelay = { ...lastRelay, etag: relay.headers.get("etag") ?? lastRelay.etag };
      nextRelay = lastRelay.value;
    } else {
      nextRelay = publicRelayResultsSchema.parse(await relay.json());
      lastRelay = { url: relayUrl, etag: relay.headers.get("etag"), value: nextRelay };
      changed = true;
    }

    let nextRadio: PublicRadioResponse | undefined;
    if (!radio) {
      nextRadio = side!.radio;
    } else if (radio.status === 304 && lastRadio && lastRadio.url === radioUrl) {
      lastRadio = { ...lastRadio, etag: radio.headers.get("etag") ?? lastRadio.etag };
      nextRadio = lastRadio.value;
    } else {
      nextRadio = publicRadioResponseSchema.parse(await radio.json());
      lastRadio = { url: radioUrl, etag: radio.headers.get("etag"), value: nextRadio };
      changed = true;
    }

    side = { raceId, relay: nextRelay, radio: nextRadio, at: stale ? now() : side!.at };
    if (!changed && lastData) return lastData;
    lastData = { results: nextResults, relay: nextRelay, radio: nextRadio };
    return lastData;
  };
}

/**
 * De publicerade resultaten (individuella och stafett) och radiokontrollernas mellantider för listorna, uppdaterade av sig
 * själva (`usePublicRaceData`). Arbetsytan hämtar mer sällan (`intervalMs`), eftersom servern ändå meddelar ändringar direkt.
 * Med `splits: false` hämtas `/results?splits=0`; när `splits` växlar till `true` hämtas fulla sträcktider direkt.
 */
export function useResultListData(raceId: string, initial?: ResultListData, active = true, intervalMs = 5_000,
  options: { splits?: boolean } = {}) {
  const splits = options.splits ?? true;
  const splitsRef = useRef(splits);
  splitsRef.current = splits;
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const prevSplits = useRef(splits);
  useEffect(() => {
    if (!prevSplits.current && splits) setRefreshTrigger((count) => count + 1);
    prevSplits.current = splits;
  }, [splits]);
  const [read] = useState(() => createResultListReader(Date.now, { splits: () => splitsRef.current }));
  const { data, failed } = usePublicRaceData(raceId, read, initial, active, intervalMs, refreshTrigger);
  return { data, failed };
}
