import Link from "next/link";
import { WithoutTimingWithdrawalAdmin } from "../../../../components/without-timing-withdrawal-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function WithoutTimingWithdrawalAdminPage({
  params
}: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack without-timing-withdrawal-page">
    <nav className="nav">
      <Link href={`/admin/${raceId}`}>{sv.withoutTimingWithdrawalBackToRace}</Link>
      <Link href="/">Tävlingar</Link>
    </nav>
    <section className="without-timing-withdrawal-page-intro">
      <p className="muted">{sv.withoutTimingWithdrawalRaceLabel}: {raceId}</p>
      <h1>{sv.withoutTimingWithdrawalPageHeading}</h1>
      <p>{sv.withoutTimingWithdrawalPageLead}</p>
    </section>
    <WithoutTimingWithdrawalAdmin raceId={raceId} />
  </main>;
}
