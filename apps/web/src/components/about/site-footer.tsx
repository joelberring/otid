import { aboutSv } from "../../i18n/about-sv";
import { aboutEn } from "../../i18n/public-en";
import type { Language } from "../../lib/language";
import { PROGRAM_CONTACT_EMAIL } from "../../lib/contact";
import { ARTIST_PORTFOLIO_URL, paintingTechnique, type WeeklyPainting } from "../../lib/weekly-painting";
import styles from "./site-footer.module.css";


/**
 * Den diskreta sidfoten (PLAN.md steg 37): "O-Tid · beta · Frågor: otid@berring.se · Om O-Tid". Publika sidor får
 * den från layouten, arbetsytan längst ned i innehållet (`newTab`: länkarna öppnas i en ny flik så att inget osparat
 * lämnas; där är den ingen landmärkesroll eftersom den ligger i `main`). Döljs vid utskrift. Avläsningssidan har ingen
 * sidfot, bara Hjälp.
 *
 * Startsidan ritar en egen sidfot med veckans målning (`painting`, `lib/weekly-painting.ts`); layoutens döljs då med CSS, på
 * samma sätt som startsidans eget sidhuvud (globals.css). Andra sidor får sidfoten utan målningen.
 */
export function SiteFooter({ newTab = false, className, language = "sv", painting }: { newTab?: boolean; className?: string | undefined;
  language?: Language; painting?: WeeklyPainting }) {
  const text = language === "en" ? aboutEn.footer : aboutSv.footer;
  const target = newTab ? { target: "_blank", rel: "noopener" } : {};
  return <footer className={`site-footer ${styles.footer}${className ? ` ${className}` : ""}`} aria-label={text.label}
    data-home-footer={painting ? "" : undefined}>
    <span>{text.name}</span>{" "}
    <span aria-hidden="true">·</span>{" "}
    <span>{text.beta}</span>{" "}
    <span aria-hidden="true">·</span>{" "}
    <span>{text.questions} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a></span>{" "}
    <span aria-hidden="true">·</span>{" "}
    <a href="/om" {...target}>{text.about}</a>{" "}
    <span aria-hidden="true">·</span>{" "}
    <a href="/integritet" {...target}>{text.privacy}</a>
    {painting && <>{" "}<span aria-hidden="true">·</span>{" "}
      <span data-testid="home-painting-credit">{text.painting} <i>{painting.title}</i> {text.paintingBy} Emm Berring,{" "}
        {paintingTechnique(painting, language)}, {painting.size}, {painting.year}.</span>{" "}
      <a href={ARTIST_PORTFOLIO_URL}>{text.portfolio}</a></>}
  </footer>;
}
