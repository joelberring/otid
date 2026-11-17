import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { raceIdForShortCode, readBingoPublic } from "@o-tid/application";
import { raceTitle } from "@o-tid/domain";
import { BingoRunner } from "../../../../components/bingo/bingo-runner";
import { VirtualRunner } from "../../../../components/bingo/virtual-runner";
import styles from "../../../../components/bingo/bingo.module.css";
import { bingoEn } from "../../../../i18n/bingo-en";
import { bingoSv } from "../../../../i18n/bingo-sv";
import { sv } from "../../../../i18n/sv";
import { db } from "../../../../lib/db";
import { LOCALE } from "../../../../lib/language";
import { currentLanguage } from "../../../../lib/language-server";
import { NO_INDEX_ROBOTS } from "../../../../lib/no-index";
import { raceStaff, requirePublicRace } from "../../../../lib/public-race-gate";
import { formatRaceDate, raceHubPath } from "../../../../lib/public-race-format";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const en = await currentLanguage() === "en";
  const raceId = await raceIdForShortCode(db, (await params).code);
  const read = raceId ? await readBingoPublic(db, { raceId, staff: false }) : undefined;
  const mode = read?.status === "ok" ? read.race.mode : read?.status === "closed" ? read.mode : "BINGO";
  const title = mode === "SHIPS" ? (en ? bingoEn : bingoSv).ships.title : mode === "CONTROLS" ? (en ? bingoEn : bingoSv).virtual.title
    : (en ? bingoEn : bingoSv).runner.title;
  return { title: `${title} – ${sv.appName}`, robots: NO_INDEX_ROBOTS };
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
  const language = await currentLanguage();
  const text = language === "en" ? bingoEn.runner : bingoSv.runner;
  // Översynen 2026-11-17: tävlingen syns för den som frågar (grinden ovan), men ingen övning är påslagen. Säg det i stället för
  // "Tävlingen är inte publicerad"; den som inte får se tävlingen har redan fått 404 av grinden.
  if (read.status === "not-found") return <main className={styles.page} data-testid="bingo-not-running"><h1>{text.title}</h1>
    <p role="status">{text.notRunning}</p>
    <p><Link href={raceHubPath((await params).code)}>{text.racePage}</Link></p></main>;
  if (read.status === "closed") {
    return <main className={styles.page}><h1>{read.mode === "SHIPS" ? (language === "en" ? bingoEn : bingoSv).ships.title
      : read.mode === "CONTROLS" ? (language === "en" ? bingoEn : bingoSv).virtual.title : text.title}</h1><p className={styles.kicker}>{raceTitle(read.eventName, read.raceName)}</p>
      <p role="status">{text.closed(formatRaceDate(read.raceDate, undefined, LOCALE[language]))}</p></main>;
  }
  // ADR-0226: virtuella kontroller har en egen löparsida; Bingo och Sänka skepp är oförändrade.
  if (read.race.mode === "CONTROLS") return <VirtualRunner raceId={raceId} title={raceTitle(read.race.eventName, read.race.raceName)}
    courses={read.setup.courses} settings={read.setup.settings} georeference={read.setup.georeference} mapScale={read.setup.mapScale}
    image={read.setup.image} initialBoard={read.leaderboard} />;
  return <BingoRunner raceId={raceId} mode={read.race.mode} title={raceTitle(read.race.eventName, read.race.raceName)} groups={read.setup.groups}
    georeference={read.setup.georeference} mapScale={read.setup.mapScale} image={read.setup.image} initialBoard={read.leaderboard} />;
}
