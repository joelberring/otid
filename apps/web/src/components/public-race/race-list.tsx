import Link from "next/link";
import type { PublicRaceListItem } from "@o-tid/application";
import { publicRaceSv } from "../../i18n/public-race-sv";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { formatRaceDate, raceHubPath } from "../../lib/public-race-format";
import { publicLinksEn, raceTypeNamesEn } from "../../i18n/public-en";
import { LOCALE, type Language } from "../../lib/language";
import styles from "./public-race.module.css";
import { shownRaceName } from "@o-tid/domain";

export type RaceListTiming = "ONGOING" | "UPCOMING" | "RECENT";

/** Sträcktidsanalysen finns för individuella klasser (PLAN.md steg 16): inte stafett eller rogaining. */
export const hasSplitAnalysis = (raceType: PublicRaceListItem["raceType"]) => raceType !== "RELAY" && raceType !== "ROGAINING";

/**
 * Startsidans rad för en tävling (ADR-0172 beslut 4, skissen F3 2026-11-21): datum (i dag med första start), namnet som länk
 * till tävlingssidan, lopp · arrangörsklubb · typ, och följdlänkarna som gäller just då, små och grå till höger: Live och
 * resultat på tävlingsdagen, startlistan när den är publicerad, resultat och sträcktider efteråt. Inga knappar, inga adminlänkar.
 */
export function RaceList({ races, timing, today, language = "sv" }: { races: readonly PublicRaceListItem[]; timing: RaceListTiming; today: string;
  language?: Language }) {
  const text = language === "en" ? publicLinksEn : publicRaceSv.links;
  const typeName = (type: PublicRaceListItem["raceType"]) => language === "en" ? raceTypeNamesEn[type] : raceTypeSv.types[type].name;
  return <ul className={styles.raceList}>
    {races.map(race => {
      const started = timing !== "UPCOMING";
      // En fest har en egen sida (/fest/) utan Live.
      const links = [timing === "ONGOING" && race.raceType !== "PARTY" && <Link key="live" href={`${raceHubPath(race.shortCode)}/live`}>{text.live}</Link>,
        started && <Link key="results" href={`/results/${race.raceId}`}>{text.results}</Link>,
        timing === "RECENT" && hasSplitAnalysis(race.raceType) && <Link key="splits" href={`/results/${race.raceId}/splits`}>{text.splits}</Link>,
        race.startListPublished && timing !== "RECENT" && <Link key="start" href={`/starts/${race.raceId}`}>{text.startList}</Link>]
        .filter(Boolean);
      const details = [shownRaceName(race.eventName, race.raceName), race.organiserName, typeName(race.raceType)].filter(Boolean);
      const date = timing === "ONGOING" ? [text.today, race.firstStartTime?.replace(":", language === "en" ? ":" : ".")].filter(Boolean).join(" ")
        : formatRaceDate(race.raceDate, today, LOCALE[language]);
      return <li key={race.raceId} className={styles.raceRow}>
        <time className={styles.raceDate} dateTime={race.raceDate}>{date}</time>
        <div className={styles.raceName}>
          <Link href={raceHubPath(race.shortCode)}>{race.eventName}</Link>
          <span>{details.join(" · ")}</span>
        </div>
        {links.length > 0 && <nav className={styles.raceLinks} aria-label={race.eventName}>{links}</nav>}
      </li>;
    })}
  </ul>;
}
