import { getPublicStartList } from "@o-tid/application";
import { db } from "../../../lib/db";
import { PublicStartList } from "../../../components/public-start-list";
import { PublicRaceNavigation } from "../../../components/public-race-navigation";

export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const published = await getPublicStartList(db, raceId);
  return <main className="stack public-list-page"><PublicRaceNavigation raceId={raceId} currentPage="starts" />
    <PublicStartList key={raceId} raceId={raceId} initial={published.status === "published" ? published.response : null} /></main>;
}
