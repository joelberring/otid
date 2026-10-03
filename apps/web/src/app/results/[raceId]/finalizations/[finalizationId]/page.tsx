import { readPublicFrozenRaceResults } from "@o-tid/application";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicFrozenRaceResults } from "../../../../../components/public-frozen-race-results";
import { sv } from "../../../../../i18n/sv";
import { db } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export default async function PublicFrozenRaceResultsPage({ params }: { params: Promise<{ raceId: string; finalizationId: string }> }) {
  const { raceId, finalizationId } = await params;
  const result = await readPublicFrozenRaceResults(db, raceId, finalizationId);
  if (result.status !== "ok") notFound();
  return <main className="stack">
    <nav className="nav"><Link href={`/results/${raceId}`}>{sv.publicFrozenResultsBack}</Link></nav>
    <section className="panel"><PublicFrozenRaceResults result={result.response} /></section>
  </main>;
}
