import type { Metadata } from "next";
import Link from "next/link";
import { aboutSv as text } from "../../i18n/about-sv";
import { PROGRAM_CONTACT_EMAIL } from "../../lib/contact";
import styles from "../../components/account-pages.module.css";

export const metadata: Metadata = { title: `${text.metaTitle} – O-Tid`, description: text.metaDescription };

/** Om O-Tid (PLAN.md steg 37): vad det är, beta, hur det är gjort, tekniska funktioner, hur stora tävlingar (steg 54) och kontakt. Utan inloggning. */
export default function AboutPage() {
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div></header>
    <div className={styles.prose}>
      <p>{text.intro}</p>
      <p>{text.introMore}</p>
      <h2>{text.betaTitle}</h2>
      <p>{text.beta}</p>
      <h2>{text.madeTitle}</h2>
      <p>{text.made}</p>
      <h2>{text.featuresTitle}</h2>
      <ul className={styles.list}>{text.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
      <h2>{text.capacityTitle}</h2>
      {text.capacity.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      <h2>{text.contactTitle}</h2>
      <p>{text.contact} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a>.</p>
      <h2>{text.clubTitle}</h2>
      <p>{text.club}</p>
      <p><Link href="/organizer">{text.clubLink}</Link></p>
      <p><Link href="/integritet">{text.privacyLink}</Link></p>
    </div>
  </main>;
}
