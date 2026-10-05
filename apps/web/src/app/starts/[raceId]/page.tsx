import { getPublicStartList, publicRaceSummary } from "@o-tid/application";
import { db } from "../../../lib/db";
import { PublicStartList } from "../../../components/public-start-list";
import { PublicRaceNavigation } from "../../../components/public-race-navigation";
import { requirePublicRace } from "../../../lib/public-race-gate";
import { PreviewBanner } from "../../../components/public-race/preview-banner";

export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const access = await requirePublicRace(raceId);
  const [summary, published] = await Promise.all([publicRaceSummary(db, raceId), getPublicStartList(db, raceId)]);
  return <main className="stack public-list-page"><PublicRaceNavigation raceId={raceId} shortCode={summary.shortCode} currentPage="starts" />
    <PreviewBanner access={access} />
    <PublicStartList key={raceId} raceId={raceId} initial={published.status === "published" ? published.response : null} /></main>;
}
