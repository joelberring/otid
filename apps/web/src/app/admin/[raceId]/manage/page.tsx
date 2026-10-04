import { RaceAdministratorWorkspace } from "../../../../components/race-administrator-workspace";
import { raceAdministratorSv as text } from "../../../../i18n/race-administrator-sv";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="race-admin-manage-page"><h1 className="visually-hidden">{text.title}</h1>
    <RaceAdministratorWorkspace key={raceId} raceId={raceId} />
  </main>;
}
