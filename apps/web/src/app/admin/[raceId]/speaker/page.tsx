import { notFound } from "next/navigation";
import { SpeakerPage } from "../../../../components/speaker-page";
import { speakerSv } from "../../../../i18n/speaker-sv";
import { speakerEn } from "../../../../i18n/workspace-more-en";
import { currentLanguage } from "../../../../lib/language-server";

export const dynamic = "force-dynamic";

/** ADR-0170: speakern har en egen sida för en egen skärm eller ett eget fönster. Kräver arrangörsinloggning. */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  const text = await currentLanguage() === "en" ? speakerEn : speakerSv;
  return <main className="speaker-page"><h1 className="visually-hidden">{text.title}</h1><SpeakerPage key={raceId} raceId={raceId} /></main>;
}
