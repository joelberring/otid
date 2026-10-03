import Link from "next/link";
import { ImportAdmin } from "../../../../components/import-admin";
import { EventorEntryImportAdmin } from "../../../../components/eventor-entry-import-admin";
import { sv } from "../../../../i18n/sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function ImportAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`${styles.page} stack`}>
    <nav className="nav"><Link href={`/admin/${raceId}`}>{sv.importBackToRace}</Link><Link href="/">Tävlingar</Link></nav>
    <section><p className="muted">{sv.importRaceLabel}: {raceId}</p><h1>{sv.importPageHeading}</h1>
      <p>{sv.importPageLead}</p></section>
    <ImportAdmin raceId={raceId} />
    <EventorEntryImportAdmin raceId={raceId} />
  </main>;
}
