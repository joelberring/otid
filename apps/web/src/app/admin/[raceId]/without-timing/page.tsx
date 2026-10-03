import Link from "next/link";
import { WithoutTimingAdmin } from "../../../../components/without-timing-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function WithoutTimingAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack without-timing-page"><nav className="nav"><Link href={`/admin/${raceId}`}>{sv.withoutTimingBackToRace}</Link><Link href="/">Tävlingar</Link></nav><section className="without-timing-page-intro"><p className="muted">{sv.withoutTimingRaceLabel}: {raceId}</p><h1>{sv.withoutTimingPageHeading}</h1><p>{sv.withoutTimingPageLead}</p></section><WithoutTimingAdmin raceId={raceId} /></main>;
}
