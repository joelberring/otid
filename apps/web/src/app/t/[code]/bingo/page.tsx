import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { raceIdForShortCode, readBingoPublic } from "@o-tid/application";
import { raceTitle } from "@o-tid/domain";
import { BingoRunner } from "../../../../components/bingo/bingo-runner";
import styles from "../../../../components/bingo/bingo.module.css";
import { bingoEn } from "../../../../i18n/bingo-en";
import { bingoSv } from "../../../../i18n/bingo-sv";
import { sv } from "../../../../i18n/sv";
import { db } from "../../../../lib/db";
import { LOCALE } from "../../../../lib/language";
import { currentLanguage } from "../../../../lib/language-server";
import { NO_INDEX_ROBOTS } from "../../../../lib/no-index";
import { raceStaff, requirePublicRace } from "../../../../lib/public-race-gate";
import { formatRaceDate } from "../../../../lib/public-race-format";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ code: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? bingoEn.runner : bingoSv.runner;
  return { title: `${text.title} – ${sv.appName}`, robots: NO_INDEX_ROBOTS };
}

/**
 * Bingo med telefonen (ADR-0225): löparens sida på tävlingens korta adress. Samma grind som tävlingssidan; öppen bara på
 * träningsdagen (arrangören och funktionären kan prova alla dagar). Indexeras aldrig.
 */
export default async function BingoPage({ params }: Params) {
  const raceId = await raceIdForShortCode(db, (await params).code);
  if (!raceId) notFound();
  await requirePublicRace(raceId);
  const read = await readBingoPublic(db, { raceId, staff: await raceStaff(raceId) });
  if (read.status === "not-found") notFound();
  const language = await currentLanguage();
  const text = language === "en" ? bingoEn.runner : bingoSv.runner;
  if (read.status === "closed") {
    return <main className={styles.page}><h1>{text.title}</h1><p className={styles.kicker}>{raceTitle(read.eventName, read.raceName)}</p>
      <p role="status">{text.closed(formatRaceDate(read.raceDate, undefined, LOCALE[language]))}</p></main>;
  }
  return <BingoRunner raceId={raceId} mode={read.race.mode} title={raceTitle(read.race.eventName, read.race.raceName)} groups={read.setup.groups}
    georeference={read.setup.georeference} mapScale={read.setup.mapScale} image={read.setup.image} initialBoard={read.leaderboard} />;
}
