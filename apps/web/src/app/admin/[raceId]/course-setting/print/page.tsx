import { notFound } from "next/navigation";
import { CoursePrintPage } from "../../../../../components/course-setting/course-setting-print-page";

export const dynamic = "force-dynamic";

/** Steg 64 (ADR-0180): banorna att skriva ut som utkast. API:t kontrollerar behörigheten; banorna är hemliga (ADR-0176). */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <CoursePrintPage raceId={raceId} />;
}
