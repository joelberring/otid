import Link from "next/link";
import { notFound } from "next/navigation";
import { publicRaceSummary, publicResultDetail } from "@o-tid/application";
import { PublicResultDetail } from "../../../../../components/public-result-detail";
import { db } from "../../../../../lib/db";
import { sv } from "../../../../../i18n/sv";
import { requirePublicRace } from "../../../../../lib/public-race-gate";
import { PreviewBanner } from "../../../../../components/public-race/preview-banner";

export const dynamic = "force-dynamic";

export default async function PublicResultDetailPage({ params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  const access = await requirePublicRace(raceId);
  const [summary, detail] = await Promise.all([publicRaceSummary(db, raceId), publicResultDetail(db, raceId, publicResultId)]);
  if (detail.status === "not-found") notFound();
  return <main className="stack public-result-detail-page">
    <nav className="nav"><Link href={`/results/${raceId}`}>{sv.publicResultBack}</Link></nav>
    <PreviewBanner access={access} />
    <section className="public-result-detail-heading"><h1>{summary.eventName}</h1><p>{summary.name} · {summary.raceDate}</p></section>
    <section className="panel public-result-detail-surface"><PublicResultDetail raceId={raceId} publicResultId={publicResultId} initial={detail.response} /></section>
  </main>;
}
