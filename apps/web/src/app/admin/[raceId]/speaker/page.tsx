import Link from "next/link";
import { notFound } from "next/navigation";
import { SpeakerBoardAdmin } from "../../../../components/speaker-board-admin";
import { speakerBoardSv as text } from "../../../../i18n/speaker-board-sv";
import styles from "../../../../components/speaker-board.module.css";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raceId)) notFound();
  return <main className={`${styles.page} stack`}><nav><Link href={`/admin/${raceId}`}>{text.back}</Link></nav>
    <h1>{text.title}</h1><SpeakerBoardAdmin key={raceId} raceId={raceId} /></main>;
}
