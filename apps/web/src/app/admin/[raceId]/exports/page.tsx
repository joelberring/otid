import Link from "next/link";
import { IofResultListExportAdmin } from "../../../../components/iof-result-list-export-admin";
import { sv } from "../../../../i18n/sv";

export const dynamic = "force-dynamic";
export default async function IofResultListExportPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack"><nav className="nav"><Link href={`/admin/${raceId}`}>{sv.resultListExportBack}</Link></nav>
    <IofResultListExportAdmin raceId={raceId} /></main>;
}
