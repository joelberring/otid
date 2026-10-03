import Link from "next/link";
import { notFound } from "next/navigation";
import { publicRaceSummary, readPublicMapMetadata } from "@o-tid/application";
import { PublicMapViewer } from "../../../../components/public-map-viewer";
import { publicMapSv as text } from "../../../../i18n/public-map-sv";
import { db } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export default async function PublicMapPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const [summary, map] = await Promise.all([publicRaceSummary(db, raceId), readPublicMapMetadata(db, raceId)]);
  if (map.status === "not-found") notFound();
  return <main className="stack public-map-page"><nav className="nav"><Link href={`/results/${raceId}`}>{text.back}</Link></nav><section className="public-map-context"><p>{summary.eventName} · {summary.name}</p><h1>{text.pageTitle}</h1><p>{map.metadata.title}</p></section><PublicMapViewer raceId={raceId} title={map.metadata.title} /></main>;
}
