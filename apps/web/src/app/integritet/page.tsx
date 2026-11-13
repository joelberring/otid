import type { Metadata } from "next";
import { accountSv } from "../../i18n/account-sv";
import { privacyEn } from "../../i18n/privacy-en";
import { currentLanguage } from "../../lib/language-server";
import { retentionSettings } from "@o-tid/application";
import { operatorContactEmail } from "../../lib/operator-contact";
import styles from "../../components/account-pages.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await currentLanguage() === "en" ? privacyEn.title : accountSv.privacy.title} – O-Tid` };
}
// Kontaktadressen (OTID_CONTACT_EMAIL, standard otid@berring.se) och gallringen (OTID_RETENTION, ADR-0189) läses ur serverns
// miljö vid varje visning.
export const dynamic = "force-dynamic";

/** Kort text om personuppgifter (ADR-0172, PLAN.md steg 17). */
export default async function PrivacyPage() {
  const text = await currentLanguage() === "en" ? privacyEn : accountSv.privacy;
  const contact = operatorContactEmail();
  const retention = retentionSettings(process.env);
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>O-Tid</p><h1>{text.title}</h1></div></header>
    <div className={styles.prose}>
      <p>{text.intro}</p>
      <h2>{text.whatTitle}</h2>
      <ul className={styles.list}><li>{text.accounts}</li><li>{text.races}</li><li>{text.runners}</li><li>{text.groups}</li><li>{text.clubs}</li>
        <li>{text.courseSetting}</li><li>{text.mapLink}</li><li>{text.mapProjects}</li><li>{text.printJobs}</li><li>{text.party}</li><li>{text.selfRegistration}</li><li>{text.logs}</li>
        <li>{text.backup}</li></ul>
      <h2>{text.whyTitle}</h2>
      <p>{text.why}</p>
      <h2>{text.howLongTitle}</h2>
      <p>{text.howLong}</p>
      <p>{text.retention(retention.mode, retention.months)}</p>
      <h2>{text.oneRunnerTitle}</h2>
      <p>{text.oneRunner}</p>
      <h2>{text.publicTitle}</h2>
      <p>{text.public}</p>
      <ul className={styles.list}>{text.publicItems.map(item => <li key={item}>{item}</li>)}</ul>
      <p>{text.runnersPublic}</p>
      <h2>{text.organizerCopyTitle}</h2>
      <p>{text.organizerCopy}</p>
      <h2>{text.responsibleTitle}</h2>
      <p>{text.responsible}</p>
      <h2>{text.contactTitle}</h2>
      <p>{text.contact} <a href={`mailto:${contact}`}>{contact}</a></p>
    </div>
  </main>;
}
