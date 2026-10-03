import Link from "next/link";
import { ResultRecalculationAdmin } from "../../../../components/result-recalculation-admin";
import { sv } from "../../../../i18n/sv";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function ResultRecalculationAdminPage({
  params
}: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className={`stack ${styles.page}`}>
    <nav className="nav"><Link href={`/admin/${raceId}`}>{sv.resultRecalculationBackToRace}</Link><Link href="/">{sv.resultRecalculationBackToEvents}</Link></nav>
    <section><p className="muted">{sv.resultRecalculationRaceLabel}: {raceId}</p>
      <h1>{sv.resultRecalculationPageHeading}</h1><p>{sv.resultRecalculationPageLead}</p></section>
    <ResultRecalculationAdmin raceId={raceId} />
  </main>;
}
