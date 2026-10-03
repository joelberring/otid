import Link from "next/link";
import { DidNotStartAdmin } from "../../../../components/did-not-start-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function DidNotStartAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack did-not-start-page">
    <nav className="nav"><Link href={`/admin/${raceId}`}>{sv.didNotStartBackToRace}</Link><Link href="/">Tävlingar</Link></nav>
    <section className="did-not-start-page-intro"><p className="muted">{sv.didNotStartRaceLabel}: {raceId}</p>
      <h1>{sv.didNotStartPageHeading}</h1><p>{sv.didNotStartPageLead}</p></section>
    <DidNotStartAdmin raceId={raceId} />
  </main>;
}
