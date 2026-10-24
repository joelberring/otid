import { notFound } from "next/navigation";
import { PartyLabels } from "../../../../components/race-administrator/party-labels";

export const dynamic = "force-dynamic";

/** Fest (PLAN.md steg 40): etiketter att klistra på kontrollenheterna. Kräver inloggning (läser festens varor). */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <PartyLabels raceId={raceId} />;
}
