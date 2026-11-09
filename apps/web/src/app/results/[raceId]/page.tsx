import { publicRaceSummary, readLatestPublicFrozenRaceFinalization } from "@o-tid/application";
import { cachedPublicRadio, cachedPublicRelayResults, cachedPublicResults, cachedStaffResults, PUBLIC_PAGE_INLINE_ROWS, publicPageRows } from "../../../lib/public-race-data";
import { db } from "../../../lib/db";
import { PublicResultLists } from "../../../components/public-result-lists";
import { PublicRaceNavigation } from "../../../components/public-race-navigation";
import { sv } from "../../../i18n/sv";
import { splitAnalysisSv } from "../../../i18n/split-analysis-sv";
import { analysisClassNames } from "../../../lib/split-analysis";
import { resultListFromPublic } from "../../../lib/lists/result-list-model";
import Link from "next/link";
import { raceStaff, requirePublicRace } from "../../../lib/public-race-gate";
import { PreviewBanner } from "../../../components/public-race/preview-banner";
import { liveSv } from "../../../i18n/live-sv";
import { raceHubPath } from "../../../lib/public-race-format";
import { publicPagesEn } from "../../../i18n/public-en";
import { currentLanguage } from "../../../lib/language-server";
import { joinRaceParts, raceDetails, raceTitle } from "@o-tid/domain";

export const dynamic = "force-dynamic";

/** Steg 51: om sträcktidsanalysen finns, en gång per cachad resultatlista (samma objekt för samma tävlingsversion). */
const analysisByResults = new WeakMap<object, boolean>();

export default async function ResultsPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const access = await requirePublicRace(raceId);
  // Steg 51: listorna ur cachen per tävlingsversion, samma som API:et. Steg 52: arrangören och funktionärerna läser
  // resultatlistan utan cache och ser gafflingsbilden även när banorna är hemliga publikt.
  const staff = await raceStaff(raceId);
  const language = await currentLanguage(), en = language === "en";
  const [summary, results, relay, finalization, radio] = await Promise.all([publicRaceSummary(db, raceId),
    (staff ? cachedStaffResults(raceId, { exact: true }) : cachedPublicResults(raceId, { exact: true })).then(entry => entry.value),
    cachedPublicRelayResults(raceId, { exact: true }).then(entry => entry.value),
    readLatestPublicFrozenRaceFinalization(db, raceId), cachedPublicRadio(raceId, { exact: true }).then(entry => entry.value)]);
  // Sträcktidsanalysen (PLAN.md steg 16) finns när någon individuell klass har sträcktider.
  let analysis = analysisByResults.get(results);
  if (analysis === undefined) {
    analysis = analysisClassNames(resultListFromPublic(results, relay)).length > 0;
    analysisByResults.set(results, analysis);
  }
  // Steg 51: en stor lista skickas inte med sidan (flera MB HTML per besök); sidan hämtar den cachade listan direkt.
  const inline = publicPageRows(results, relay) <= PUBLIC_PAGE_INLINE_ROWS;
  return <main className="stack public-list-page">
    <PublicRaceNavigation raceId={raceId} shortCode={summary.shortCode} currentPage="results" language={language} />
    <PreviewBanner access={access} language={language} />
    <section className="public-list-heading"><h1>{summary.eventName}</h1><p>{raceDetails(summary.eventName, summary.name, [summary.raceDate])}</p>
      <p className="public-list-links">
        <Link href={`${raceHubPath(summary.shortCode)}/live`}>{en ? publicPagesEn.live : liveSv.title}</Link>
        {analysis && <Link href={`/results/${raceId}/splits`}>{en ? publicPagesEn.splitAnalysis : splitAnalysisSv.title}</Link>}
        {finalization.status === "ok" && <Link href={`/results/${raceId}/finalizations/${finalization.finalizationId}`}>
          {en ? publicPagesEn.frozenResultsLink : sv.publicFrozenResultsLink}</Link>}
      </p></section>
    <PublicResultLists raceId={raceId} initial={inline ? { results, relay, radio } : undefined} race={joinRaceParts([raceTitle(summary.eventName, summary.name), summary.raceDate])}
      raceDate={summary.raceDate} />
  </main>;
}
