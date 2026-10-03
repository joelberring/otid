import Link from "next/link";
import { ClassStartDrawAdmin } from "../../../../components/class-start-draw-admin";
import { classStartDrawSv as text } from "../../../../i18n/class-start-draw-sv";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return <main className="stack class-start-draw-page"><nav className="nav"><Link href={`/admin/${raceId}`}>{text.back}</Link></nav><h1>{text.title}</h1><ClassStartDrawAdmin key={raceId} raceId={raceId} /></main>;
}
