import Link from "next/link";
import { MapAssetAdmin } from "../../../../components/map-asset-admin";
import { MapGeoreferenceAdmin } from "../../../../components/map-georeference-admin";
import { CourseControlGeometryAdmin } from "../../../../components/course-control-geometry-admin";
import { raceAdministratorSv as administratorText } from "../../../../i18n/race-administrator-sv";
import { mapAssetSv as text } from "../../../../i18n/map-asset-sv";

export const dynamic = "force-dynamic";

export default async function MapAdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack private-map-admin-page"><nav className="nav"><Link href={`/admin/${raceId}/manage`}>{administratorText.title}</Link></nav><h1>{text.title}</h1><MapAssetAdmin raceId={raceId} /><MapGeoreferenceAdmin raceId={raceId} /><CourseControlGeometryAdmin raceId={raceId} /></main>;
}
