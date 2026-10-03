import Link from "next/link";
import { ImportAdmin } from "../../../../components/import-admin";
import { sv } from "../../../../i18n/sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function ImportAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`${styles.page} stack`}>
    <nav className="nav"><Link href={`/admin/${raceId}/manage`}>{sv.importBackToRace}</Link><Link href="/organizer">Mina tävlingar</Link></nav>
    <section><h1>{sv.importPageHeading}</h1>
      <p>{sv.importPageLead}</p></section>
    <ImportAdmin raceId={raceId} />
  </main>;
}
