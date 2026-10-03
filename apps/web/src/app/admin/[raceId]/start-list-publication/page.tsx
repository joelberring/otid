import Link from "next/link";
import { StartListPublicationAdmin } from "../../../../components/start-list-publication-admin";
import { startListPublicationSv as text } from "../../../../i18n/start-list-publication-sv";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack start-list-publication-page"><nav><Link href={`/admin/${raceId}`}>{text.back}</Link></nav>
    <h1>{text.title}</h1><StartListPublicationAdmin key={raceId} raceId={raceId} /></main>;
}
