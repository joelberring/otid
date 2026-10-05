import Link from "next/link";
import { publicRaceSummary, readPublicLegRoutes } from "@o-tid/application";
import { db } from "../../../../lib/db";
import { RouteMap } from "../../../../components/split-analysis/route-map";
import { routeChoiceSv as text } from "../../../../i18n/split-analysis-sv";
import { legLabel, splitsHref } from "../../../../lib/split-analysis";
import { requirePublicRace } from "../../../../lib/public-race-gate";

export const dynamic = "force-dynamic";

/** Vägval på en sträcka (PLAN.md steg 16): löparens väg och andras på samma sträcka. */
export default async function RouteChoicePage({ params, searchParams }: {
  params: Promise<{ raceId: string }>; searchParams: Promise<{ runner?: string | string[]; leg?: string | string[] }>;
}) {
  const [{ raceId }, query] = await Promise.all([params, searchParams]);
  await requirePublicRace(raceId);
  const runner = typeof query.runner === "string" ? query.runner : "";
  const leg = typeof query.leg === "string" ? query.leg : "";
  const [summary, data] = await Promise.all([publicRaceSummary(db, raceId), readPublicLegRoutes(db, raceId, runner, leg)]);
  const selected = data?.runners[0];
  return <main className="stack public-list-page">
    <nav className="nav" aria-label={text.back}><Link href={splitsHref(raceId, selected?.className)}>{text.back}</Link></nav>
    <section className="public-list-heading">
      <h1>{data ? text.title(legLabel(data.leg)) : text.title("")}</h1>
      <p>{selected ? `${selected.name} · ${selected.className} · ` : ""}{summary.eventName} · {summary.name} · {summary.raceDate}</p>
    </section>
    {data ? <><p className="muted">{text.intro}</p><RouteMap raceId={raceId} data={data} /></> : <p className="warning">{text.notFound}</p>}
  </main>;
}
