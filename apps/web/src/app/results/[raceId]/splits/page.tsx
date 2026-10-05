import Link from "next/link";
import { publicRaceSummary, publicRelayResults, publicResults, readPublicRouteIndex } from "@o-tid/application";
import { db } from "../../../../lib/db";
import { SplitAnalysis } from "../../../../components/split-analysis/split-analysis";
import { splitAnalysisSv as text } from "../../../../i18n/split-analysis-sv";
import { requirePublicRace } from "../../../../lib/public-race-gate";
import { PreviewBanner } from "../../../../components/public-race/preview-banner";

export const dynamic = "force-dynamic";

/** Publik sträcktidsanalys per klass (PLAN.md steg 16), med länkar till vägval när karta och rutter finns. */
export default async function SplitAnalysisPage({ params, searchParams }: {
  params: Promise<{ raceId: string }>; searchParams: Promise<{ class?: string | string[] }>;
}) {
  const [{ raceId }, query] = await Promise.all([params, searchParams]);
  const access = await requirePublicRace(raceId);
  const [summary, results, relay, routes] = await Promise.all([publicRaceSummary(db, raceId), publicResults(db, raceId),
    publicRelayResults(db, raceId), readPublicRouteIndex(db, raceId)]);
  const className = typeof query.class === "string" ? query.class : null;
  return <main className="stack public-list-page">
    <nav className="nav" aria-label={text.title}><Link href={`/results/${raceId}`}>{text.back}</Link></nav>
    <PreviewBanner access={access} />
    <section className="public-list-heading"><h1>{text.title}</h1><p>{summary.eventName} · {summary.name} · {summary.raceDate}</p></section>
    <SplitAnalysis raceId={raceId} initial={{ results, relay }} routeLegs={routes.legs} initialClass={className} />
  </main>;
}
