import Link from "next/link";
import { ResultFinalizationAdmin } from "../../../../components/result-finalization-admin";
import { sv } from "../../../../i18n/sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function ResultFinalizationAdminPage({
  params
}: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`stack ${styles.page}`}>
    <nav className="nav" aria-label={sv.resultFinalizationNavigation}>
      <Link href={`/admin/${raceId}`}>{sv.resultFinalizationBackToRace}</Link>
      <Link href="/">{sv.resultFinalizationBackToEvents}</Link>
    </nav>
    <section className={styles.intro}>
      <p className="muted">{sv.resultFinalizationRaceLabel}: {raceId}</p>
      <h1>{sv.resultFinalizationPageHeading}</h1>
      <p>{sv.resultFinalizationPageLead}</p>
    </section>
    <ResultFinalizationAdmin raceId={raceId} />
  </main>;
}
