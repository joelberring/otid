import Link from "next/link";
import { ResultApprovalAdmin } from "../../../../components/result-approval-admin";
import { sv } from "../../../../i18n/sv";
export const dynamic = "force-dynamic";
export default async function ResultApprovalAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack result-approval-page"><nav className="nav"><Link href={`/admin/${raceId}`}>{sv.resultApprovalBackToRace}</Link><Link href="/">Tävlingar</Link></nav><section className="result-approval-page-intro"><p className="muted">{sv.resultApprovalRaceLabel}: {raceId}</p><h1>{sv.resultApprovalPageHeading}</h1><p>{sv.resultApprovalPageLead}</p></section><ResultApprovalAdmin raceId={raceId} /></main>;
}
