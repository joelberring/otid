import Link from "next/link";
import { notPublishedEn, resultNotFoundEn } from "../../i18n/workspace-last-en";
import { publicHomeEn } from "../../i18n/public-en";
import { publicRaceSv } from "../../i18n/public-race-sv";
import { currentLanguage } from "../../lib/language-server";
import styles from "./public-race.module.css";

/**
 * Det besökaren ser på en publik adress till en tävling som inte är publicerad, är dold eller inte finns
 * (ADR-0172 beslut 4). Aldrig tävlingens namn. Används av sidornas not-found (status 404); `result` för ett resultat som
 * inte finns. På besökarens språk.
 */
export async function RaceNotPublished({ result = false }: { result?: boolean }) {
  const en = await currentLanguage() === "en";
  const text = en ? notPublishedEn : publicRaceSv.notPublished, home = en ? publicHomeEn : publicRaceSv.home;
  const heading = result ? (en ? resultNotFoundEn : publicRaceSv.resultNotFound) : text;
  return <main className={styles.notPublished}>
    <h1>{heading.title}</h1>
    <p>{heading.help}</p>
    <p className={styles.muted}>{text.organizer}</p>
    <p className={styles.notPublishedLinks}><Link href="/">{text.home}</Link><Link href="/organizer">{home.myRaces}</Link></p>
  </main>;
}
