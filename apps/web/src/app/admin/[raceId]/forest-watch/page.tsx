import Link from "next/link";
import { ForestWatchAdmin } from "../../../../components/forest-watch-admin";
import { forestWatchSv as text } from "../../../../i18n/forest-watch-sv";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack"><nav><Link href={`/admin/${raceId}`}>{text.back}</Link></nav>
    <h1>{text.title}</h1><ForestWatchAdmin key={raceId} raceId={raceId} /></main>;
}
