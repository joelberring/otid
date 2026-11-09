import Link from "next/link";
import { notFound } from "next/navigation";
import { publicRaceSummary } from "@o-tid/application";
import { cachedPublicResultDetail } from "../../../../../lib/public-race-data";
import { PublicResultDetail } from "../../../../../components/public-result-detail";
import { db } from "../../../../../lib/db";
import { sv } from "../../../../../i18n/sv";
import { raceStaff, requirePublicRace } from "../../../../../lib/public-race-gate";
import { PreviewBanner } from "../../../../../components/public-race/preview-banner";
import { raceDetails } from "@o-tid/domain";
import { currentLanguage } from "../../../../../lib/language-server";
import { publicResultEn } from "../../../../../i18n/public-en";

export const dynamic = "force-dynamic";

export default async function PublicResultDetailPage({ params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  const access = await requirePublicRace(raceId);
  const staff = await raceStaff(raceId);
  const [summary, detail] = await Promise.all([publicRaceSummary(db, raceId),
    cachedPublicResultDetail(raceId, publicResultId, { exact: true, staff })]);
  if (detail.status === "not-found") notFound();
  const language = await currentLanguage();
  return <main className="stack public-result-detail-page">
    <nav className="nav"><Link href={`/results/${raceId}`}>{language === "en" ? publicResultEn.back : sv.publicResultBack}</Link></nav>
    <PreviewBanner access={access} language={language} />
    <section className="public-result-detail-heading"><h1>{summary.eventName}</h1><p>{raceDetails(summary.eventName, summary.name, [summary.raceDate])}</p></section>
    <section className="panel public-result-detail-surface"><PublicResultDetail raceId={raceId} publicResultId={publicResultId} initial={detail.response} /></section>
  </main>;
}
