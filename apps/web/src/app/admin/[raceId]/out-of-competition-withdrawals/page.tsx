import Link from "next/link";
import { OutOfCompetitionWithdrawalAdmin } from "../../../../components/out-of-competition-withdrawal-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function OutOfCompetitionWithdrawalAdminPage({
  params
}: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack out-of-competition-withdrawal-page">
    <nav className="nav">
      <Link href={`/admin/${raceId}`}>{sv.outOfCompetitionWithdrawalBackToRace}</Link>
      <Link href="/">Tävlingar</Link>
    </nav>
    <section className="out-of-competition-withdrawal-page-intro">
      <p className="muted">{sv.outOfCompetitionWithdrawalRaceLabel}: {raceId}</p>
      <h1>{sv.outOfCompetitionWithdrawalPageHeading}</h1>
      <p>{sv.outOfCompetitionWithdrawalPageLead}</p>
    </section>
    <OutOfCompetitionWithdrawalAdmin raceId={raceId} />
  </main>;
}
