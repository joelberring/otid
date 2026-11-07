import type { Metadata } from "next";
import { MapProjectPage } from "../../../../components/map-project/map-project-page";
import { mapProjectSv } from "../../../../i18n/map-project-sv";
import { sv } from "../../../../i18n/sv";

export const metadata: Metadata = { title: `${mapProjectSv.title} – ${sv.appName}`, robots: { index: false, follow: false } };

/** ADR-0219: kartprojektets sida (steg K0; ritningen kommer i K1). Behörigheten avgörs av API:et. */
export default async function MapProjectRoute({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <MapProjectPage projectId={projectId} />;
}
