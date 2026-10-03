import { notFound, redirect } from "next/navigation";

/**
 * Avläsningen är ett statiskt appskal under /readout/ så att den kan starta
 * utan nät (service worker). Den här adressen leder dit.
 */
export default async function ReadoutRedirect({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  redirect(`/readout/index.html#${raceId}`);
}
