import type { Metadata } from "next";
import Link from "next/link";
import { authenticateUserAccountSession, listPublicRaces, PUBLIC_RECENT_MAX, PUBLIC_RECENT_STEP } from "@o-tid/application";
import { db } from "../lib/db";
import { accountSessionToken } from "../lib/public-race-gate";
import { todayIn } from "../lib/public-race-format";
import { sv } from "../i18n/sv";
import { publicRaceSv } from "../i18n/public-race-sv";
import { RaceList, type RaceListTiming } from "../components/public-race/race-list";
import styles from "../components/public-race/public-race.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${sv.appName} – ${publicRaceSv.home.title}`, description: publicRaceSv.home.intro };

const text = publicRaceSv.home;
type Query = { q?: string | string[]; fler?: string | string[] };

/**
 * Startsidan för besökare (ADR-0172 beslut 4): sök, Pågår nu (tävlingsdagen i tävlingens tidszon), Kommande och
 * Senaste med "Visa fler". Bara publicerade tävlingar och inga adminlänkar; den inloggade får en länk till Mina tävlingar.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const requested = typeof query.fler === "string" ? Number.parseInt(query.fler, 10) : NaN;
  const recentLimit = Number.isFinite(requested) ? Math.min(Math.max(requested, PUBLIC_RECENT_STEP), PUBLIC_RECENT_MAX) : PUBLIC_RECENT_STEP;
  const token = await accountSessionToken();
  const [listing, account] = await Promise.all([listPublicRaces(db, { search, recentLimit }),
    token ? authenticateUserAccountSession(db, { sessionToken: token }) : undefined]);
  const signedIn = account?.status === "authenticated";
  const today = todayIn("Europe/Stockholm");
  const total = listing.ongoing.length + listing.upcoming.length + listing.recent.length;
  const moreHref = `/?${new URLSearchParams({ ...(search ? { q: search } : {}), fler: String(recentLimit + PUBLIC_RECENT_STEP) })}#senaste`;
  const section = (id: string, title: string, races: typeof listing.ongoing, timing: RaceListTiming, empty: string, more?: boolean) =>
    search && races.length === 0 ? null : <section className={styles.raceSection} aria-labelledby={`${id}-rubrik`} id={id}>
      <h2 id={`${id}-rubrik`}>{title}</h2>
      {races.length > 0 ? <RaceList races={races} timing={timing} today={today} /> : <p className={styles.empty}>{empty}</p>}
      {more && <Link className={styles.more} href={moreHref}>{text.showMore}</Link>}
    </section>;
  return <>
    <header className={styles.siteHead} data-site-head>
      <div className={styles.siteHeadInner}>
        <Link href="/" className={styles.brand}><strong>{sv.appName}</strong><span>{sv.tagline}</span></Link>
        <nav aria-label={text.accountNavigation}>
          <Link href="/organizer">{signedIn ? text.myRaces : text.organizerLogin}</Link>
        </nav>
      </div>
    </header>
    <main className={styles.home}>
      <div className={styles.homeIntro}>
        <h1>{text.title}</h1>
        <p>{text.intro}</p>
      </div>
      <form className={styles.search} role="search" action="/" method="get">
        <label>{text.searchLabel}<input type="search" name="q" defaultValue={search} placeholder={text.searchPlaceholder} maxLength={100}
          autoComplete="off" /></label>
        <button type="submit">{text.search}</button>
      </form>
      {search && <div className={styles.searchMeta}>
        <p role="status">{total === 0 ? text.noMatch(search) : text.searchHeading(search)}</p>
        <Link href="/">{text.showAll}</Link>
      </div>}
      {section("pagar", text.ongoing, listing.ongoing, "ONGOING", text.noneOngoing)}
      {section("kommande", text.upcoming, listing.upcoming, "UPCOMING", text.noneUpcoming)}
      {section("senaste", text.recent, listing.recent, "RECENT", text.noneRecent, listing.moreRecent)}
    </main>
  </>;
}
