import type { Metadata } from "next";
import Link from "next/link";
import { sv } from "../../../i18n/sv";
import { publicRaceSv } from "../../../i18n/public-race-sv";
import { raceTypeSv } from "../../../i18n/race-type-sv";
import { loadRaceHub, requireRaceHub } from "../../../lib/public-race-hub";
import { publicOrigin } from "../../../lib/public-origin";
import { displayAddress, formatRaceDate, formatRaceInstant, raceHubPath } from "../../../lib/public-race-format";
import { raceTypeProfile } from "../../../lib/race-sections";
import { PreviewBanner } from "../../../components/public-race/preview-banner";
import { hasSplitAnalysis } from "../../../components/public-race/race-list";
import { PublicLinkShare } from "../../../components/public-link-share";
import styles from "../../../components/public-race/public-race.module.css";

export const dynamic = "force-dynamic";
const text = publicRaceSv.hub;
type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const hub = await loadRaceHub((await params).code);
  if (!hub) return { title: `${publicRaceSv.notPublished.title} – ${sv.appName}`, robots: { index: false } };
  const title = `${hub.eventName} – ${sv.appName}`;
  const description = `${[hub.raceName !== hub.eventName ? hub.raceName : undefined, formatRaceDate(hub.raceDate)].filter(Boolean).join(", ")}. ` +
    `${text.startList}, ${text.results.toLowerCase()} och sträcktider.`;
  const url = new URL(raceHubPath(hub.shortCode), await publicOrigin()).toString();
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, siteName: sv.appName, type: "website" },
    ...(hub.access === "PREVIEW" ? { robots: { index: false } } : {}) };
}

/**
 * Tävlingssidan (ADR-0172 beslut 4) med kort adress: navet för besökare. Startlista, resultat, sträcktidsanalys och
 * vägval när de finns, senaste uppdatering och adressen att dela. Fler vägar (radio, live) läggs i samma lista.
 */
export default async function RaceHubPage({ params }: Params) {
  const hub = await requireRaceHub((await params).code);
  const path = raceHubPath(hub.shortCode);
  const address = displayAddress(await publicOrigin(), path);
  const hasStartSection = raceTypeProfile(hub.raceType).course.some(section => section.id === "START");
  const details = [hub.raceName !== hub.eventName ? hub.raceName : undefined, formatRaceDate(hub.raceDate), raceTypeSv.types[hub.raceType].name]
    .filter(Boolean);
  const link = (href: string, title: string, help: string) => <li><Link className={styles.hubLink} href={href}>
    <strong>{title}</strong><span>{help}</span></Link></li>;
  return <main className={styles.hub}>
    <PreviewBanner access={hub.access} />
    <div className={styles.hubHeading}>
      <h1>{hub.eventName}</h1>
      <p>{details.join(" · ")}</p>
    </div>
    <ul className={styles.hubLinks} aria-label={text.navigation}>
      {hub.startListPublished ? link(`/starts/${hub.raceId}`, text.startList, text.startListHelp)
        : hasStartSection && <li><div className={styles.hubPending}><strong>{text.startList}</strong><span>{text.startListPending}</span></div></li>}
      {link(`/results/${hub.raceId}`, text.results, hub.hasResults ? text.resultsHelp : text.resultsPending)}
      {hub.hasResults && hasSplitAnalysis(hub.raceType) && link(`/results/${hub.raceId}/splits`, text.splits, text.splitsHelp)}
      {hub.routes && link(`/results/${hub.raceId}/splits`, text.routes, text.routesHelp)}
    </ul>
    <div className={styles.hubFoot}>
      {hub.lastUpdate && <p>{text.lastUpdate} <time dateTime={hub.lastUpdate}>{formatRaceInstant(hub.lastUpdate, hub.timeZone)}</time></p>}
      <div className={styles.hubAddress}>
        <span>{text.address}: <code>{address}</code></span>
        <PublicLinkShare path={path} title={hub.eventName} />
      </div>
    </div>
  </main>;
}
