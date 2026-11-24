import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { authenticateUserAccountSession, listHomeNews, listMapProjects, listMyClubs, listMyGroups, listPublicRaces, PUBLIC_RECENT_MAX, PUBLIC_RECENT_STEP
} from "@o-tid/application";
import { db } from "../lib/db";
import { accountSessionToken } from "../lib/public-race-gate";
import { todayIn } from "../lib/public-race-format";
import { demoRacePath, introFilmUrl, mapFilmUrl } from "../lib/intro-film";
import { guestDemoEnabled } from "../lib/guest-demo-route-handlers";
import { currentLanguage } from "../lib/language-server";
import { publicHomeEn, siteEn } from "../i18n/public-en";
import { sv } from "../i18n/sv";
import { publicRaceSv } from "../i18n/public-race-sv";
import { Logo } from "../components/brand/logo";
import { LanguageSwitch } from "../components/language-switch";
import { SiteFooter } from "../components/about/site-footer";
import { ARTIST_PORTFOLIO_URL, paintingOfTheWeek } from "../lib/weekly-painting";
import { HomePersonal, HomeTry, JoinCode, OrganizerStart, type Personal } from "../components/home/home-sections";
import { HomeFilms, HomeNews } from "../components/home/home-news";
import { HomeSlideshow } from "../components/home/home-slideshow";
import { newsEn } from "../i18n/news-en";
import { newsSv } from "../i18n/news-sv";
import start from "../components/home/start.module.css";
import { AppMark } from "../components/home/app-mark";
import { joinCodeProblem } from "../lib/join-code";
import { countVisit } from "../lib/visitor-tracking";
import { RaceList, type RaceListTiming } from "../components/public-race/race-list";
import styles from "../components/public-race/public-race.module.css";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const english = await currentLanguage() === "en";
  const tagline = english ? siteEn.tagline : sv.tagline;
  return { title: `${sv.appName} – ${tagline}`, description: `${tagline}. ${(english ? publicHomeEn : publicRaceSv.home).intro}` };
}

type Query = { q?: string | string[]; fler?: string | string[]; demo?: string | string[]; kodfel?: string | string[] };

/** Genomförda: så många först (skissen F3: de senaste), sedan tio till per "Visa fler genomförda". */
const RECENT_FIRST = 8;

/**
 * Startsidan för besökare (ADR-0172 beslut 4, skissen F3 2026-11-21). Överst rubriken, ingressen, sökningen (sidans enda
 * mörka knapp), "Skapa konto eller logga in" för den som inte är inloggad och "Har du en kod?" bara i appen (översynen 2026-11-17,
 * `/kod`); till höger bildspelet ur programmet för den som inte är inloggad (ägaren 2026-11-24) och veckans målning hel med
 * bildtext och länk till konstnären för den inloggade (ägarens önskemål 2026-11-12 och 2026-11-24). Under det brett
 * till vänster Pågår nu (tävlingsdagen i tävlingens tidszon), Kommande och Genomförda – ett tomt avsnitt visas inte – och för
 * den inloggade "Ditt O-Tid"; smalt till höger Nytt i O-Tid (ADR-0230), filmerna och demon. På smal skärm i ordningen sökningen,
 * Pågår nu, Kommande, Genomförda, bildspelet eller målningen, Nytt och filmerna. Bara publicerade tävlingar och inga adminlänkar.
 * Filmlänkarna bara när `NEXT_PUBLIC_INTRO_FILM_URL` respektive `NEXT_PUBLIC_MAP_FILM_URL` är satt (docs/drift.md).
 * Sidan renderas vid varje förfrågan (`force-dynamic`), så målningen byts när veckan byts.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const language = await currentLanguage();
  const text = language === "en" ? publicHomeEn : publicRaceSv.home;
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const requested = typeof query.fler === "string" ? Number.parseInt(query.fler, 10) : NaN;
  const recentLimit = Number.isFinite(requested) ? Math.min(Math.max(requested, RECENT_FIRST), PUBLIC_RECENT_MAX) : RECENT_FIRST;
  const token = await accountSessionToken();
  // Besöksstatistiken (ägaren 2026-11-22): besökare utan inloggning, räknas efter svaret.
  if (!token) countVisit("HOME", await headers());
  const [listing, account, news] = await Promise.all([listPublicRaces(db, { search, recentLimit }),
    token ? authenticateUserAccountSession(db, { sessionToken: token }) : undefined, homeNewsFor(token)]);
  const signedIn = account?.status === "authenticated";
  const personal = signedIn && token ? await personalFor(token) : undefined;
  const film = introFilmUrl(process.env, language), mapFilm = mapFilmUrl(process.env, language);
  const today = todayIn("Europe/Stockholm");
  const painting = signedIn ? paintingOfTheWeek(new Date()) : undefined;
  const total = listing.ongoing.length + listing.upcoming.length + listing.recent.length;
  const moreHref = `/?${new URLSearchParams({ ...(search ? { q: search } : {}), fler: String(recentLimit + PUBLIC_RECENT_STEP) })}#senaste`;
  const section = (id: string, title: string, races: typeof listing.ongoing, timing: RaceListTiming, more?: boolean) =>
    races.length === 0 ? null : <section className={styles.raceSection} aria-labelledby={`${id}-rubrik`} id={id}>
      <h2 id={`${id}-rubrik`}>{title}</h2>
      <RaceList races={races} timing={timing} today={today} language={language} />
      {more && <Link className={styles.more} href={moreHref}>{text.showMore}</Link>}
    </section>;
  const guest = guestDemoEnabled() && !signedIn ? { message: query.demo === "upptaget" ? "busy" as const : query.demo === "fel" ? "failed" as const : undefined }
    : undefined;
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
    <main className={start.page} suppressHydrationWarning>
      <AppMark nonce={(await headers()).get("x-nonce") ?? undefined} />
      <div className={start.lead}>
        <h1>{text.title}</h1>
        <p className={start.intro}>{text.intro}</p>
        <JoinCode language={language} problem={joinCodeProblem(query.kodfel)} />
        <form className={start.search} role="search" action="/" method="get">
          <label>{text.searchLabel}<input type="search" name="q" defaultValue={search} placeholder={text.searchPlaceholder} maxLength={100}
            autoComplete="off" /></label>
          <button type="submit">{text.search}</button>
        </form>
        {!signedIn && <OrganizerStart language={language} film={film} />}
      </div>
      {painting ? <figure className={start.painting}>
        <img src={painting.src} width={painting.width} height={painting.height} alt={text.paintingAlt(painting.title)} loading="eager"
          decoding="async" data-testid="home-painting" />
        <figcaption>{text.paintingCaption} · <a href={ARTIST_PORTFOLIO_URL}>Emm Berring</a></figcaption>
      </figure> : <HomeSlideshow language={language} />}
      <div className={start.races}>
        {search && <div className={styles.searchMeta}>
          <p role="status">{total === 0 ? text.noMatch(search) : text.searchHeading(search)}</p>
          <Link href="/">{text.showAll}</Link>
        </div>}
        {section("pagar", text.ongoing, listing.ongoing, "ONGOING")}
        {section("kommande", text.upcoming, listing.upcoming, "UPCOMING")}
        {section("senaste", text.recent, listing.recent, "RECENT", listing.moreRecent)}
        {!search && total === 0 && <p className={start.none}>{text.noneAtAll}</p>}
        {personal && !search && <HomePersonal personal={personal} language={language} />}
      </div>
      <aside className={start.side} aria-label={language === "en" ? newsEn.title : newsSv.title}>
        <HomeNews items={news} language={language} />
        <HomeFilms film={film} mapFilm={mapFilm} labels={{ intro: text.introFilm, map: text.mapFilm }} language={language} />
        {!search && <HomeTry language={language} demo={demoRacePath()} guest={guest} />}
      </aside>
    </main>
    <SiteFooter language={language} home painting={painting} />
  </>;
}

/** ADR-0230: nyheterna i högerspalten; ett fel ger en tom spalt i stället för ett sidfel. */
async function homeNewsFor(sessionToken: string | null) {
  return listHomeNews(db, sessionToken).catch((error: unknown) => { console.error("Startsidans nyheter kunde inte läsas", error); return []; });
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
