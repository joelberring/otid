import { notFound } from "next/navigation";
import { CourseSettingPage } from "../../../../components/course-setting/course-setting-page";

export const dynamic = "force-dynamic";

/** Steg 62 (ADR-0180): banläggningen i webben. Bara administratör (API:t kontrollerar); banorna är hemliga (ADR-0176). */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <CourseSettingPage raceId={raceId} />;
}
