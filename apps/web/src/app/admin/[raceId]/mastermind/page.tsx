import { notFound, redirect } from "next/navigation";

/**
 * Mastermind med kontroller från en träning (Mer i tävlingsraden, sidopanelen): samma statiska skal som `/mastermind/`, med
 * träningens id efter #, så att resultaten hålls isär per träning och Byt funktion leder tillbaka. Som `/admin/{id}/readout`.
 */
export default async function MastermindRedirect({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  redirect(`/mastermind/index.html#${raceId}`);
}
