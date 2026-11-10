import type { Metadata } from "next";
import { ClubArchivePage } from "../../../../components/club-archive/club-archive-page";
import { clubArchiveEn } from "../../../../i18n/club-archive-en";
import { clubArchiveSv } from "../../../../i18n/club-archive-sv";
import { sv } from "../../../../i18n/sv";
import { currentLanguage } from "../../../../lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? clubArchiveEn : clubArchiveSv;
  return { title: `${text.title} – ${sv.appName}`, robots: { index: false, follow: false } };
}

/** ADR-0194: klubbarkivet. Aldrig publikt; behörigheten avgörs av API:et. */
export default async function ClubPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  return <ClubArchivePage clubId={clubId} />;
}
