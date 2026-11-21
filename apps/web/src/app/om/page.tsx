import type { Metadata } from "next";
import Link from "next/link";
import { aboutSv } from "../../i18n/about-sv";
import { aboutEn } from "../../i18n/public-en";
import { currentLanguage } from "../../lib/language-server";
import { PROGRAM_CONTACT_EMAIL, SOURCE_CODE_URL } from "../../lib/contact";
import { introFilmUrl, mapFilmUrl } from "../../lib/intro-film";
import styles from "../../components/account-pages.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const text = await currentLanguage() === "en" ? aboutEn : aboutSv;
  return { title: `${text.metaTitle} – O-Tid`, description: text.metaDescription };
}

/** Om O-Tid (PLAN.md steg 37): vad det är, beta, hur det är gjort, tekniska funktioner, hur stora tävlingar (steg 54), stöd till servern (Swish; GitHub Sponsors öppnas senare) och kontakt. Utan inloggning. */
export default async function AboutPage() {
  const english = await currentLanguage() === "en";
  const text = english ? aboutEn : aboutSv;
  // Filmerna bara när NEXT_PUBLIC_INTRO_FILM_URL och NEXT_PUBLIC_MAP_FILM_URL är satta (läses vid förfrågan, docs/drift.md).
  const language = english ? "en" : "sv";
  const film = introFilmUrl(process.env, language), mapFilm = mapFilmUrl(process.env, language);
  return <main className={`${styles.page} ${styles.narrow}`}>
    <header className={styles.header}><div><p className={styles.kicker}>{text.kicker}</p><h1>{text.title}</h1></div></header>
    <div className={styles.prose}>
      <p>{text.intro}</p>
      <p>{text.introMore}</p>
      {film && <p className={styles.linkLine}><a href={film}>{text.film}</a></p>}
      {mapFilm && <p className={styles.linkLine}><a href={mapFilm}>{text.mapFilm}</a></p>}
      <h2>{text.betaTitle}</h2>
      <p>{text.beta}</p>
      <h2>{text.nextTitle}</h2>
      <ul className={styles.list}>{text.next.map(item => <li key={item}>{item}</li>)}</ul>
      <h2>{text.madeTitle}</h2>
      <p>{text.made}</p>
      <p>{text.code} <a href={SOURCE_CODE_URL} rel="noopener">{text.codeLink}</a></p>
      <h2>{text.featuresTitle}</h2>
      <ul className={styles.list}>{text.features.map(feature => <li key={feature}>{feature}</li>)}</ul>
      <h2>{text.capacityTitle}</h2>
      {text.capacity.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      <h2 id="stod">{text.supportTitle}</h2>
      <p>{text.support}</p>
      <p>{text.supportSwish} <strong>{text.swishNumber}</strong>. {text.supportThanks}</p>
      <p>{text.supportAbroad} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a>.</p>
      <h2>{text.contactTitle}</h2>
      <p>{text.contact} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a>.</p>
      {english && <>
        <h2>{aboutEn.internationalTitle}</h2>
        {aboutEn.international.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        <p>{aboutEn.internationalSuggest} <a href={`mailto:${PROGRAM_CONTACT_EMAIL}`}>{PROGRAM_CONTACT_EMAIL}</a>.</p>
      </>}
      <h2>{text.clubTitle}</h2>
      <p>{text.club}</p>
      <p className={styles.linkLine}><Link href="/organizer">{text.clubLink}</Link></p>
      <p className={styles.linkLine}><Link href="/integritet">{text.privacyLink}</Link></p>
    </div>
  </main>;
}
