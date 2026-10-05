import Link from "next/link";
import type { PublicRaceListItem } from "@o-tid/application";
import { publicRaceSv } from "../../i18n/public-race-sv";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { formatRaceDate, raceHubPath } from "../../lib/public-race-format";
import styles from "./public-race.module.css";

const text = publicRaceSv.links;
export type RaceListTiming = "ONGOING" | "UPCOMING" | "RECENT";

/** Sträcktidsanalysen finns för individuella klasser (PLAN.md steg 16): inte stafett eller rogaining. */
export const hasSplitAnalysis = (raceType: PublicRaceListItem["raceType"]) => raceType !== "RELAY" && raceType !== "ROGAINING";

/**
 * Startsidans rad för en tävling (ADR-0172 beslut 4): datum, namn (till tävlingssidan), lopp och typ, och
 * länkarna som gäller just då. Startlistan bara när den är publicerad; resultat och sträcktider från tävlingsdagen.
 * Inga adminlänkar.
 */
export function RaceList({ races, timing, today }: { races: readonly PublicRaceListItem[]; timing: RaceListTiming; today: string }) {
  return <ul className={styles.raceList}>
    {races.map(race => {
      const started = timing !== "UPCOMING";
      const links = [race.startListPublished && <Link key="start" href={`/starts/${race.raceId}`}>{text.startList}</Link>,
        started && <Link key="results" href={`/results/${race.raceId}`}>{text.results}</Link>,
        started && hasSplitAnalysis(race.raceType) && <Link key="splits" href={`/results/${race.raceId}/splits`}>{text.splits}</Link>]
        .filter(Boolean);
      const details = [race.raceName !== race.eventName ? race.raceName : undefined, raceTypeSv.types[race.raceType].name].filter(Boolean);
      return <li key={race.raceId} className={styles.raceRow}>
        <time className={styles.raceDate} dateTime={race.raceDate}>{formatRaceDate(race.raceDate, today)}</time>
        <div className={styles.raceName}>
          <Link href={raceHubPath(race.shortCode)}>{race.eventName}</Link>
          <span>{details.join(" · ")}</span>
        </div>
        {links.length > 0 && <nav className={styles.raceLinks} aria-label={race.eventName}>{links}</nav>}
      </li>;
    })}
  </ul>;
}
