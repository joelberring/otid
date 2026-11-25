import { notPublishedEn } from "../../../i18n/workspace-last-en";
import type { Metadata } from "next";
import { NO_INDEX_ROBOTS } from "../../../lib/no-index";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { sv } from "../../../i18n/sv";
import { publicRaceSv } from "../../../i18n/public-race-sv";
import { raceTypeSv } from "../../../i18n/race-type-sv";
import { radioSv } from "../../../i18n/radio-sv";
import { liveSv } from "../../../i18n/live-sv";
import { loadRaceHub, requireRaceHub } from "../../../lib/public-race-hub";
import { publicOrigin } from "../../../lib/public-origin";
import { displayAddress, formatRaceDate, formatRaceInstant, raceHubPath } from "../../../lib/public-race-format";
import { raceTypeProfile } from "../../../lib/race-sections";
import { PreviewBanner } from "../../../components/public-race/preview-banner";
import { hasSplitAnalysis } from "../../../components/public-race/race-list";
import { PublicLinkShare } from "../../../components/public-link-share";
import { RaceInfo } from "../../../components/race-info";
import { SelfRegistrationForm } from "../../../components/self-registration/self-registration-form";
import styles from "../../../components/public-race/public-race.module.css";
import { raceDetails, shownRaceName } from "@o-tid/domain";
import { hubEn, hubMoreEn, raceTypeNamesEn } from "../../../i18n/public-en";
import { currentLanguage } from "../../../lib/language-server";
import { LOCALE } from "../../../lib/language";
import { raceGroupNameDisplay, readBingoLeaderboard, readMastermindStandings } from "@o-tid/application";
import { LiveBingoBoard } from "../../../components/bingo/bingo-board";
import { LiveMastermindBoard } from "../../../components/mastermind/mastermind-board";
import { db } from "../../../lib/db";
import { demoRacePath } from "../../../lib/intro-film";
import { accountSessionToken } from "../../../lib/public-race-gate";
import { countVisit } from "../../../lib/visitor-tracking";
import { bingoEn } from "../../../i18n/bingo-en";
import { bingoSv } from "../../../i18n/bingo-sv";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const hub = await loadRaceHub((await params).code);
  const en = await currentLanguage() === "en";
  if (!hub) return { title: `${(await currentLanguage() === "en" ? notPublishedEn : publicRaceSv.notPublished).title} – ${sv.appName}`, robots: NO_INDEX_ROBOTS };
  const title = `${hub.eventName} – ${sv.appName}`;
  const text = publicRaceSv.hub;
  const description = `${raceDetails(hub.eventName, hub.raceName, [formatRaceDate(hub.raceDate, undefined, en ? LOCALE.en : LOCALE.sv)], ", ")}. ` +
    (en ? hubMoreEn.metaLists : `${text.startList}, ${text.results.toLowerCase()} och sträcktider.`);
  const url = new URL(raceHubPath(hub.shortCode), await publicOrigin()).toString();
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, siteName: sv.appName, type: "website" }, robots: NO_INDEX_ROBOTS };
}

/**
 * Tävlingssidan (ADR-0172 beslut 4) med kort adress: navet för besökare. Kort info och första start (steg 33), startlista, resultat, Live (PLAN.md steg 30),
 * sträcktidsanalys och vägval när de finns, radiokontroller live, senaste uppdatering och adressen att dela.
 */
export default async function RaceHubPage({ params }: Params) {
  const hub = await requireRaceHub((await params).code);
  // PLAN.md steg 40: en fest har en egen sida under /fest/, så att den kan stängas för robotar utan att röra tävlingarna.
  if (hub.raceType === "PARTY") redirect(`/fest/${hub.shortCode}`);
  const language = await currentLanguage(), en = language === "en";
  const text = en ? hubEn : publicRaceSv.hub;
  const bingoText = en ? bingoEn.runner : bingoSv.runner;
  const path = raceHubPath(hub.shortCode);
  // Besöksstatistiken (ägaren 2026-11-22): demotävlingen (OTID_DEMO_RACE) öppnad av en besökare utan inloggning.
  if (path === demoRacePath() && !await accountSessionToken()) countVisit("DEMO_RACE", await headers());
  const address = displayAddress(await publicOrigin(), path);
  const names = await raceGroupNameDisplay(db, hub.raceId);
  // ADR-0225: bingons topplista (bara på träningsdagen).
  const bingoBoard = hub.bingo ? await readBingoLeaderboard(db, { raceId: hub.raceId, staff: false }) : undefined;
  // ADR-0228: Mastermind med kontroller (bara en träning, bara på träningsdagen och när något spel finns).
  const mastermindBoard = hub.raceType === "TRAINING" ? await readMastermindStandings(db, { raceId: hub.raceId, staff: false }) : undefined;
  const hasStartSection = raceTypeProfile(hub.raceType).course.some(section => section.id === "START");
  const details = [shownRaceName(hub.eventName, hub.raceName), formatRaceDate(hub.raceDate, undefined, LOCALE[language]),
    en ? raceTypeNamesEn[hub.raceType] : raceTypeSv.types[hub.raceType].name]
    .filter(Boolean);
  const link = (href: string, title: string, help: string) => <li><Link className={styles.hubLink} href={href}>
    <strong>{title}</strong><span>{help}</span></Link></li>;
  return <main className={styles.hub}>
    <PreviewBanner access={hub.access} language={language} />
    <div className={styles.hubHeading}>
      <h1>{hub.eventName}</h1>
      <p>{details.join(" · ")}</p>
    </div>
    <RaceInfo info={hub.info} firstStartTime={hub.firstStartTime} language={language} />
    {hub.bingo && <section className={styles.bingoStart} aria-label={bingoText.hubCta[hub.bingoMode ?? "BINGO"]}>
      {/* Ägaren 2026-11-17: supertydligt var man anmäler sig – en stor färgad knapp, sedan reglerna och topplistan. */}
      <Link className={styles.bingoCta} href={`${path}/bingo`} data-testid="hub-bingo">
        <strong>{bingoText.hubCta[hub.bingoMode ?? "BINGO"]}</strong><span>{bingoText.hubCtaHelp}</span></Link>
      <h2>{bingoText.hubRules}</h2>
      <ol className={styles.bingoRules}>{bingoText.guide[hub.bingoMode ?? "BINGO"].map(item => <li key={item.text}><span aria-hidden="true">{item.icon}</span>
        <span>{item.text}</span></li>)}</ol>
    </section>}
    {bingoBoard && <LiveBingoBoard raceId={hub.raceId} initial={bingoBoard} />}
    {mastermindBoard && <LiveMastermindBoard raceId={hub.raceId} initial={mastermindBoard} />}
    {/* En bingoträning har sin egen anmälan på löparsidan; den vanliga anmälan här skulle bara förvirra. */}
    {!hub.bingo && <SelfRegistrationForm raceId={hub.raceId} startList={hub.startListPublished} names={names} />}
    <ul className={styles.hubLinks} aria-label={text.navigation}>
      {hub.startListPublished ? link(`/starts/${hub.raceId}`, text.startList, text.startListHelp)
        : hasStartSection && !hub.bingo && <li><div className={styles.hubPending}><strong>{text.startList}</strong><span>{text.startListPending}</span></div></li>}
      {link(`/results/${hub.raceId}`, text.results, hub.hasResults ? text.resultsHelp : text.resultsPending)}
      {link(`${path}/live`, en ? hubMoreEn.liveTitle : liveSv.hubTitle, en ? hubMoreEn.liveHelp : liveSv.hubHelp)}
      {hub.radio && link(`${path}/live#live-radio`, en ? hubMoreEn.radioTitle : radioSv.hub.title, en ? hubMoreEn.radioHelp : radioSv.hub.help)}
      {hub.hasResults && hasSplitAnalysis(hub.raceType) && link(`/results/${hub.raceId}/splits`, text.splits, text.splitsHelp)}
      {hub.routes && link(`/results/${hub.raceId}/routes`, text.routes, text.routesHelp)}
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
