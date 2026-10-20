import type { Metadata } from "next";
import Link from "next/link";
import { readPublicLive } from "@o-tid/application";
import { sv } from "../../../../i18n/sv";
import { liveSv as text } from "../../../../i18n/live-sv";
import { publicRaceSv } from "../../../../i18n/public-race-sv";
import { db } from "../../../../lib/db";
import { loadRaceHub, requireRaceHub } from "../../../../lib/public-race-hub";
import { formatRaceDate, raceHubPath } from "../../../../lib/public-race-format";
import { PreviewBanner } from "../../../../components/public-race/preview-banner";
import { PublicLive } from "../../../../components/public-live/public-live";
import styles from "../../../../components/public-race/public-race.module.css";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const hub = await loadRaceHub((await params).code);
  if (!hub) return { title: `${publicRaceSv.notPublished.title} – ${sv.appName}`, robots: { index: false } };
  return { title: `${text.metaTitle(hub.eventName)} – ${sv.appName}`, robots: { index: false } };
}

/**
 * Live för publiken (PLAN.md steg 30) på tävlingssidans korta adress: senast i mål, ledare per klass, radiopassager och de
 * löpare och klubbar som besökaren följer. Samma grind som tävlingssidan (opublicerad eller dold ger samma 404).
 */
export default async function LivePage({ params }: Params) {
  const hub = await requireRaceHub((await params).code);
  const initial = await readPublicLive(db, hub.raceId);
  const race = [hub.raceName !== hub.eventName ? hub.raceName : undefined, formatRaceDate(hub.raceDate)].filter(Boolean).join(" · ");
  return <main className={styles.livePage}>
    <nav className={styles.hubNav} aria-label={publicRaceSv.hub.navigation}>
      <Link href={raceHubPath(hub.shortCode)}>{publicRaceSv.hub.back}</Link>
      <Link href={`/results/${hub.raceId}`}>{text.results}</Link>
    </nav>
    <PreviewBanner access={hub.access} />
    <div className={styles.hubHeading}>
      <h1>{hub.eventName}</h1>
      <p>{text.heading(race)}</p>
    </div>
    <PublicLive raceId={hub.raceId} initial={initial} />
  </main>;
}
