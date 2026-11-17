import { guestDemoHomeEn, guestDemoHomeSv } from "../../i18n/guest-demo";
import Link from "next/link";
import type { GroupSummary, MapProjectSummary } from "@o-tid/contracts";
import { homeSv } from "../../i18n/home-sv";
import { homeEn } from "../../i18n/public-en";
import type { Language } from "../../lib/language";
import type { JoinCodeProblem } from "../../lib/join-code";
import styles from "./home.module.css";

/** Högst så många per grupp på startsidan; resten under Visa alla. */
const SHOWN = 4;
const texts = (language: Language) => language === "en" ? homeEn : homeSv;

interface Item { readonly href: string; readonly name: string }
export interface Personal {
  readonly clubs: readonly { readonly clubId: string; readonly name: string }[];
  readonly groups: readonly Pick<GroupSummary, "groupId" | "name">[];
  readonly projects: readonly Pick<MapProjectSummary, "projectId" | "name">[];
}

function Group({ title, items, all, more }: { title: string; items: readonly Item[]; all: string; more: (count: number) => string }) {
  if (items.length === 0) return null;
  return <section className={styles.personalGroup}>
    <h3>{title}</h3>
    <ul>{items.slice(0, SHOWN).map(item => <li key={item.href}><Link href={item.href}>{item.name}</Link></li>)}</ul>
    {items.length > SHOWN && <Link href={all}>{more(items.length - SHOWN)}</Link>}
  </section>;
}

/** Den inloggades klubbar, grupper och kartprojekt (idéerna 2026-11-08). */
export function HomePersonal({ personal, language }: { personal: Personal; language: Language }) {
  const text = texts(language);
  return <section className={styles.personal} aria-labelledby="home-personal" data-testid="home-personal">
    <h2 id="home-personal">{text.personalTitle}</h2>
    <div className={styles.personalGroups}>
      <section className={styles.personalGroup}><h3>{text.myRaces}</h3><Link href="/organizer">{text.showAll}</Link></section>
      <Group title={text.clubs} items={personal.clubs.map(club => ({ href: `/organizer/clubs/${club.clubId}`, name: club.name }))} all="/organizer"
        more={text.more} />
      <Group title={text.groups} items={personal.groups.map(group => ({ href: `/organizer/groups/${group.groupId}`, name: group.name }))}
        all="/organizer" more={text.more} />
      <Group title={text.projects} items={personal.projects.map(project => ({ href: `/organizer/map-projects/${project.projectId}`, name: project.name }))}
        all="/organizer/map-projects" more={text.more} />
    </div>
  </section>;
}

/**
 * Översynen av startsidan 2026-11-17: "Har du en kod?" överst, men bara i appen (CSS:en, `data-otid-app`) och med ett besked
 * (`problem`) eller `/#kod` också på webben. Formuläret skickas till `/kod` (GET, fungerar utan
 * JavaScript), som leder till tävlingen, festen eller gruppen eller tillbaka hit med beskedet (`problem`). Tangentbordet i
 * mobilen: inga versaler eller rättningar, vanliga tecken (koderna är a–z, 0–9 och bindestreck, och en länk ska gå att klistra in).
 */
export function JoinCode({ language, problem }: { language: Language; problem?: JoinCodeProblem | undefined }) {
  const text = texts(language);
  return <section className={problem ? `${styles.join} ${styles.joinShown}` : styles.join} id="kod" aria-labelledby="kod-rubrik"
    data-testid="home-join">
    <h2 id="kod-rubrik">{text.joinTitle}</h2>
    <p id="kod-hjalp">{text.joinHelp}</p>
    <form action="/kod" method="get" className={styles.joinForm}>
      <label>{text.joinLabel}<input name="kod" type="text" required maxLength={300} placeholder={text.joinPlaceholder} autoComplete="off"
        autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" enterKeyHint="go"
        aria-describedby={problem ? "kod-hjalp kod-besked" : "kod-hjalp"} aria-invalid={problem === "missing" || undefined} /></label>
      <button type="submit">{text.join}</button>
    </form>
    {problem && <p id="kod-besked" role="alert" className={styles.joinProblem}>{problem === "busy" ? text.joinBusy : text.joinMissing}</p>}
  </section>;
}

/** Arrangörens väg (översynen 2026-11-17): en rad under sökningen för den som inte är inloggad; `/organizer` loggar in eller skapar konto. */
export function OrganizerStart({ language }: { language: Language }) {
  const text = texts(language);
  return <p className={styles.organizer} data-testid="home-organizer">
    <span>{text.organizerQuestion}</span> <Link href="/organizer">{text.organizerStart}</Link>
  </p>;
}

/** Vart rutorna under "Mer än tidtagning" leder, i rutornas ordning (texterna i `homeSv.features`). */
type FeatureTarget = "demo" | "organizer" | "mapFilm" | "about";
const FEATURE_TARGETS: readonly FeatureTarget[] = ["demo", "organizer", "organizer", "mapFilm", "about", "organizer"];

/**
 * Vad O-Tid gör utöver tidtagning. Översynen 2026-11-17: rutorna är länkar – tidtagningen till demotävlingen, kartritningen
 * till filmen om den (annars till arrangörens sida), AI-kopplingen till Om O-Tid och resten till arrangörens sida. Hur O-Tid
 * är byggt och länken till koden står på Om O-Tid.
 */
export function HomeAbout({ language, demo, mapFilm, guest }: { language: Language; demo?: string | undefined; mapFilm?: string | undefined;
  /** Demoläget del 2: "Prova arbetsytan" (bara utan inloggning och med `OTID_GUEST_DEMO=1`) och beskedet efter ett försök. */
  guest?: { message?: "busy" | "failed" | undefined } | undefined }) {
  const text = texts(language);
  const guestText = language === "en" ? guestDemoHomeEn : guestDemoHomeSv;
  const href = (target: FeatureTarget | undefined) => target === "demo" ? demo ?? "/organizer" : target === "mapFilm" ? mapFilm ?? "/organizer"
    : target === "about" ? "/om" : "/organizer";
  return <>
    {demo && <p className={styles.demo} data-testid="home-demo"><Link href={demo}>{text.demo}</Link> <span>{text.demoHelp}</span></p>}
    {guest && <form className={styles.demo} action="/api/demo/guest" method="post" data-testid="home-guest-demo">
      {guest.message && <p role="alert" className={styles.demoProblem}>{guest.message === "busy" ? guestText.busy : guestText.failed}</p>}
      <button type="submit">{guestText.button}</button> <span>{guestText.explanation}</span>
    </form>}
    <section className={styles.features} aria-labelledby="home-features" data-testid="home-features">
      <h2 id="home-features">{text.featuresTitle}</h2>
      <ul className={styles.featureGrid}>
        {text.features.map((feature, index) => {
          const target = href(FEATURE_TARGETS[index]);
          const body = <><strong>{feature.title}</strong><span>{feature.text}</span></>;
          return <li key={feature.title}>{target.startsWith("/") ? <Link href={target}>{body}</Link> : <a href={target}>{body}</a>}</li>;
        })}
      </ul>
    </section>
  </>;
}
