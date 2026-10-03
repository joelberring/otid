import Link from "next/link";
import { RaceOverviewAdmin } from "../../../components/race-overview-admin";

export const dynamic = "force-dynamic";

export default async function AdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack">
    <nav className="nav"><Link href="/">Tävlingar</Link></nav>
    <RaceOverviewAdmin raceId={raceId} />
  </main>;
}
