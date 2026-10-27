import { loadPlacementSubjects, placementFrom, type PlacementResultRow } from "@o-tid/application";
import type { DeviceBatchAcknowledgement, PublicRelayResults, PublicResultListResponse } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import type { CachedPublic } from "./public-race-cache";

/**
 * Steg 57: placeringen på avläsningens kvitto. Räknas ur den senast räknade resultatlistan för tävlingen (cachen per
 * tävlingsversion, ADR-0177) med de resultat som avläsningarna sparat sedan listan började räknas inlagda. Alla avläsningar
 * går till tävlingens instans (`web`), så den känner alla nya avläsningsresultat. Listan räknas om i bakgrunden i samma
 * takt som för speakern och arbetsytan; kvittot väntar inte på det (bara när ingen lista finns, eller något annat än nya
 * resultat har ändrats, högst `WAIT_MS`). Går placeringen inte att räkna får kvittot ingen placering – aldrig en gammal.
 */
const WAIT_MS = 750;
/** Högst så många nya resultat per tävling i minnet (fler än en tävling har); sedan kan äldre listor inte användas. */
const MAX_RECENT = 20_000;

type Recent = { rows: Map<string, PlacementResultRow & { at: number }>; incompleteBefore: number };
const globalRecent = globalThis as typeof globalThis & { oTidReadoutPlacementRecent?: Map<string, Recent> };
const recentByRace = globalRecent.oTidReadoutPlacementRecent ??= new Map<string, Recent>();

/** Individuella resultat och stafettsträckor hålls för sig: de läggs in i var sin lista (resultatlistan, stafettlistan). */
function recentOf(raceId: string, relay: boolean): Recent {
  const id = `${raceId}:${relay ? "relay" : "results"}`;
  let recent = recentByRace.get(id);
  if (!recent) {
    recent = { rows: new Map(), incompleteBefore: Number.NEGATIVE_INFINITY };
    recentByRace.set(id, recent);
    while (recentByRace.size > 200) recentByRace.delete(recentByRace.keys().next().value!);
  }
  return recent;
}

/** Ett nytt avläsningsresultat (senast sparad gäller). */
export function rememberPlacementResult(raceId: string, row: PlacementResultRow, at: number): void {
  const recent = recentOf(raceId, row.relay);
  recent.rows.delete(row.publicResultId);
  recent.rows.set(row.publicResultId, { ...row, at });
  while (recent.rows.size > MAX_RECENT) {
    const [key, oldest] = recent.rows.entries().next().value!;
    recent.rows.delete(key);
    recent.incompleteBefore = Math.max(recent.incompleteBefore, oldest.at + 1);
  }
}

/**
 * Resultaten som kan saknas i en lista som började räknas `startedAt`, eller undefined när de inte längre är kända.
 * Raderna som en lista redan har tas bort när den nyaste listan räknats (`forget`).
 */
function recentSince(raceId: string, relay: boolean, startedAt: number): PlacementResultRow[] | undefined {
  const recent = recentOf(raceId, relay);
  if (startedAt < recent.incompleteBefore) return undefined;
  return [...recent.rows.values()].filter((row) => row.at >= startedAt);
}

/** Rader som finns i en lista som började `startedAt` behövs inte längre (en senare lista har dem också). */
function forgetBefore(raceId: string, relay: boolean, startedAt: number): void {
  const recent = recentOf(raceId, relay);
  for (const [key, row] of recent.rows) {
    if (row.at >= startedAt) break;
    recent.rows.delete(key);
  }
}

export type PlacementLists = {
  readonly results: (raceId: string, waitMs: number) => Promise<CachedPublic<PublicResultListResponse> | undefined>;
  readonly relay: (raceId: string, waitMs: number) => Promise<CachedPublic<PublicRelayResults> | undefined>;
};

/** Kvittot med placering för varje godkänd avläsning. Ett fel här loggas och ger kvittot utan placering. */
export async function withPlacements(db: Database, raceId: string, acknowledgement: DeviceBatchAcknowledgement, lists: PlacementLists,
  options: { readonly now?: () => number; readonly loadSubjects?: typeof loadPlacementSubjects } = {}): Promise<DeviceBatchAcknowledgement> {
  const now = options.now ?? Date.now;
  const loadSubjects = options.loadSubjects ?? loadPlacementSubjects;
  const revisionOf = (ack: DeviceBatchAcknowledgement["acknowledgements"][number]) =>
    ack.status !== "rejected" && ack.serverResult && "resultRevisionId" in ack.serverResult ? ack.serverResult.resultRevisionId : undefined;
  const ids = acknowledgement.acknowledgements.flatMap((ack) => { const id = revisionOf(ack); return id ? [id] : []; });
  if (ids.length === 0) return acknowledgement;
  try {
    const subjects = await loadSubjects(db, raceId, ids);
    const at = now();
    // De nya resultaten (inte dubbletter, som redan fanns) läggs in i senare listor tills en lista räknats med dem.
    for (const ack of acknowledgement.acknowledgements) {
      const subject = ack.status === "stored" ? subjects.get(revisionOf(ack) ?? "") : undefined;
      if (subject) rememberPlacementResult(raceId, subject, at);
    }
    const wanted = [...subjects.values()].filter((subject) => subject.status === "OK");
    if (wanted.length === 0) return acknowledgement;
    const [results, relay] = await Promise.all([wanted.some((row) => !row.relay) ? lists.results(raceId, WAIT_MS) : undefined,
      wanted.some((row) => row.relay) ? lists.relay(raceId, WAIT_MS) : undefined]);
    const since = (list: CachedPublic<unknown> | undefined, isRelay: boolean) => {
      if (!list) return undefined;
      const rows = recentSince(raceId, isRelay, list.startedAt);
      forgetBefore(raceId, isRelay, list.startedAt);
      return rows;
    };
    const [resultsRecent, relayRecent] = [since(results, false), since(relay, true)];
    return { ...acknowledgement, acknowledgements: acknowledgement.acknowledgements.map((ack) => {
      const subject = subjects.get(revisionOf(ack) ?? "");
      if (!subject || subject.status !== "OK" || ack.status === "rejected") return ack;
      const recent = subject.relay ? relayRecent : resultsRecent;
      const list = subject.relay ? relay : results;
      if (!list || !recent) return ack;
      const placement = placementFrom({ subject, recent, ...(subject.relay ? { relay: relay!.value } : { results: results!.value }) });
      return placement ? { ...ack, placement } : ack;
    }) };
  } catch (error) {
    console.error("Placeringen till avläsningens kvitto kunde inte räknas", error);
    return acknowledgement;
  }
}

/** Bara för tester. */
export function clearPlacementResults(): void {
  recentByRace.clear();
}
