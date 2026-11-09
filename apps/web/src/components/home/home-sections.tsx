import { guestDemoHomeEn, guestDemoHomeSv } from "../../i18n/guest-demo";
import Link from "next/link";
import type { GroupSummary, MapProjectSummary } from "@o-tid/contracts";
import { homeSv } from "../../i18n/home-sv";
import { homeEn } from "../../i18n/public-en";
import type { Language } from "../../lib/language";
import { SOURCE_CODE_URL } from "../../lib/contact";
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

/** Vad O-Tid gör utöver tidtagning, hur det är byggt och var koden finns. */
export function HomeAbout({ language, demo, guest }: { language: Language; demo?: string | undefined;
  /** Demoläget del 2: "Prova arbetsytan" (bara utan inloggning och med `OTID_GUEST_DEMO=1`) och beskedet efter ett försök. */
  guest?: { message?: "busy" | "failed" | undefined } | undefined }) {
  const text = texts(language);
  const guestText = language === "en" ? guestDemoHomeEn : guestDemoHomeSv;
  return <>
    {demo && <p className={styles.demo} data-testid="home-demo"><Link href={demo}>{text.demo}</Link> <span>{text.demoHelp}</span></p>}
    {guest && <form className={styles.demo} action="/api/demo/guest" method="post" data-testid="home-guest-demo">
      {guest.message && <p role="alert" className={styles.demoProblem}>{guest.message === "busy" ? guestText.busy : guestText.failed}</p>}
      <button type="submit">{guestText.button}</button> <span>{guestText.explanation}</span>
    </form>}
    <section className={styles.features} aria-labelledby="home-features" data-testid="home-features">
      <h2 id="home-features">{text.featuresTitle}</h2>
      <ul className={styles.featureGrid}>
        {text.features.map(feature => <li key={feature.title}><strong>{feature.title}</strong><span>{feature.text}</span></li>)}
      </ul>
    </section>
    <section className={styles.built} aria-labelledby="home-built">
      <h2 id="home-built">{text.builtTitle}</h2>
      <p>{text.built} {text.code}</p>
      <p className={styles.builtLinks}><a href={SOURCE_CODE_URL} rel="noopener">{text.codeLink}</a><Link href="/om">{text.about}</Link></p>
    </section>
  </>;
}
