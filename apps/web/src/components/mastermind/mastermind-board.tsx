"use client";

import { useEffect, useState } from "react";
import { mastermindStandingsSchema, type MastermindStandings } from "@o-tid/contracts";
import { formatDuration } from "@o-tid/domain/mastermind";
import { mastermindBoardEn } from "../../i18n/mastermind-board-en";
import { mastermindBoardSv } from "../../i18n/mastermind-board-sv";
import { useTexts } from "../language-provider";
import styles from "../bingo/bingo.module.css";
import hubStyles from "../public-race/public-race.module.css";

const REFRESH_MS = 15_000;

/**
 * Den löpande tiden för spel som pågår (sekundvis). Undefined tills sidan körs i webbläsaren, så att serverns HTML och
 * webbläsarens första rendering är lika (annars skiljer klockan en sekund).
 */
function useNow(running: boolean): number | undefined {
  const [now, setNow] = useState<number>();
  useEffect(() => {
    if (!running) return undefined;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [running]);
  return now;
}

/**
 * Mastermind med kontroller på tävlingssidan (ADR-0228): ställningen hämtas var 15:e sekund medan sidan syns. Ett misslyckat
 * hämtande (också efter träningsdagen) behåller den förra ställningen.
 */
export function LiveMastermindBoard({ raceId, initial }: { raceId: string; initial: MastermindStandings }) {
  const text = useTexts(mastermindBoardSv, mastermindBoardEn);
  const [board, setBoard] = useState(initial);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/public/races/${encodeURIComponent(raceId)}/mastermind`, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const next = mastermindStandingsSchema.parse(await response.json());
        if (!stopped) setBoard(next);
      } catch (error) { console.warn("Mastermind-ställningen kunde inte hämtas", error); }
    };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [raceId]);
  const now = useNow(board.rows.some(row => row.status === "playing"));
  const time = (row: MastermindStandings["rows"][number]) => row.durationMs !== undefined ? formatDuration(row.durationMs)
    : row.startedAt && now !== undefined ? formatDuration(Math.max(0, now - Date.parse(row.startedAt))) : "–";
  return <section className={styles.board} aria-labelledby="mastermind-board" data-testid="hub-mastermind">
    <h2 id="mastermind-board">{text.heading}</h2>
    {/* ADR-0228: med "Spela på egen dator" påslaget kan ett lag med en avläsningsstation spela härifrån. */}
    {board.openStations && <>
      <ol>{text.rules.map(rule => <li key={rule}>{rule}</li>)}</ol>
      <p><a className={hubStyles.bingoCta} href={`/mastermind/index.html#spela:${raceId}`} data-testid="hub-mastermind-play">
        <strong>{text.play}</strong><span>{text.playHelp}</span></a></p>
    </>}
    <p className={styles.muted}>{text.help}</p>
    {board.rows.length === 0 ? <p className={styles.muted}>{text.none}</p> : <div className={styles.boardGroup}>
      <table className={styles.table} data-testid="mastermind-board">
        <thead><tr><th scope="col">{text.place}</th><th scope="col">{text.team}</th><th scope="col">{text.guesses}</th>
          <th scope="col">{text.time}</th><th scope="col">{text.status}</th></tr></thead>
        <tbody>{board.rows.map((row, index) => <tr key={`${row.cardEnd}-${row.startedAt ?? ""}-${index}`}>
          <td>{row.place ?? ""}</td>
          <td>{row.name ?? text.card(row.cardEnd)}</td>
          <td>{row.guesses}</td>
          <td className={row.status === "playing" ? styles.muted : undefined}>{time(row)}</td>
          <td>{text.states[row.status]}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
