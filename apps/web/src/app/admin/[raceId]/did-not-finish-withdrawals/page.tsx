import Link from "next/link";
import { DidNotFinishWithdrawalAdmin } from "../../../../components/did-not-finish-withdrawal-admin";
import { sv } from "../../../../i18n/sv";
export const dynamic = "force-dynamic";
export default async function DidNotFinishWithdrawalAdminPage({ params }: { params: Promise<{ raceId: string }> }) { const { raceId } = await params; return <main className="stack did-not-finish-withdrawal-page"><nav className="nav"><Link href={`/admin/${raceId}`}>{sv.didNotFinishWithdrawalBackToRace}</Link><Link href="/">Tävlingar</Link></nav><section className="did-not-finish-withdrawal-page-intro"><p className="muted">{sv.didNotFinishWithdrawalRaceLabel}: {raceId}</p><h1>{sv.didNotFinishWithdrawalPageHeading}</h1><p>{sv.didNotFinishWithdrawalPageLead}</p></section><DidNotFinishWithdrawalAdmin raceId={raceId} /></main>; }
