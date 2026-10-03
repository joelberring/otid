import { PublicStartList } from "../../../components/public-start-list";
import { PublicRaceNavigation } from "../../../components/public-race-navigation";
import { startListPublicationSv as text } from "../../../i18n/start-list-publication-sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`stack ${styles.page}`}><PublicRaceNavigation raceId={raceId} currentPage="starts" />
    <h1>{text.publicTitle}</h1><PublicStartList key={raceId} raceId={raceId} /></main>;
}
