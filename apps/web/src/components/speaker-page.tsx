"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { administratorForestWatchResponseSchema, publicResultListResponseV7Schema, relayOverviewSchema, speakerBoardResponseSchema,
  type AdministratorForestWatchResponse, type PublicResultListResponseV7, type RelayOverview, type SpeakerBoardResponse } from "@o-tid/contracts";
import { speakerSv as text } from "../i18n/speaker-sv";
import { formatClockTime, formatDuration } from "../lib/clock-time";
import { readOrganizerCsrf } from "../lib/organizer-client";
import { startPublicResultEventStream } from "../lib/public-result-event-stream-client";
import { classLeaders, forestByClass, latestFinishers, relayLegs, type Finisher } from "../lib/speaker";
import styles from "./speaker-page.module.css";

const REFRESH_MS = 10_000;

type Data = { board: SpeakerBoardResponse; results?: PublicResultListResponseV7 | undefined; forest?: AdministratorForestWatchResponse | undefined;
  relay?: RelayOverview | undefined; at: string };

const duration = formatDuration;

class Unauthorized extends Error {}

/**
 * Speakersidan (ADR-0170 beslut 2): senast i mål, ledare per klass, kvar i skogen per klass och stafettlag per
 * sträcka. Uppdateras av sig själv: väckningar från resultatströmmen och ett intervall som reserv.
 */
export function SpeakerPage({ raceId }: { raceId: string }) {
  const [data, setData] = useState<Data>();
  const [problem, setProblem] = useState<"login" | "error" | "stale">();
  const [classFilter, setClassFilter] = useState("");
  const [online, setOnline] = useState(true);
  const loading = useRef(false), again = useRef(false), entered = useRef(false);
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator`;

  const load = useCallback(async () => {
    if (loading.current) { again.current = true; return; }
    loading.current = true;
    try {
      const get = async (url: string) => {
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
        if (response.status === 401 || response.status === 403) throw new Unauthorized();
        if (!response.ok) throw new Error(`Speakerunderlaget svarade ${response.status}`);
        return response.json() as Promise<unknown>;
      };
      let board: SpeakerBoardResponse;
      try { board = speakerBoardResponseSchema.parse(await get(`${base}/speaker-board`)); }
      catch (error) {
        // Inloggat konto utan tävlingssession: öppna tävlingen en gång med kontot, som arbetsytan gör.
        if (!(error instanceof Unauthorized) || entered.current) throw error;
        entered.current = true;
        let csrf: string;
        try { csrf = readOrganizerCsrf(document.cookie, new URL(window.location.href)); }
        catch { throw new Unauthorized(); }
        const response = await fetch(`/api/organizer/races/${encodeURIComponent(raceId)}/enter`, { method: "POST", credentials: "same-origin",
          cache: "no-store", headers: { "x-otid-csrf": csrf } });
        if (!response.ok) throw new Unauthorized();
        board = speakerBoardResponseSchema.parse(await get(`${base}/speaker-board`));
      }
      if (board.raceId !== raceId) throw new Error("Speakerunderlaget gäller en annan tävling");
      const [results, forest, relay] = await Promise.all([
        get(`/api/public/races/${encodeURIComponent(raceId)}/results`).then(value => publicResultListResponseV7Schema.parse(value)),
        get(`${base}/forest-watch`).then(value => administratorForestWatchResponseSchema.parse(value)),
        get(`${base}/relay`).then(value => relayOverviewSchema.parse(value))
      ]);
      setData({ board, results, forest, relay, at: new Date().toISOString() });
      setProblem(undefined);
    } catch (error) {
      setProblem(error instanceof Unauthorized ? "login" : data ? "stale" : "error");
    } finally {
      loading.current = false;
      if (again.current) { again.current = false; void load(); }
    }
  }, [base, raceId, data]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void loadRef.current(); };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    const stop = startPublicResultEventStream(raceId, EventSource, refresh);
    const network = () => setOnline(navigator.onLine);
    network();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", network); window.addEventListener("offline", network);
    return () => {
      window.clearInterval(timer); stop();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", network); window.removeEventListener("offline", network);
    };
  }, [raceId]);

  if (problem === "login") return <div className={styles.board}><p className={styles.notice} role="alert">{text.loginNeeded}{" "}
    <Link href="/organizer">{text.login}</Link></p></div>;
  if (!data) return <div className={styles.board}><p className={styles.waiting} role="status">{problem === "error" ? text.loadError : text.loading}</p></div>;
  const timeZone = data.board.timeZone;
  const leaders = data.results ? classLeaders(data.results) : [];
  const shownLeaders = classFilter ? leaders.filter(row => row.className === classFilter) : leaders;
  const forest = data.forest ? forestByClass(data.forest) : [];
  const relay = data.relay && data.relay.classes.length > 0 ? relayLegs(data.relay) : [];
  return <div className={styles.board}>
    <header className={styles.head}>
      <div className={styles.title}><h1>{data.board.eventName}</h1><p>{data.board.raceName} · {text.title}</p></div>
      <p className={styles.state} role="status" data-problem={!online || problem ? "true" : undefined}>
        {!online ? text.offline : problem === "stale" ? text.stale : text.updatedAt(formatClockTime(data.at, timeZone))}
      </p>
      <Link className={styles.back} href={`/admin/${encodeURIComponent(raceId)}/manage`}>{text.back}</Link>
    </header>
    <div className={styles.grid}>
      <section className={`${styles.block} ${styles.latest}`} aria-labelledby="speaker-latest">
        <h2 id="speaker-latest">{text.latestTitle}</h2>
        <Latest rows={latestFinishers(data.board, data.results)} timeZone={timeZone} />
      </section>
      <section className={styles.block} aria-labelledby="speaker-leaders">
        <div className={styles.blockHead}>
          <h2 id="speaker-leaders">{text.leadersTitle}</h2>
          <label className={styles.filter}><span>{text.classFilter}</span><select value={classFilter} onChange={event => setClassFilter(event.target.value)}>
            <option value="">{text.allClasses}</option>
            {leaders.map(row => <option key={row.className} value={row.className}>{row.className}</option>)}
          </select></label>
        </div>
        {shownLeaders.length === 0 ? <p className={styles.empty}>{text.leadersEmpty}</p> : shownLeaders.map(row =>
          <div key={row.className} className={styles.group}>
            <h3>{row.className}</h3>
            <ol className={styles.rows}>{row.leaders.map(leader => <li key={leader.publicResultId}>
              <span className={styles.place}>{text.place(leader.position)}</span>
              <span className={styles.name}>{leader.givenName} {leader.familyName}<small>{leader.organisationName ?? ""}</small></span>
              <span className={styles.time}>{duration(leader.elapsedMs)}</span>
            </li>)}</ol>
          </div>)}
      </section>
      <section className={styles.block} aria-labelledby="speaker-forest">
        <h2 id="speaker-forest">{text.forestTitle}</h2>
        {forest.length === 0 ? <p className={styles.empty}>{text.forestEmpty}</p> : forest.map(row =>
          <div key={row.className} className={styles.group}>
            <h3>{row.className}<span className={styles.count}>{text.forestCount(row.runners.length)}</span></h3>
            <p className={styles.names}>{row.runners.map(runner => runner.displayName).join(", ")}</p>
          </div>)}
      </section>
      {relay.length > 0 && <section className={`${styles.block} ${styles.relay}`} aria-labelledby="speaker-relay">
        <h2 id="speaker-relay">{text.relayTitle}</h2>
        {relay.map(row => <div key={row.raceClass.id} className={styles.group}>
          <h3>{row.raceClass.name}<span className={styles.count}>{text.relayFinished(row.finished.length)}</span></h3>
          {row.legs.map(leg => <p key={leg.leg} className={styles.names}><strong>{text.relayOut(leg.leg, leg.out.length)}</strong>
            {leg.out.length > 0 && <> · {leg.out.map(team => text.team(team.number, team.name)).join(", ")}</>}</p>)}
          {row.finished.length > 0 && <ol className={styles.rows}>{row.finished.slice(0, 3).map(team => <li key={team.id}>
            <span className={styles.place}>{team.position ? text.place(team.position) : ""}</span>
            <span className={styles.name}>{text.team(team.number, team.name)}<small>{team.organisationName ?? ""}</small></span>
            <span className={styles.time}>{team.elapsedMs !== null ? duration(team.elapsedMs) : text.noTime}</span>
          </li>)}</ol>}
        </div>)}
      </section>}
    </div>
  </div>;
}

/** Senast i mål: klockslag, namn och klubb, klass, tid eller status och placering. */
function Latest({ rows, timeZone }: { rows: Finisher[]; timeZone: string }) {
  if (rows.length === 0) return <p className={styles.empty}>{text.latestEmpty}</p>;
  return <table className={styles.table}>
    <tbody>{rows.map(row => {
      const status = row.state === "ACTIVE_RESULT" ? row.result.status : undefined;
      const elapsed = row.state === "ACTIVE_RESULT" && "elapsedMs" in row.result ? row.result.elapsedMs : undefined;
      return <tr key={`${row.slot}-${row.selectedRevision}`} data-status={status}>
        <td className={styles.clock}>{formatClockTime(row.registeredAt, timeZone)}</td>
        <td className={styles.name}>{row.givenName} {row.familyName}<small>{row.organisationName ?? ""}</small></td>
        <td className={styles.className}>{row.className}</td>
        <td className={styles.result}>{status === "OK" && elapsed !== undefined ? <span className={styles.time}>{duration(elapsed)}</span>
          : <span className={styles.status}><span aria-hidden="true">{status === "MP" || status === "DSQ" ? "✗ " : ""}</span>
            {status ? text.statuses[status] : text.noResult}</span>}</td>
        <td className={styles.place}>{row.position ? text.place(row.position) : ""}</td>
      </tr>;
    })}</tbody>
  </table>;
}
