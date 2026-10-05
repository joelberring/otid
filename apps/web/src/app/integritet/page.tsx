import type { Metadata } from "next";
import { accountSv } from "../../i18n/account-sv";
import { operatorContactEmail } from "../../lib/operator-contact";
import styles from "../../components/account-pages.module.css";

export const metadata: Metadata = { title: "Personuppgifter – O-Tid" };
// Kontaktadressen läses ur serverns miljö (OTID_CONTACT_EMAIL) vid varje visning.
export const dynamic = "force-dynamic";

const text = accountSv.privacy;

/** Kort text om personuppgifter (ADR-0172, PLAN.md steg 17). */
export default function PrivacyPage() {
  const contact = operatorContactEmail();
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>O-Tid</p><h1>{text.title}</h1></div></header>
    <div className={styles.prose}>
      <p>{text.intro}</p>
      <h2>{text.whatTitle}</h2>
      <ul className={styles.list}><li>{text.accounts}</li><li>{text.races}</li><li>{text.logs}</li></ul>
      <h2>{text.whyTitle}</h2>
      <p>{text.why}</p>
      <h2>{text.howLongTitle}</h2>
      <p>{text.howLong}</p>
      <h2>{text.publicTitle}</h2>
      <p>{text.public}</p>
      <h2>{text.contactTitle}</h2>
      {contact ? <p>{text.contact} <a href={`mailto:${contact}`}>{contact}</a></p> : <p>{text.noContact}</p>}
    </div>
  </main>;
}
