import Link from "next/link";
import { ResultDisqualificationWithdrawalAdmin } from "../../../../components/result-disqualification-withdrawal-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function ResultDisqualificationWithdrawalAdminPage({
  params
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <main className="stack result-disqualification-withdrawal-page">
    <nav className="nav">
      <Link href={`/admin/${raceId}`}>{sv.resultDisqualificationWithdrawalBackToRace}</Link>
      <Link href="/">Tävlingar</Link>
    </nav>
    <section className="result-disqualification-withdrawal-page-intro">
      <p className="muted">{sv.resultDisqualificationWithdrawalRaceLabel}: {raceId}</p>
      <h1>{sv.resultDisqualificationWithdrawalPageHeading}</h1>
      <p>{sv.resultDisqualificationWithdrawalPageLead}</p>
    </section>
    <ResultDisqualificationWithdrawalAdmin raceId={raceId} />
  </main>;
}
