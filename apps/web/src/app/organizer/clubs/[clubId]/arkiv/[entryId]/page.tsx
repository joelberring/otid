import type { Metadata } from "next";
import { ArchiveEntryPage } from "../../../../../../components/club-archive/archive-entry-page";
import { clubArchiveEn } from "../../../../../../i18n/club-archive-en";
import { clubArchiveSv } from "../../../../../../i18n/club-archive-sv";
import { sv } from "../../../../../../i18n/sv";
import { currentLanguage } from "../../../../../../lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? clubArchiveEn : clubArchiveSv;
  return { title: `${text.title} – ${sv.appName}`, robots: { index: false, follow: false } };
}

/** ADR-0194: en träning i klubbarkivet. Aldrig publikt; behörigheten avgörs av API:et. */
export default async function ArchiveEntry({ params }: { params: Promise<{ clubId: string; entryId: string }> }) {
  const { clubId, entryId } = await params;
  return <ArchiveEntryPage clubId={clubId} entryId={entryId} />;
}
