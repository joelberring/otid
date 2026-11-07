import type { Metadata } from "next";
import { MyMapProjects } from "../../../components/map-project/my-map-projects";
import { mapProjectSv } from "../../../i18n/map-project-sv";
import { sv } from "../../../i18n/sv";

export const metadata: Metadata = { title: `${mapProjectSv.list.title} – ${sv.appName}`, robots: { index: false, follow: false } };

/** ADR-0219: kontots kartprojekt. Behörigheten avgörs av API:et. */
export default function MapProjectsPage() {
  return <MyMapProjects />;
}
