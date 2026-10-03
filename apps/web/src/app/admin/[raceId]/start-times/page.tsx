import Link from "next/link";
import { EntryStartTimeAdmin } from "../../../../components/entry-start-time-admin";
import { startTimeSv } from "../../../../i18n/entry-start-time-sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`stack ${styles.page}`}><nav><Link href={`/admin/${raceId}`}>{startTimeSv.back}</Link></nav>
    <h1>{startTimeSv.title}</h1><EntryStartTimeAdmin raceId={raceId} /></main>;
}
