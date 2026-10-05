import { publicRaceSummary, publicRelayResults, publicResults, readLatestPublicFrozenRaceFinalization, readPublicMapMetadata } from "@o-tid/application";
import { db } from "../../../lib/db";
import { PublicResultLists } from "../../../components/public-result-lists";
import { PublicRaceNavigation } from "../../../components/public-race-navigation";
import { sv } from "../../../i18n/sv";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const [summary, results, relay, map, finalization] = await Promise.all([publicRaceSummary(db, raceId), publicResults(db, raceId),
    publicRelayResults(db, raceId), readPublicMapMetadata(db, raceId), readLatestPublicFrozenRaceFinalization(db, raceId)]);
  return <main className="stack public-list-page">
    <PublicRaceNavigation raceId={raceId} currentPage="results" />
    <section className="public-list-heading"><h1>{summary.eventName}</h1><p>{summary.name} · {summary.raceDate}</p>
      {(map.status === "ok" || finalization.status === "ok") && <p className="public-list-links">
        {map.status === "ok" && <Link href={`/results/${raceId}/map`}>Visa karta</Link>}
        {finalization.status === "ok" && <Link href={`/results/${raceId}/finalizations/${finalization.finalizationId}`}>{sv.publicFrozenResultsLink}</Link>}
      </p>}</section>
    <PublicResultLists raceId={raceId} initial={{ results, relay }} race={`${summary.eventName} · ${summary.name} · ${summary.raceDate}`}
      raceDate={summary.raceDate} />
  </main>;
}
