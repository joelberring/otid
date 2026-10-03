import Link from "next/link";
import { notFound } from "next/navigation";
import { publicRaceSummary, publicResultDetail } from "@o-tid/application";
import { PublicParticipantRoute } from "../../../../../../components/public-participant-route";
import { PublicParticipantRouteContext } from "../../../../../../components/public-participant-route-context";
import { publicParticipantRouteSv as text } from "../../../../../../i18n/public-participant-route-sv";
import { db } from "../../../../../../lib/db";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  const [summary, detail] = await Promise.all([publicRaceSummary(db, raceId), publicResultDetail(db, raceId, publicResultId)]);
  if (detail.status === "not-found") notFound();
  const result = detail.response.result;
  return <main className="stack public-participant-route-page"><nav className="nav"><Link href={`/results/${raceId}/participants/${publicResultId}`}>{text.back}</Link></nav><PublicParticipantRouteContext eventName={summary.eventName} raceName={summary.name} raceDate={summary.raceDate} givenName={result.givenName} familyName={result.familyName} className={result.className} /><h2>{text.title}</h2><PublicParticipantRoute raceId={raceId} publicResultId={publicResultId} /></main>;
}
