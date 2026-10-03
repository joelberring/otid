import { publicRaceSummary, publicResults, readLatestPublicFrozenRaceFinalization, readPublicMapMetadata } from "@o-tid/application";
import { db } from "../../../lib/db";
import { PublicResults } from "../../../components/public-results";
import { PublicRaceNavigation } from "../../../components/public-race-navigation";
import { sv } from "../../../i18n/sv";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const [summary, results, map, finalization] = await Promise.all([publicRaceSummary(db, raceId), publicResults(db, raceId), readPublicMapMetadata(db, raceId), readLatestPublicFrozenRaceFinalization(db, raceId)]);
  return <main className="stack public-results-page">
    <PublicRaceNavigation raceId={raceId} currentPage="results" />
    <section className="public-results-heading"><h1>{summary.eventName}</h1><p>{summary.name} · {summary.raceDate}</p><div className="public-results-heading-links">{map.status === "ok" && <Link href={`/results/${raceId}/map`}>Visa karta</Link>}{finalization.status === "ok" && <Link href={`/results/${raceId}/finalizations/${finalization.finalizationId}`}>{sv.publicFrozenResultsLink}</Link>}</div></section>
    <section className="panel"><PublicResults raceId={raceId} initial={results} /></section>
  </main>;
}
