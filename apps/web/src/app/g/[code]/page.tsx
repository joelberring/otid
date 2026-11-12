import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { readGroupPublicView, type GroupPublicResultRead } from "@o-tid/application";
import type { GroupPublicResult, GroupPublicSession } from "@o-tid/contracts";
import { sv } from "../../../i18n/sv";
import { trainingGroupSv } from "../../../i18n/training-group-sv";
import { groupPublicEn } from "../../../i18n/public-en";
import { currentLanguage } from "../../../lib/language-server";
import { LOCALE, type Language } from "../../../lib/language";
import { publicDb } from "../../../lib/db";
import { accountSessionToken } from "../../../lib/public-race-gate";
import { clientAddressFrom } from "../../../lib/security-policy";
import { publicOrigin } from "../../../lib/public-origin";
import { displayAddress, formatRaceDate, raceHubPath } from "../../../lib/public-race-format";
import { formatDuration } from "../../../lib/clock-time";
import { PublicLinkShare } from "../../../components/public-link-share";
import { SelfRegistrationForm } from "../../../components/self-registration/self-registration-form";
import styles from "../../../components/training-group/training-group.module.css";

export const dynamic = "force-dynamic";
const texts = (language: Language) => language === "en" ? groupPublicEn : { ...trainingGroupSv.public, attended: trainingGroupSv.leader.attended,
  points: trainingGroupSv.leader.points };
type Params = { params: Promise<{ code: string }> };

/** Sidan och dess metadata delar en läsning per begäran. */
const load = cache(async (code: string): Promise<GroupPublicResultRead> =>
  readGroupPublicView(publicDb, { code, sessionToken: await accountSessionToken(), clientKey: clientAddressFrom(await headers()) }));

/** Steg 68 (ADR-0182 beslut 7): gruppens sidor indexeras aldrig (robots.txt, X-Robots-Tag och här). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const read = await load((await params).code);
  const text = texts(await currentLanguage());
  const title = read.status === "ok" ? read.view.name : read.status === "login-required" ? read.name
    : read.status === "rate-limited" ? text.rateLimitedTitle : text.notFoundTitle;
  return { title: `${title} – ${sv.appName}`, robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } };
}

function sessionLine(session: GroupPublicSession, language: Language) {
  return [formatRaceDate(session.raceDate, undefined, LOCALE[language]), session.firstStartTime, session.raceName].filter(Boolean).join(" · ");
}

function resultsByClass(results: readonly GroupPublicResult[]) {
  const classes = new Map<string, GroupPublicResult[]>();
  for (const row of results) classes.set(row.className, [...classes.get(row.className) ?? [], row]);
  return [...classes];
}

/**
 * Gruppsidan (ADR-0182 beslut 2): kommande tillfällen, senaste resultat och arkivet, med en fast länk och QR-kod. Namnen
 * visas som gruppen valt; varje tillfälle har kvar sin egen sida (/t/<kod>). Dagens träning har självanmälan när den är
 * påslagen, och telefonen minns förra anmälan till gruppen.
 */
export default async function GroupPage({ params }: Params) {
  const read = await load((await params).code);
  const language = await currentLanguage(), text = texts(language);
  if (read.status === "not-found") notFound();
  // ADR-0189 beslut 8: för många gissade koder från samma adress.
  if (read.status === "rate-limited") return <main className={styles.public}>
    <section><p className={styles.kicker}>{text.kicker}</p><h1>{text.rateLimitedTitle}</h1><p>{text.rateLimited}</p></section>
  </main>;
  if (read.status === "login-required") return <main className={styles.public}>
    <section><p className={styles.kicker}>{text.kicker}</p><h1>{read.name}</h1></section>
    <section aria-labelledby="group-login"><h2 id="group-login">{text.loginTitle}</h2><p>{text.loginHint}</p>
      <Link className={styles.buttonLink} href="/organizer">{text.login}</Link></section>
  </main>;
  const { view } = read;
  const path = `/g/${view.code}`;
  const address = displayAddress(await publicOrigin(), path);
  const sessionLink = (session: GroupPublicSession) => session.shortCode
    ? <Link href={raceHubPath(session.shortCode)}>{text.open}</Link> : null;
  return <main className={styles.public}>
    <section>
      <p className={styles.kicker}>{text.kicker}</p>
      <h1>{view.name}</h1>
      {view.nameDisplay !== "FULL" && <p className={styles.muted}>{view.nameDisplay === "NONE" ? text.namesHidden : text.firstNames}</p>}
    </section>

    {view.today && <section aria-labelledby="group-today">
      <h2 id="group-today">{text.today}: {sessionLine(view.today, language)}</h2>
      <SelfRegistrationForm raceId={view.today.raceId} rememberKey={view.code} names={view.nameDisplay} />
    </section>}

    <section aria-labelledby="group-upcoming">
      <h2 id="group-upcoming">{text.upcoming}</h2>
      {view.upcoming.length === 0 ? <p className={styles.muted}>{text.noUpcoming}</p> : <ul className={styles.sessionList}>
        {view.upcoming.map(session => <li key={session.raceId}><div><strong>{session.eventName}</strong><span>{sessionLine(session, language)}</span></div>
          {sessionLink(session)}</li>)}
      </ul>}
    </section>

    <section aria-labelledby="group-latest">
      <h2 id="group-latest">{text.latest}</h2>
      {!view.latest ? <p className={styles.muted}>{text.noLatest}</p> : <>
        <p><strong>{view.latest.eventName}</strong> · {sessionLine(view.latest, language)}
          {view.latest.shortCode && <> · <Link href={`/results/${view.latest.raceId}`}>{text.results}</Link></>}</p>
        {resultsByClass(view.latest.results).map(([className, rows]) => <div key={className} style={{ overflowX: "auto" }}>
          <h3>{className}</h3>
          <table className={styles.table} data-testid="group-results">
            <thead><tr><th className={styles.num}>{text.place}</th><th>{text.name}</th><th className={styles.num}>{text.time}</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={`${className}-${index}`}>
              <td className={styles.num}>{row.position ?? ""}</td>
              <td>{[row.givenName, row.familyName].filter(Boolean).join(" ")}</td>
              <td className={styles.num}>{row.status === "OK" && row.elapsedMs !== null ? formatDuration(row.elapsedMs) : text.status[row.status] ?? row.status}</td>
            </tr>)}</tbody>
          </table>
        </div>)}
      </>}
    </section>

    {view.season && <section aria-labelledby="group-season">
      <h2 id="group-season">{text.season}</h2>
      <div style={{ overflowX: "auto" }}><table className={styles.table}>
        <thead><tr><th>{text.name}</th><th className={styles.num}>{trainingGroupSv.leader.attended}</th>
          {view.season.pointsMode !== "NONE" && <th className={styles.num}>{trainingGroupSv.leader.points}</th>}</tr></thead>
        <tbody>{view.season.rows.map(row => <tr key={row.key}><td>{[row.givenName, row.familyName].filter(Boolean).join(" ")}</td>
          <td className={styles.num}>{row.attended}</td>{view.season?.pointsMode !== "NONE" && <td className={styles.num}>{row.points}</td>}</tr>)}</tbody>
      </table></div>
    </section>}

    <section aria-labelledby="group-archive">
      <h2 id="group-archive">{text.archive}</h2>
      {view.archive.length === 0 ? <p className={styles.muted}>{text.noArchive}</p> : <ul className={styles.sessionList}>
        {view.archive.map(session => <li key={session.raceId}><div><strong>{session.eventName}</strong><span>{sessionLine(session, language)}</span></div>
          <div className={styles.rowActions}>{session.hasResults && <Link href={`/results/${session.raceId}`}>{text.results}</Link>}{sessionLink(session)}</div></li>)}
      </ul>}
    </section>

    <footer className={styles.publicFoot}>
      <span>{text.address}: <code>{address}</code></span>
      <div className={styles.rowActions}><Link href={`${path}/qr`}>{text.qr}</Link><PublicLinkShare path={path} title={view.name} /></div>
    </footer>
  </main>;
}
