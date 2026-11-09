import { raceInfoSv } from "../i18n/race-info-sv";
import { raceInfoViewEn } from "../i18n/public-en";
import type { Language } from "../lib/language";
import styles from "./race-info.module.css";

/**
 * Steg 33: kort info om tävlingen och första start (bara information, inte tävlingsklockan). Visas överst på
 * tävlingssidan och i arbetsytans Start-steg. Texten är ren text: React escapar den och radbrytningar bevaras med CSS.
 * Tomma fält visas inte; utan båda visas ingenting.
 */
export function RaceInfo({ info, firstStartTime, heading = "h2", language = "sv" }: { info: string | null | undefined;
  firstStartTime: string | null | undefined; heading?: "h2" | "h3"; language?: Language }) {
  if (!info && !firstStartTime) return null;
  const text = { view: language === "en" ? raceInfoViewEn : raceInfoSv.view };
  const Heading = heading;
  return <section className={styles.info} aria-label={text.view.title} data-testid="race-info">
    <Heading>{text.view.title}</Heading>
    {firstStartTime && <p className={styles.firstStart}>{text.view.firstStart} <time>{firstStartTime}</time></p>}
    {info && <p className={styles.text}>{info}</p>}
  </section>;
}
