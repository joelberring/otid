import { notFound } from "next/navigation";
import { StationsPage } from "../../../../components/stations-page";

export const dynamic = "force-dynamic";

/** Ägaren 2026-11-08: läsa ut enheter (kontroller, start, mål) med en huvudstation. Kräver arrangörsinloggning (deltagarna). */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <StationsPage key={raceId} raceId={raceId} />;
}
