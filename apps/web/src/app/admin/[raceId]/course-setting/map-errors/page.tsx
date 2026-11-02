import { notFound } from "next/navigation";
import { MapErrorsPage } from "../../../../../components/course-setting/course-setting-map-errors-page";

export const dynamic = "force-dynamic";

/**
 * ADR-0181 beslut 8: kartfelen till kartritaren (utskrift/PDF och GeoJSON), utan banorna. API:t kontrollerar
 * banläggningens behörighet.
 */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <MapErrorsPage raceId={raceId} />;
}
