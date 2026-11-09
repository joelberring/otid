import { mapLinkSv } from "../../../i18n/map-link-sv";
import { mapLinkEn } from "../../../i18n/course-setting-link-en";
import { currentLanguage } from "../../../lib/language-server";
import styles from "../../../components/map-link/map-link-page.module.css";

/** ADR-0214: samma besked för en ogiltig, avstängd, utgången eller okänd länk. */
export default async function NotFound() {
  const text = await currentLanguage() === "en" ? mapLinkEn : mapLinkSv;
  return <main className={styles.page}><section className={styles.invalid}>
    <h1>{text.page.invalidTitle}</h1><p role="alert">{text.page.invalid}</p></section></main>;
}
