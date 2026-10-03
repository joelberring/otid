import Link from "next/link";
import { ReadoutResultHistoryAdmin } from "../../../../components/readout-result-history-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";
export default async function ReadoutHistoryPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack readout-history-page"><nav className="nav"><Link href={`/admin/${raceId}`}>{sv.readoutHistoryBack}</Link></nav>
    <ReadoutResultHistoryAdmin raceId={raceId} /></main>;
}
