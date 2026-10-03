import Link from "next/link";
import { PrivateRoutePreview } from "../../../../components/private-route-preview";
import { privateRoutePreviewSv as text } from "../../../../i18n/private-route-preview-sv";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) { const { raceId } = await params; return <main className="stack"><nav className="nav"><Link href={`/admin/${raceId}/manage`}>{text.administration}</Link></nav><PrivateRoutePreview raceId={raceId} /></main>; }
