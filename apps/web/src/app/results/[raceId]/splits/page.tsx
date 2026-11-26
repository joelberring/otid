import Link from "next/link";
import { publicRaceSummary } from "@o-tid/application";
import { PUBLIC_PAGE_INLINE_ROWS, publicPageRows } from "../../../../lib/public-race-cache";
import { cachedPublicRadio, cachedPublicRelayResults, cachedPublicResults, cachedPublicRouteIndex } from "../../../../lib/public-race-data";
import { db } from "../../../../lib/db";
import { SplitAnalysis } from "../../../../components/split-analysis/split-analysis";
import { splitAnalysisSv } from "../../../../i18n/split-analysis-sv";
import { splitAnalysisEn } from "../../../../i18n/public-en";
import { currentLanguage } from "../../../../lib/language-server";
import { requirePublicRace } from "../../../../lib/public-race-gate";
import { PreviewBanner } from "../../../../components/public-race/preview-banner";
import { joinRaceParts, raceTitle } from "@o-tid/domain";

export const dynamic = "force-dynamic";

/** Publik sträcktidsanalys per klass (PLAN.md steg 16), med länkar till vägval när karta och rutter finns. */
export default async function SplitAnalysisPage({ params, searchParams }: {
  params: Promise<{ raceId: string }>; searchParams: Promise<{ class?: string | string[] }>;
}) {
  const [{ raceId }, query] = await Promise.all([params, searchParams]);
  const access = await requirePublicRace(raceId);
  const [summary, results, relay, routes, radio] = await Promise.all([publicRaceSummary(db, raceId),
    cachedPublicResults(raceId, { exact: true }).then(entry => entry.value),
    cachedPublicRelayResults(raceId, { exact: true }).then(entry => entry.value),
    cachedPublicRouteIndex(raceId, { exact: true }).then(entry => entry.value),
    cachedPublicRadio(raceId, { exact: true }).then(entry => entry.value)]);
  const className = typeof query.class === "string" ? query.class : null;
  const language = await currentLanguage();
  const text = language === "en" ? splitAnalysisEn : splitAnalysisSv;
  // Samma SSR-gräns som /results/[raceId]: en stor tävling (> 400 rader) hämtas via det cachade API:et i stället för 7 MB HTML.
  const inline = publicPageRows(results, relay) <= PUBLIC_PAGE_INLINE_ROWS;
  return <main className="stack public-list-page">
    <nav className="nav" aria-label={text.title}><Link href={`/results/${raceId}`}>{text.back}</Link></nav>
    <PreviewBanner access={access} language={language} />
    <section className="public-list-heading"><h1>{text.title}</h1><p>{joinRaceParts([raceTitle(summary.eventName, summary.name), summary.raceDate])}</p></section>
    <SplitAnalysis raceId={raceId} initial={inline ? { results, relay, radio } : undefined} routeLegs={routes.legs} initialClass={className} />
  </main>;
}
