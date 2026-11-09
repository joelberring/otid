import type { Metadata } from "next";
import { GroupLeaderView } from "../../../../components/training-group/group-leader-view";
import { sv } from "../../../../i18n/sv";
import { trainingGroupEn } from "../../../../i18n/training-group-en";
import { trainingGroupSv } from "../../../../i18n/training-group-sv";
import { currentLanguage } from "../../../../lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? trainingGroupEn : trainingGroupSv;
  return { title: `${text.myGroups.title} – ${sv.appName}`, robots: { index: false, follow: false } };
}

/** Steg 68: ledarnas vy av en träningsgrupp (Mina tävlingar → gruppen). Behörigheten avgörs av API:et. */
export default async function GroupLeaderPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return <GroupLeaderView groupId={groupId} />;
}
