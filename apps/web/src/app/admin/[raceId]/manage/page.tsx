import { GuestNotice } from "../../../../components/guest-notice";
import { RaceAdministratorWorkspace } from "../../../../components/race-administrator-workspace";
import { raceAdministratorSv } from "../../../../i18n/race-administrator-sv";
import { raceAdministratorEn } from "../../../../i18n/workspace-admin-en";
import { currentLanguage } from "../../../../lib/language-server";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const text = await currentLanguage() === "en" ? raceAdministratorEn : raceAdministratorSv;
  return <main className="race-admin-manage-page"><h1 className="visually-hidden">{text.title}</h1>
    <GuestNotice />
    <RaceAdministratorWorkspace key={raceId} raceId={raceId} />
  </main>;
}
