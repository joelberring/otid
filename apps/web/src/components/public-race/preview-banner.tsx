import { publicRaceSv } from "../../i18n/public-race-sv";
import { publicPagesEn } from "../../i18n/public-en";
import type { Language } from "../../lib/language";
import styles from "./public-race.module.css";


/**
 * ADR-0172 beslut 4: en opublicerad tävling som ägare, administratör eller funktionär ser. Bannern sägs i ord
 * (inte bara färg) och skrivs aldrig ut.
 */
export function PreviewBanner({ access, language = "sv" }: { access: "PUBLIC" | "PREVIEW"; language?: Language }) {
  if (access !== "PREVIEW") return null;
  const text = language === "en" ? { banner: publicPagesEn.previewBanner, help: publicPagesEn.previewHelp } : publicRaceSv.preview;
  return <div className={styles.preview} role="note" data-preview-banner>
    <strong>{text.banner}</strong>
    <span>{text.help}</span>
  </div>;
}
