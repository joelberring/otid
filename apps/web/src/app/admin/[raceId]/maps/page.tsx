import { notFound } from "next/navigation";
import { MapBundlesPage } from "../../../../components/map-bundles/map-bundles-page";

export const dynamic = "force-dynamic";

/** Steg 61: kartor till starten – tryckantal, kartbuntslistan och baksidor. Kräver inloggning (administratör eller funktionär). */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <MapBundlesPage raceId={raceId} />;
}
