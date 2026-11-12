import type { Metadata } from "next";
import Link from "next/link";
import { authenticateUserAccountSession, listMapProjects, listMyClubs, listMyGroups, listPublicRaces, PUBLIC_RECENT_MAX, PUBLIC_RECENT_STEP
} from "@o-tid/application";
import { db } from "../lib/db";
import { accountSessionToken } from "../lib/public-race-gate";
import { todayIn } from "../lib/public-race-format";
import { demoRacePath, introFilmUrl } from "../lib/intro-film";
import { guestDemoEnabled } from "../lib/guest-demo-route-handlers";
import { currentLanguage } from "../lib/language-server";
import { publicHomeEn, siteEn } from "../i18n/public-en";
import { sv } from "../i18n/sv";
import { publicRaceSv } from "../i18n/public-race-sv";
import { Logo } from "../components/brand/logo";
import { LanguageSwitch } from "../components/language-switch";
import { SiteFooter } from "../components/about/site-footer";
import { paintingOfTheWeek } from "../lib/weekly-painting";
import { HomeAbout, HomePersonal, type Personal } from "../components/home/home-sections";
import { RaceList, type RaceListTiming } from "../components/public-race/race-list";
import styles from "../components/public-race/public-race.module.css";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const english = await currentLanguage() === "en";
  const tagline = english ? siteEn.tagline : sv.tagline;
  return { title: `${sv.appName} – ${tagline}`, description: `${tagline}. ${(english ? publicHomeEn : publicRaceSv.home).intro}` };
}

type Query = { q?: string | string[]; fler?: string | string[]; demo?: string | string[] };

/**
 * Startsidan för besökare (ADR-0172 beslut 4): sök, Pågår nu (tävlingsdagen i tävlingens tidszon), Kommande och
 * Senaste med "Visa fler". Bara publicerade tävlingar och inga adminlänkar; den inloggade får en länk till Mina tävlingar.
 * Längst ned en länk till introduktionsfilmen, bara när `NEXT_PUBLIC_INTRO_FILM_URL` är satt (docs/drift.md).
 * Veckans målning (ägarens önskemål 2026-11-12) står bredvid rubriken och sökrutan, och texten om den i startsidans egen sidfot.
 * Sidan renderas vid varje förfrågan (`force-dynamic`), så målningen byts när veckan byts.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const language = await currentLanguage();
  const text = language === "en" ? publicHomeEn : publicRaceSv.home;
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const requested = typeof query.fler === "string" ? Number.parseInt(query.fler, 10) : NaN;
  const recentLimit = Number.isFinite(requested) ? Math.min(Math.max(requested, PUBLIC_RECENT_STEP), PUBLIC_RECENT_MAX) : PUBLIC_RECENT_STEP;
  const token = await accountSessionToken();
  const [listing, account] = await Promise.all([listPublicRaces(db, { search, recentLimit }),
    token ? authenticateUserAccountSession(db, { sessionToken: token }) : undefined]);
  const signedIn = account?.status === "authenticated";
  const personal = signedIn && token ? await personalFor(token) : undefined;
  const film = introFilmUrl();
  const today = todayIn("Europe/Stockholm");
  const painting = paintingOfTheWeek(new Date());
  const total = listing.ongoing.length + listing.upcoming.length + listing.recent.length;
  const moreHref = `/?${new URLSearchParams({ ...(search ? { q: search } : {}), fler: String(recentLimit + PUBLIC_RECENT_STEP) })}#senaste`;
  const section = (id: string, title: string, races: typeof listing.ongoing, timing: RaceListTiming, empty: string, more?: boolean) =>
    search && races.length === 0 ? null : <section className={styles.raceSection} aria-labelledby={`${id}-rubrik`} id={id}>
      <h2 id={`${id}-rubrik`}>{title}</h2>
      {races.length > 0 ? <RaceList races={races} timing={timing} today={today} language={language} /> : <p className={styles.empty}>{empty}</p>}
      {more && <Link className={styles.more} href={moreHref}>{text.showMore}</Link>}
    </section>;
  return <>
    <header className={styles.siteHead} data-site-head>
      <div className={styles.siteHeadInner}>
        <Link href="/" className={styles.brand}>
          <Logo size={40} className={styles.brandLogo} />
          <span className={styles.brandText}><strong>{sv.appName}</strong><span>{language === "en" ? siteEn.tagline : sv.tagline}</span></span>
        </Link>
        <nav aria-label={text.accountNavigation}>
          <LanguageSwitch language={language} />
          <Link href="/organizer">{signedIn ? text.myRaces : text.organizerLogin}</Link>
        </nav>
      </div>
    </header>
    <main className={styles.home}>
      <div className={styles.homeTop}>
        <div className={styles.homeLead}>
          <div className={styles.homeIntro}>
            <h1>{text.title}</h1>
            <p>{text.intro}</p>
          </div>
          <form className={styles.search} role="search" action="/" method="get">
            <label>{text.searchLabel}<input type="search" name="q" defaultValue={search} placeholder={text.searchPlaceholder} maxLength={100}
              autoComplete="off" /></label>
            <button type="submit">{text.search}</button>
          </form>
        </div>
        <img className={styles.homePainting} src={painting.src} width={painting.width} height={painting.height}
          alt={text.paintingAlt(painting.title)} loading="eager" decoding="async" data-testid="home-painting" />
      </div>
      {search && <div className={styles.searchMeta}>
        <p role="status">{total === 0 ? text.noMatch(search) : text.searchHeading(search)}</p>
        <Link href="/">{text.showAll}</Link>
      </div>}
      {personal && !search && <HomePersonal personal={personal} language={language} />}
      {section("pagar", text.ongoing, listing.ongoing, "ONGOING", text.noneOngoing)}
      {section("kommande", text.upcoming, listing.upcoming, "UPCOMING", text.noneUpcoming)}
      {section("senaste", text.recent, listing.recent, "RECENT", text.noneRecent, listing.moreRecent)}
      {film && <p className={styles.introFilm}><a href={film}>{text.introFilm}</a></p>}
      {!search && <HomeAbout language={language} demo={demoRacePath()}
        guest={guestDemoEnabled() && !signedIn ? { message: query.demo === "upptaget" ? "busy" : query.demo === "fel" ? "failed" : undefined }
          : undefined} />}
    </main>
    <SiteFooter language={language} painting={painting} />
  </>;
}

/** Den inloggades klubbar, träningsgrupper och kartprojekt (bara namnen); ett fel ger en tom del i stället för ett sidfel. */
async function personalFor(sessionToken: string): Promise<Personal> {
  const proof = { sessionToken };
  const logged = <T,>(promise: Promise<T>) => promise.catch((error: unknown) => { console.error("Startsidans egna delar kunde inte läsas", error); return undefined; });
  const [clubs, groups, projects] = await Promise.all([logged(listMyClubs(db, proof)), logged(listMyGroups(db, proof)), logged(listMapProjects(db, proof))]);
  return {
    clubs: clubs?.status === "ok" ? clubs.clubs : [],
    groups: groups?.status === "ok" ? groups.groups : [],
    projects: projects?.status === "ok" ? projects.list.projects.filter(project => project.status === "OPEN") : []
  };
}
