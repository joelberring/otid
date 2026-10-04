import { notFound } from "next/navigation";
import { SpeakerPage } from "../../../../components/speaker-page";
import { speakerSv as text } from "../../../../i18n/speaker-sv";

export const dynamic = "force-dynamic";

/** ADR-0170: speakern har en egen sida för en egen skärm eller ett eget fönster. Kräver arrangörsinloggning. */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <main className="speaker-page"><h1 className="visually-hidden">{text.title}</h1><SpeakerPage key={raceId} raceId={raceId} /></main>;
}
