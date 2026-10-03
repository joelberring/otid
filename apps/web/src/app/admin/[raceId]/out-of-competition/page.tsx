import Link from "next/link";
import { OutOfCompetitionAdmin } from "../../../../components/out-of-competition-admin";
import { sv } from "../../../../i18n/sv";
export const dynamic = "force-dynamic";
export default async function OutOfCompetitionAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack out-of-competition-page"><nav className="nav"><Link href={`/admin/${raceId}`}>{sv.outOfCompetitionBackToRace}</Link><Link href="/">Tävlingar</Link></nav><section className="out-of-competition-page-intro"><p className="muted">{sv.outOfCompetitionRaceLabel}: {raceId}</p><h1>{sv.outOfCompetitionPageHeading}</h1><p>{sv.outOfCompetitionPageLead}</p></section><OutOfCompetitionAdmin raceId={raceId} /></main>;
}
