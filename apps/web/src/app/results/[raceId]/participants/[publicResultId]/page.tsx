import Link from "next/link";
import { notFound } from "next/navigation";
import { publicRaceSummary, publicResultDetail, readPublicMapMetadata, readPublicParticipantRoute } from "@o-tid/application";
import { PublicResultDetail } from "../../../../../components/public-result-detail";
import { PublicResultRouteSummary } from "../../../../../components/public-result-route-summary";
import { db } from "../../../../../lib/db";
import { sv } from "../../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function PublicResultDetailPage({ params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  const [summary, detail, map, route] = await Promise.all([publicRaceSummary(db, raceId), publicResultDetail(db, raceId, publicResultId), readPublicMapMetadata(db, raceId), readPublicParticipantRoute(db, raceId, publicResultId)]);
  if (detail.status === "not-found") notFound();
  return <main className="stack public-result-detail-page">
    <nav className="nav"><Link href={`/results/${raceId}`}>{sv.publicResultBack}</Link></nav>
    <section className="public-result-detail-heading"><h1>{summary.eventName}</h1><p>{summary.name} · {summary.raceDate}</p>{map.status === "ok" && <Link href={`/results/${raceId}/map`}>Visa karta</Link>}</section>
    <section className="panel public-result-detail-surface"><PublicResultDetail raceId={raceId} publicResultId={publicResultId} initial={detail.response} /></section>
    {route.status === "ok" && <PublicResultRouteSummary route={route.response} href={`/results/${raceId}/participants/${publicResultId}/route`} />}
  </main>;
}
