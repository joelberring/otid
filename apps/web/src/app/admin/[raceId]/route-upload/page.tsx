import Link from "next/link";
import { RouteUploadGrantAdmin } from "../../../../components/route-upload-grant-admin";

export const dynamic = "force-dynamic";

export default async function RouteUploadGrantPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack"><nav className="nav"><Link href={`/admin/${raceId}/manage`}>Tävlingsadministration</Link></nav>
    <h1>Privata ruttlänkar</h1><RouteUploadGrantAdmin raceId={raceId} />
  </main>;
}
