import type { Metadata } from "next";
import { MyMapProjects } from "../../../components/map-project/my-map-projects";
import { mapProjectEn } from "../../../i18n/map-project-en";
import { mapProjectSv } from "../../../i18n/map-project-sv";
import { sv } from "../../../i18n/sv";
import { currentLanguage } from "../../../lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? mapProjectEn : mapProjectSv;
  return { title: `${text.list.title} – ${sv.appName}`, robots: { index: false, follow: false } };
}

/** ADR-0219: kontots kartprojekt. Behörigheten avgörs av API:et. */
export default function MapProjectsPage() {
  return <MyMapProjects />;
}
