import { notFound } from "next/navigation";
import { DescriptionPrintPage } from "../../../../../components/course-setting/course-setting-descriptions-print";

export const dynamic = "force-dynamic";

/** Steg 63 (ADR-0180): kontrollbeskrivningarna att skriva ut. Bara administratör (API:t kontrollerar); banorna är hemliga (ADR-0176). */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <DescriptionPrintPage raceId={raceId} />;
}
