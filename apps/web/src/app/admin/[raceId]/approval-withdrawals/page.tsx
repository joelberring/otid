import Link from "next/link";
import { ResultApprovalWithdrawalAdmin } from "../../../../components/result-approval-withdrawal-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function ResultApprovalWithdrawalAdminPage({
  params
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <main className="stack result-approval-withdrawal-page">
    <nav className="nav">
      <Link href={`/admin/${raceId}`}>{sv.resultApprovalWithdrawalBackToRace}</Link>
      <Link href="/">Tävlingar</Link>
    </nav>
    <section className="result-approval-withdrawal-page-intro">
      <p className="muted">{sv.resultApprovalWithdrawalRaceLabel}: {raceId}</p>
      <h1>{sv.resultApprovalWithdrawalPageHeading}</h1>
      <p>{sv.resultApprovalWithdrawalPageLead}</p>
    </section>
    <ResultApprovalWithdrawalAdmin raceId={raceId} />
  </main>;
}
