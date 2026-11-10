import type { Metadata } from "next";
import { PlanPrint } from "../../../../../../components/club-planning/plan-print";
import { clubPlanningEn } from "../../../../../../i18n/club-planning-en";
import { clubPlanningSv } from "../../../../../../i18n/club-planning-sv";
import { sv } from "../../../../../../i18n/sv";
import { currentLanguage } from "../../../../../../lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? clubPlanningEn : clubPlanningSv;
  return { title: `${text.term.print} – ${sv.appName}`, robots: { index: false, follow: false } };
}

/** ADR-0221, översynen G6: terminen för utskrift. Aldrig publik; behörigheten avgörs av API:et. */
export default async function PlanPrintPage({ params, searchParams }: { params: Promise<{ clubId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { clubId } = await params;
  const term = (await searchParams).term;
  return <main><PlanPrint clubId={clubId} termId={typeof term === "string" ? term : null} /></main>;
}
