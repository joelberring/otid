import { notPublishedEn } from "../../../../i18n/workspace-last-en";
import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "../../../../lib/no-index";
import Link from "next/link";
import { sv } from "../../../../i18n/sv";
import { liveSv } from "../../../../i18n/live-sv";
import { publicRaceSv } from "../../../../i18n/public-race-sv";
import { cachedPublicLive } from "../../../../lib/public-race-data";
import { loadRaceHub, requireRaceHub } from "../../../../lib/public-race-hub";
import { formatRaceDate, raceHubPath } from "../../../../lib/public-race-format";
import { PreviewBanner } from "../../../../components/public-race/preview-banner";
import { PublicLive } from "../../../../components/public-live/public-live";
import styles from "../../../../components/public-race/public-race.module.css";
import { raceDetails } from "@o-tid/domain";
import { hubEn, liveEn } from "../../../../i18n/public-en";
import { currentLanguage } from "../../../../lib/language-server";
import { LOCALE } from "../../../../lib/language";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const hub = await loadRaceHub((await params).code);
  if (!hub) return { title: `${(await currentLanguage() === "en" ? notPublishedEn : publicRaceSv.notPublished).title} – ${sv.appName}`, robots: NO_INDEX_ROBOTS };
  const text = await currentLanguage() === "en" ? liveEn : liveSv;
  return { title: `${text.metaTitle(hub.eventName)} – ${sv.appName}`, robots: NO_INDEX_ROBOTS };
}

/**
 * Live för publiken (PLAN.md steg 30) på tävlingssidans korta adress: senast i mål, ledare per klass, radiopassager och de
 * löpare och klubbar som besökaren följer. Samma grind som tävlingssidan (opublicerad eller dold ger samma 404).
 */
export default async function LivePage({ params }: Params) {
  const hub = await requireRaceHub((await params).code);
  const initial = (await cachedPublicLive(hub.raceId, { exact: true })).value;
  const language = await currentLanguage(), en = language === "en";
  const text = en ? liveEn : liveSv, hubText = en ? hubEn : publicRaceSv.hub;
  const race = raceDetails(hub.eventName, hub.raceName, [formatRaceDate(hub.raceDate, undefined, LOCALE[language])]);
  return <main className={styles.livePage}>
    <nav className={styles.hubNav} aria-label={hubText.navigation}>
      <Link href={raceHubPath(hub.shortCode)}>{hubText.back}</Link>
      <Link href={`/results/${hub.raceId}`}>{text.results}</Link>
    </nav>
    <PreviewBanner access={hub.access} language={language} />
    <div className={styles.hubHeading}>
      <h1>{hub.eventName}</h1>
      <p>{text.heading(race)}</p>
    </div>
    <PublicLive raceId={hub.raceId} initial={initial} />
  </main>;
}
