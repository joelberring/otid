import { publicRaceSummary, publicRelayResults, publicResults, readLatestPublicFrozenRaceFinalization, readPublicMapMetadata } from "@o-tid/application";
import { db } from "../../../lib/db";
import { PublicResults } from "../../../components/public-results";
import { PublicRelayResults } from "../../../components/public-relay-results";
import { PublicRaceNavigation } from "../../../components/public-race-navigation";
import { sv } from "../../../i18n/sv";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const [summary, results, relay, map, finalization] = await Promise.all([publicRaceSummary(db, raceId), publicResults(db, raceId),
    publicRelayResults(db, raceId), readPublicMapMetadata(db, raceId), readLatestPublicFrozenRaceFinalization(db, raceId)]);
  // Stafett (ADR-0169 beslut 3): lagresultat först; de individuella resultaten visas när det finns individuella klasser.
  const individual = results.results.length > 0 || relay.classes.length === 0;
  return <main className="stack public-results-page">
    <PublicRaceNavigation raceId={raceId} currentPage="results" />
    <section className="public-results-heading"><h1>{summary.eventName}</h1><p>{summary.name} · {summary.raceDate}</p><div className="public-results-heading-links">{map.status === "ok" && <Link href={`/results/${raceId}/map`}>Visa karta</Link>}{finalization.status === "ok" && <Link href={`/results/${raceId}/finalizations/${finalization.finalizationId}`}>{sv.publicFrozenResultsLink}</Link>}</div></section>
    {relay.classes.length > 0 && <section className="panel"><PublicRelayResults raceId={raceId} initial={relay} /></section>}
    {individual && <section className="panel"><PublicResults raceId={raceId} initial={results} /></section>}
  </main>;
}
