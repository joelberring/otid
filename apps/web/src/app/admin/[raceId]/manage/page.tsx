import { RaceAdministratorWorkspace } from "../../../../components/race-administrator-workspace";
import { raceAdministratorSv as text } from "../../../../i18n/race-administrator-sv";
import { developmentDemoAccessEnabled } from "../../../../lib/development-demo-access";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack race-admin-manage-page"><h1>{text.title}</h1>
    <RaceAdministratorWorkspace key={raceId} raceId={raceId} developmentAutoLogin={developmentDemoAccessEnabled(raceId)} />
  </main>;
}
