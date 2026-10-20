import { raceInfoSv as text } from "../i18n/race-info-sv";
import styles from "./race-info.module.css";

/**
 * Steg 33: kort info om tävlingen och första start (bara information, inte tävlingsklockan). Visas överst på
 * tävlingssidan och i arbetsytans Start-steg. Texten är ren text: React escapar den och radbrytningar bevaras med CSS.
 * Tomma fält visas inte; utan båda visas ingenting.
 */
export function RaceInfo({ info, firstStartTime, heading = "h2" }: { info: string | null | undefined;
  firstStartTime: string | null | undefined; heading?: "h2" | "h3" }) {
  if (!info && !firstStartTime) return null;
  const Heading = heading;
  return <section className={styles.info} aria-label={text.view.title} data-testid="race-info">
    <Heading>{text.view.title}</Heading>
    {firstStartTime && <p className={styles.firstStart}>{text.view.firstStart} <time>{firstStartTime}</time></p>}
    {info && <p className={styles.text}>{info}</p>}
  </section>;
}
