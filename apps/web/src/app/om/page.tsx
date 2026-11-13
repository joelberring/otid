import type { Metadata } from "next";
import Link from "next/link";
import { aboutSv } from "../../i18n/about-sv";
import { aboutEn } from "../../i18n/public-en";
import { currentLanguage } from "../../lib/language-server";
import { PROGRAM_CONTACT_EMAIL } from "../../lib/contact";
import { introFilmUrl } from "../../lib/intro-film";
import styles from "../../components/account-pages.module.css";

/** Ägaren 2026-11-13: «appen är gratis att använda men jag tar gärna emot bidrag till servern». Swish och GitHub Sponsors. */
const SPONSORS_URL = "https://github.com/sponsors/joelberring";

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? aboutEn : aboutSv;
  return { title: `${text.metaTitle} – O-Tid`, description: text.metaDescription };
}

/** Om O-Tid (PLAN.md steg 37): vad det är, beta, hur det är gjort, tekniska funktioner, hur stora tävlingar (steg 54), stöd till servern och kontakt. Utan inloggning. */
export default async function AboutPage() {
  const english = await currentLanguage() === "en";
  const text = english ? aboutEn : aboutSv;
  // Introfilmen bara när NEXT_PUBLIC_INTRO_FILM_URL är satt (läses vid förfrågan, docs/drift.md).
  const film = introFilmUrl();
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div></header>
    <div className={styles.prose}>
      <p>{text.intro}</p>
      <p>{text.introMore}</p>
      {film && <p><a href={film}>{text.film}</a></p>}
      <h2>{text.betaTitle}</h2>
      <p>{text.beta}</p>
      <h2>{text.madeTitle}</h2>
      <p>{text.made}</p>
      <h2>{text.featuresTitle}</h2>
      <ul className={styles.list}>{text.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
      <h2>{text.capacityTitle}</h2>
      {text.capacity.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      <h2 id="stod">{text.supportTitle}</h2>
      <p>{text.support}</p>
      <p>{text.supportSwish} <strong>{text.swishNumber}</strong>, <a href={SPONSORS_URL}>{text.supportGithub}</a>. {text.supportThanks}</p>
      <h2>{text.contactTitle}</h2>
      <p>{text.contact} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a>.</p>
      {english && <>
        <h2>{aboutEn.internationalTitle}</h2>
        {aboutEn.international.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        <p>{aboutEn.internationalSuggest} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a>.</p>
      </>}
      <h2>{text.clubTitle}</h2>
      <p>{text.club}</p>
      <p><Link href="/organizer">{text.clubLink}</Link></p>
      <p><Link href="/integritet">{text.privacyLink}</Link></p>
    </div>
  </main>;
}
