import Link from "next/link";
import { DidNotFinishAdmin } from "../../../../components/did-not-finish-admin";
import { sv } from "../../../../i18n/sv";
export const dynamic = "force-dynamic";
export default async function DidNotFinishAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack did-not-finish-page"><nav className="nav"><Link href={`/admin/${raceId}`}>{sv.didNotFinishBackToRace}</Link><Link href="/">Tävlingar</Link></nav><section className="did-not-finish-page-intro"><p className="muted">{sv.didNotFinishRaceLabel}: {raceId}</p><h1>{sv.didNotFinishPageHeading}</h1><p>{sv.didNotFinishPageLead}</p></section><DidNotFinishAdmin raceId={raceId} /></main>;
}
