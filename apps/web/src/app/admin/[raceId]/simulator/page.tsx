import Link from "next/link";
import { notFound } from "next/navigation";
import { Simulator } from "../../../../components/simulator";
import { database } from "../../../../lib/db";
import { resolveCurrentSimulatorPage } from "../../../../lib/simulator-page.server";

export const dynamic = "force-dynamic";

export default async function SimulatorPage({ params }: { params: Promise<{ raceId: string }> }) {
  const projection = await resolveCurrentSimulatorPage(params, async (raceId) => {
    const result = await database.pool.query<{ snapshot_version: number }>(
      "select snapshot_version from race where id = $1",
      [raceId]
    );
    return result.rows[0]?.snapshot_version ?? null;
  });
  if (!projection) notFound();
  const { raceId, snapshotVersion } = projection;
  return <main className="stack">
    <nav className="nav"><Link href="/">Tävlingar</Link></nav>
    <div className="warning"><strong>Utvecklingsyta.</strong> Simulatorn är inte SPORTident-USB och ingår inte i den skyddade tävlingsöversikten.</div>
    <p className="muted">Lopp-id: {raceId}</p>
    <Simulator raceId={raceId} packageVersion={snapshotVersion} />
  </main>;
}
