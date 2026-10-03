import Link from "next/link";
import { EntryClassAdmin } from "../../../../components/entry-class-admin";
import { sv } from "../../../../i18n/sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function EntryClassAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`stack ${styles.page}`}>
    <nav className="nav"><Link href={`/admin/${raceId}`}>{sv.entryClassBackToRace}</Link><Link href="/">Tävlingar</Link></nav>
    <section><p className="muted">{sv.entryClassRaceLabel}: {raceId}</p><h1>{sv.entryClassPageHeading}</h1>
      <p>{sv.entryClassPageLead}</p></section>
    <EntryClassAdmin raceId={raceId} />
  </main>;
}
