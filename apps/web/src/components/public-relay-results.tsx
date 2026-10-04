"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { publicRelayResultsSchema, type PublicRelayResults } from "@o-tid/contracts";
import { relaySv as text } from "../i18n/relay-sv";
import { sv } from "../i18n/sv";
import styles from "./public-relay-results.module.css";
import { formatDuration } from "../lib/clock-time";

function duration(milliseconds: number | null): string {
  return milliseconds === null ? "–" : formatDuration(milliseconds);
}

type Team = PublicRelayResults["classes"][number]["teams"][number];

function teamStatus(team: Team): string {
  if (team.status === "RUNNING") return team.currentLeg ? text.outOnLeg(team.currentLeg) : text.status.RUNNING;
  return text.status[team.status];
}

/**
 * Publika stafettresultat (ADR-0169 beslut 3): per stafettklass lagresultat (placering, lag, klubb,
 * tid, status) med utfällbara sträckor, och sträckresultat per sträcka. Uppdateras var femte sekund.
 */
export function PublicRelayResults({ raceId, initial }: { raceId: string; initial: PublicRelayResults }) {
  const [data, setData] = useState(initial);
  const [failed, setFailed] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if (running.current || stopped) return;
      running.current = true;
      try {
        const response = await fetch(`/api/public/races/${encodeURIComponent(raceId)}/relay-results`, { cache: "no-store" });
        if (!response.ok) throw new Error("Stafettresultaten kunde inte hämtas");
        const parsed = publicRelayResultsSchema.parse(await response.json());
        if (!stopped) { setData(parsed); setFailed(false); }
      } catch { if (!stopped) setFailed(true); }
      finally { running.current = false; }
    };
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [raceId]);
  if (data.classes.length === 0) return null;
  return <section className={styles.relay} aria-label={text.publicTitle}>
    {failed && <p className="warning" role="alert">{text.publicRefreshFailed}</p>}
    {data.classes.map(raceClass => <section key={raceClass.name} className={styles.raceClass} aria-label={raceClass.name}>
      <h2>{raceClass.name} <span className={styles.legCount}>{text.publicLegCount(raceClass.legCount)}</span></h2>
      {raceClass.teams.length === 0 ? <p>{text.publicEmpty}</p> : <table className={`public-results-table ${styles.table} ${styles.teams}`}
        aria-label={text.publicTeams(raceClass.name)}>
        <thead><tr><th scope="col">{text.publicPosition}</th><th scope="col">{text.publicTeam}</th><th scope="col">{text.publicTime}</th>
          <th scope="col">{text.publicStatus}</th><th scope="col">{text.publicShowLegs}</th></tr></thead>
        <tbody>{raceClass.teams.map(team => <tr key={team.number} data-status={team.status}>
          <td data-label={text.publicPosition} className={styles.position}>{team.position ?? "–"}</td>
          <td data-label={text.publicTeam} className="public-result-participant">
            <strong>{team.number} {team.name}</strong><small className={styles.club}>{team.organisationName ?? ""}</small></td>
          <td data-label={text.publicTime} className={styles.time}>{duration(team.elapsedMs)}
            {team.timeBehindMs !== null && team.timeBehindMs > 0 && <small className={styles.club}>+{duration(team.timeBehindMs)}</small>}</td>
          <td data-label={text.publicStatus} className={team.status === "OK" ? "result-ok" : team.status === "RUNNING" ? undefined : "result-mp"}>
            {teamStatus(team)}</td>
          <td data-label={text.publicShowLegs} className={styles.legCell}><details>
            <summary>{text.publicShowLegs}</summary>
            <ol className={styles.legs}>{team.legs.map(leg => <li key={leg.leg}>
              <span className={styles.legNumber}>{leg.leg}.</span>
              <Link href={`/results/${raceId}/participants/${leg.publicResultId}`}>{leg.givenName} {leg.familyName}</Link>
              <span>{leg.status ? leg.status === "OK" ? duration(leg.elapsedMs) : sv.publicResultsStatusLabels[leg.status] : "–"}
                {leg.legPosition !== null && ` ${text.publicLegPosition(leg.legPosition)}`}{leg.restarted && ` · ${text.restarted}`}</span>
            </li>)}</ol>
          </details></td>
        </tr>)}</tbody>
      </table>}
      <details className={styles.legResults}>
        <summary>{text.publicLegs}</summary>
        {raceClass.legs.map(leg => <table key={leg.leg} className={`public-results-table ${styles.table} ${styles.legTable}`}
          aria-label={text.publicLegTitle(raceClass.name, leg.leg)}>
          <caption>{text.startLeg(leg.leg)}</caption>
          <thead><tr><th scope="col">{text.publicPosition}</th><th scope="col">{text.publicRunner}</th><th scope="col">{text.publicTeam}</th>
            <th scope="col">{text.publicTime}</th></tr></thead>
          <tbody>{leg.results.map(row => <tr key={`${row.teamNumber}`}>
            <td data-label={text.publicPosition} className={styles.position}>{row.position ?? "–"}</td>
            <td data-label={text.publicRunner} className="public-result-participant">{row.givenName} {row.familyName}</td>
            <td data-label={text.publicTeam}>{row.teamNumber} {row.teamName}</td>
            <td data-label={text.publicTime}>{row.status === "OK" ? duration(row.elapsedMs) : sv.publicResultsStatusLabels[row.status]}</td>
          </tr>)}</tbody>
        </table>)}
      </details>
    </section>)}
  </section>;
}
