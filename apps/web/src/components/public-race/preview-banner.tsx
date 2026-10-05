import { publicRaceSv } from "../../i18n/public-race-sv";
import styles from "./public-race.module.css";

const text = publicRaceSv.preview;

/**
 * ADR-0172 beslut 4: en opublicerad tävling som ägare, administratör eller funktionär ser. Bannern sägs i ord
 * (inte bara färg) och skrivs aldrig ut.
 */
export function PreviewBanner({ access }: { access: "PUBLIC" | "PREVIEW" }) {
  if (access !== "PREVIEW") return null;
  return <div className={styles.preview} role="note" data-preview-banner>
    <strong>{text.banner}</strong>
    <span>{text.help}</span>
  </div>;
}
