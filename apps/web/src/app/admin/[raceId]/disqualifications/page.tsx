import Link from "next/link";
import { ResultDisqualificationAdmin } from "../../../../components/result-disqualification-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";

export default async function ResultDisqualificationAdminPage({
  params
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <main className="stack result-disqualification-page">
    <nav className="nav">
      <Link href={`/admin/${raceId}`}>{sv.resultDisqualificationBackToRace}</Link>
      <Link href="/">Tävlingar</Link>
    </nav>
    <section className="result-disqualification-page-intro">
      <p className="muted">{sv.resultDisqualificationRaceLabel}: {raceId}</p>
      <h1>{sv.resultDisqualificationPageHeading}</h1>
      <p>{sv.resultDisqualificationPageLead}</p>
    </section>
    <ResultDisqualificationAdmin raceId={raceId} />
  </main>;
}
