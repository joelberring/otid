import Link from "next/link";
import { DidNotStartWithdrawalAdmin } from "../../../../components/did-not-start-withdrawal-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function DidNotStartWithdrawalAdminPage({
  params
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <main className="stack did-not-start-withdrawal-page">
    <nav className="nav">
      <Link href={`/admin/${raceId}`}>{sv.didNotStartWithdrawalBackToRace}</Link>
      <Link href="/">Tävlingar</Link>
    </nav>
    <section className="did-not-start-withdrawal-page-intro">
      <p className="muted">{sv.didNotStartWithdrawalRaceLabel}: {raceId}</p>
      <h1>{sv.didNotStartWithdrawalPageHeading}</h1>
      <p>{sv.didNotStartWithdrawalPageLead}</p>
    </section>
    <DidNotStartWithdrawalAdmin raceId={raceId} />
  </main>;
}
