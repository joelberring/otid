import Link from "next/link";
import { PublicRouteComparison } from "../../../../components/public-route-comparison";
import { publicRouteComparisonSv as text } from "../../../../i18n/public-route-comparison-sv";

export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ raceId: string }>; searchParams: Promise<{ first?: string | string[]; second?: string | string[]; third?: string | string[] }> }) {
  const [{ raceId }, query] = await Promise.all([params, searchParams]);
  const first = typeof query.first === "string" ? query.first : "";
  const second = typeof query.second === "string" ? query.second : "";
  const third = typeof query.third === "string" ? query.third : undefined;
  return <main className="stack public-route-comparison-page"><nav className="nav"><Link href={`/results/${raceId}`}>{text.back}</Link></nav><h1>{text.title}</h1><PublicRouteComparison raceId={raceId} firstPublicResultId={first} secondPublicResultId={second} {...(third === undefined ? {} : { thirdPublicResultId: third })} /></main>;
}
