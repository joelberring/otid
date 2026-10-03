import Link from "next/link";
import { EntryCardAdmin } from "../../../../components/entry-card-admin";
import { cardSv } from "../../../../i18n/entry-card-sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`stack ${styles.page}`}><nav><Link href={`/admin/${raceId}`}>{cardSv.back}</Link></nav>
    <h1>{cardSv.title}</h1><EntryCardAdmin raceId={raceId} /></main>;
}
