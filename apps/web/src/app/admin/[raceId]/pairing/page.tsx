import Link from "next/link";
import { PairingAdmin } from "../../../../components/pairing-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function PairingAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack">
    <nav className="nav"><Link href={`/admin/${raceId}`}>{sv.pairingBackToRace}</Link><Link href="/">Tävlingar</Link></nav>
    <section><p className="muted">{sv.pairingRaceLabel}: {raceId}</p><h1>{sv.pairingPageHeading}</h1>
      <p>{sv.pairingPageLead}</p></section>
    <PairingAdmin raceId={raceId} />
  </main>;
}
