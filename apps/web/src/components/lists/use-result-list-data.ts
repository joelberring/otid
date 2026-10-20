"use client";

import { publicRadioResponseSchema, publicRelayResultsSchema, publicResultListResponseSchema, type PublicRadioResponse,
  type PublicRelayResults, type PublicResultListResponse } from "@o-tid/contracts";
import { usePublicRaceData } from "../../lib/use-public-race-data";

/** Resultaten och (ADR-0172 beslut 5) mellantiderna vid radiokontrollerna. */
export type ResultListData = { results: PublicResultListResponse; relay: PublicRelayResults; radio?: PublicRadioResponse | undefined };

async function read(raceId: string): Promise<ResultListData> {
  const id = encodeURIComponent(raceId);
  const [results, relay, radio] = await Promise.all([fetch(`/api/public/races/${id}/results`, { cache: "no-store" }),
    fetch(`/api/public/races/${id}/relay-results`, { cache: "no-store" }), fetch(`/api/public/races/${id}/radio`, { cache: "no-store" })]);
  if (!results.ok || !relay.ok || !radio.ok) throw new Error("Resultaten kunde inte hämtas");
  return { results: publicResultListResponseSchema.parse(await results.json()), relay: publicRelayResultsSchema.parse(await relay.json()),
    radio: publicRadioResponseSchema.parse(await radio.json()) };
}

/**
 * De publicerade resultaten (individuella och stafett) och radiokontrollernas mellantider för listorna, uppdaterade av sig
 * själva (`usePublicRaceData`). Arbetsytan hämtar mer sällan (`intervalMs`), eftersom servern ändå meddelar ändringar direkt.
 */
export function useResultListData(raceId: string, initial?: ResultListData, active = true, intervalMs = 5_000) {
  const { data, failed } = usePublicRaceData(raceId, read, initial, active, intervalMs);
  return { data, failed };
}
