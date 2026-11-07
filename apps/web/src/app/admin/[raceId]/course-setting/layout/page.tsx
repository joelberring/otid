import { notFound } from "next/navigation";
import { CourseLayoutPage } from "../../../../../components/course-setting/course-setting-layout-page";

export const dynamic = "force-dynamic";

/** ADR-0217: fliken Layout (papperet). API:t kontrollerar behörigheten; banorna är hemliga (ADR-0176). */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <CourseLayoutPage raceId={raceId} />;
}
