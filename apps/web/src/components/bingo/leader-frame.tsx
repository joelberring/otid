"use client";

import Link from "next/link";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { courseSettingTrainingPath } from "../../lib/course-setting-tab";
import { workspacePath } from "../../lib/race-sections";
import { useTexts } from "../language-provider";
import { EmptyState } from "../ui";
import styles from "./bingo.module.css";

/**
 * Översynen 2026-11-17: ledarsidorna (Bingo, Sänka skepp, virtuella kontroller) har en väg tillbaka till tävlingen överst; i
 * appen på iPhone finns ingen bakåtknapp.
 */
export function LeaderBack({ raceId }: { raceId: string }) {
  const text = useTexts(bingoSv.leader, bingoEn.leader);
  return <nav className={styles.leaderBack} aria-label={text.back}>
    <Link href={workspacePath(raceId)} prefetch={false} data-testid="bingo-leader-back">‹ {text.back}</Link>
  </nav>;
}

/** Ingen övning är påslagen: inget är fel, så ett lugnt besked som säger var den slås på, med en knapp dit. */
export function LeaderOff({ raceId }: { raceId: string }) {
  const text = useTexts(bingoSv.leader, bingoEn.leader);
  return <main className={styles.leader} data-testid="bingo-leader-off">
    <LeaderBack raceId={raceId} />
    <h1>{text.offHeading}</h1>
    <EmptyState title={text.offTitle} action={<Link className={styles.buttonLink} href={courseSettingTrainingPath(raceId)}
      data-testid="bingo-leader-open-training">{text.offOpen}</Link>}>{text.offWhere}</EmptyState>
  </main>;
}

/** När övningen är på: ändringar görs i banläggningen. */
export function LeaderChange({ raceId }: { raceId: string }) {
  const text = useTexts(bingoSv.leader, bingoEn.leader);
  return <Link href={courseSettingTrainingPath(raceId)}>{text.change}</Link>;
}
