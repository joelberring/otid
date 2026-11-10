import type { Metadata } from "next";
import { MapProjectEditorRoute } from "../../../../../components/map-project/map-project-editor-route";
import { mapProjectEditorEn } from "../../../../../i18n/map-project-en";
import { mapProjectEditorSv } from "../../../../../i18n/map-project-editor-sv";
import { sv } from "../../../../../i18n/sv";
import { currentLanguage } from "../../../../../lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? mapProjectEditorEn : mapProjectEditorSv;
  return { title: `${text.mapLabel} – ${sv.appName}`, robots: { index: false, follow: false } };
}

/** ADR-0219 (K1): kartprojektets karta med ritverktygen. Behörigheten avgörs av API:et. */
export default async function MapProjectMapRoute({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <MapProjectEditorRoute projectId={projectId} />;
}
