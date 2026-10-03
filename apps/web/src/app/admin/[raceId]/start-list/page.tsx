import Link from "next/link";
import { StartListAdmin } from "../../../../components/start-list-admin";
import { startListSv } from "../../../../i18n/start-list-sv";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack"><nav><Link href={`/admin/${raceId}`}>{startListSv.back}</Link></nav>
    <h1>{startListSv.title}</h1><StartListAdmin key={raceId} raceId={raceId} /></main>;
}
