import { publicRaceSummary, publicRelayResults, publicResults, readLatestPublicFrozenRaceFinalization } from "@o-tid/application";
import { db } from "../../../lib/db";
import { PublicResultLists } from "../../../components/public-result-lists";
import { PublicRaceNavigation } from "../../../components/public-race-navigation";
import { sv } from "../../../i18n/sv";
import { splitAnalysisSv } from "../../../i18n/split-analysis-sv";
import { analysisClassNames } from "../../../lib/split-analysis";
import { resultListFromPublic } from "../../../lib/lists/result-list-model";
import Link from "next/link";
import { requirePublicRace } from "../../../lib/public-race-gate";
import { PreviewBanner } from "../../../components/public-race/preview-banner";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const access = await requirePublicRace(raceId);
  const [summary, results, relay, finalization] = await Promise.all([publicRaceSummary(db, raceId), publicResults(db, raceId),
    publicRelayResults(db, raceId), readLatestPublicFrozenRaceFinalization(db, raceId)]);
  // Sträcktidsanalysen (PLAN.md steg 16) finns när någon individuell klass har sträcktider.
  const analysis = analysisClassNames(resultListFromPublic(results, relay)).length > 0;
  return <main className="stack public-list-page">
    <PublicRaceNavigation raceId={raceId} shortCode={summary.shortCode} currentPage="results" />
    <PreviewBanner access={access} />
    <section className="public-list-heading"><h1>{summary.eventName}</h1><p>{summary.name} · {summary.raceDate}</p>
      {(analysis || finalization.status === "ok") && <p className="public-list-links">
        {analysis && <Link href={`/results/${raceId}/splits`}>{splitAnalysisSv.title}</Link>}
        {finalization.status === "ok" && <Link href={`/results/${raceId}/finalizations/${finalization.finalizationId}`}>{sv.publicFrozenResultsLink}</Link>}
      </p>}</section>
    <PublicResultLists raceId={raceId} initial={{ results, relay }} race={`${summary.eventName} · ${summary.name} · ${summary.raceDate}`}
      raceDate={summary.raceDate} />
  </main>;
}
