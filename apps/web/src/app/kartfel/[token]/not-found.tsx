import { mapLinkSv } from "../../../i18n/map-link-sv";
import styles from "../../../components/map-link/map-link-page.module.css";

/** ADR-0214: samma besked för en ogiltig, avstängd, utgången eller okänd länk. */
export default function NotFound() {
  return <main className={styles.page}><section className={styles.invalid}>
    <h1>{mapLinkSv.page.invalidTitle}</h1><p role="alert">{mapLinkSv.page.invalid}</p></section></main>;
}
