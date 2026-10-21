import { aboutSv } from "../../i18n/about-sv";
import { PROGRAM_CONTACT_EMAIL } from "../../lib/contact";
import styles from "./site-footer.module.css";

const text = aboutSv.footer;

/**
 * Den diskreta sidfoten (PLAN.md steg 37): "O-Tid · beta · Frågor: otid@berring.se · Om O-Tid". Publika sidor får
 * den från layouten, arbetsytan längst ned i innehållet (`newTab`: länkarna öppnas i en ny flik så att inget osparat
 * lämnas; där är den ingen landmärkesroll eftersom den ligger i `main`). Döljs vid utskrift. Avläsningssidan har ingen
 * sidfot, bara Hjälp.
 */
export function SiteFooter({ newTab = false, className }: { newTab?: boolean; className?: string | undefined }) {
  const target = newTab ? { target: "_blank", rel: "noopener" } : {};
  return <footer className={`site-footer ${styles.footer}${className ? ` ${className}` : ""}`} aria-label={text.label}>
    <span>{text.name}</span>{" "}
    <span aria-hidden="true">·</span>{" "}
    <span>{text.beta}</span>{" "}
    <span aria-hidden="true">·</span>{" "}
    <span>{text.questions} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a></span>{" "}
    <span aria-hidden="true">·</span>{" "}
    <a href="/om" {...target}>{text.about}</a>{" "}
    <span aria-hidden="true">·</span>{" "}
    <a href="/integritet" {...target}>{text.privacy}</a>
  </footer>;
}
