import Link from "next/link";
import { publicRaceSv } from "../../i18n/public-race-sv";
import styles from "./public-race.module.css";

const text = publicRaceSv.notPublished;

/**
 * Det besökaren ser på en publik adress till en tävling som inte är publicerad, är dold eller inte finns
 * (ADR-0172 beslut 4). Aldrig tävlingens namn. Används av sidornas not-found (status 404).
 */
export function RaceNotPublished({ title = text.title, help = text.help }: { title?: string; help?: string }) {
  return <main className={styles.notPublished}>
    <h1>{title}</h1>
    <p>{help}</p>
    <p className={styles.muted}>{text.organizer}</p>
    <p className={styles.notPublishedLinks}><Link href="/">{text.home}</Link><Link href="/organizer">{publicRaceSv.home.myRaces}</Link></p>
  </main>;
}
