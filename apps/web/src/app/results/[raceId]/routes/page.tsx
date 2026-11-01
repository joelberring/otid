import Link from "next/link";
import { publicRaceSummary, raceGroupNameDisplay, readPublicLegRoutes } from "@o-tid/application";
import { db } from "../../../../lib/db";
import { RouteMap } from "../../../../components/split-analysis/route-map";
import { routeChoiceSv as text } from "../../../../i18n/split-analysis-sv";
import { legLabel, splitsHref } from "../../../../lib/split-analysis";
import { raceStaff, requirePublicRace } from "../../../../lib/public-race-gate";
import { PreviewBanner } from "../../../../components/public-race/preview-banner";
import { joinRaceParts, raceTitle, shownDisplayName } from "@o-tid/domain";

export const dynamic = "force-dynamic";

/** Vägval på en sträcka (PLAN.md steg 16): löparens väg och andras på samma sträcka. */
export default async function RouteChoicePage({ params, searchParams }: {
  params: Promise<{ raceId: string }>; searchParams: Promise<{ runner?: string | string[]; leg?: string | string[] }>;
}) {
  const [{ raceId }, query] = await Promise.all([params, searchParams]);
  const access = await requirePublicRace(raceId);
  const runner = typeof query.runner === "string" ? query.runner : "";
  const leg = typeof query.leg === "string" ? query.leg : "";
  // Steg 52: banan med kontrollägena bara när banorna är publika, eller för arrangören och funktionärerna.
  const staff = await raceStaff(raceId);
  const [summary, raw, names] = await Promise.all([publicRaceSummary(db, raceId), readPublicLegRoutes(db, raceId, runner, leg, { staff }),
    staff ? "FULL" as const : raceGroupNameDisplay(db, raceId)]);
  // Steg 68: löparnas namn enligt träningsgruppen.
  const data = raw && { ...raw, runners: raw.runners.map(row => ({ ...row, name: shownDisplayName(names, row.name) })) };
  const selected = data?.runners[0];
  return <main className="stack public-list-page">
    <nav className="nav" aria-label={text.back}><Link href={splitsHref(raceId, selected?.className)}>{text.back}</Link></nav>
    <PreviewBanner access={access} />
    <section className="public-list-heading">
      <h1>{data ? text.title(legLabel(data.leg)) : text.title("")}</h1>
      <p>{selected ? `${selected.name} · ${selected.className} · ` : ""}{joinRaceParts([raceTitle(summary.eventName, summary.name), summary.raceDate])}</p>
    </section>
    {data ? <><p className="muted">{text.intro}</p><RouteMap raceId={raceId} data={data} /></> : <p className="warning">{text.notFound}</p>}
  </main>;
}
