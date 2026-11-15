"use client";

import { useEffect, useState } from "react";
import { bingoLeaderboardSchema, type BingoLeaderboard } from "@o-tid/contracts";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { formatBingoDistance, formatBingoTime } from "../../lib/bingo-run";
import { useTexts } from "../language-provider";
import styles from "./bingo.module.css";

const REFRESH_MS = 15_000;

/**
 * Topplistan hämtas var 15:e sekund och direkt när `fresh` ändras (telefonens läge är kvitterat) (ADR-0225). Ett
 * misslyckat hämtande behåller den förra listan.
 */
export function useBingoBoard(raceId: string, initial: BingoLeaderboard, fresh?: number): BingoLeaderboard {
  const [board, setBoard] = useState(initial);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/public/races/${encodeURIComponent(raceId)}/bingo`, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const next = bingoLeaderboardSchema.parse(await response.json());
        if (!stopped) setBoard(next);
      } catch (error) { console.warn("Topplistan kunde inte hämtas", error); }
    };
    if (fresh) void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [raceId, fresh]);
  return board;
}

/** Topplistan per grupp (eller bara en grupp): namn, rutor, tid och sträcka. `dark` = fickläget. */
export function BingoBoard({ board, only, dark, mine }: { board: BingoLeaderboard; only?: string | undefined; dark?: boolean; mine?: string | undefined }) {
  const text = useTexts(bingoSv.board, bingoEn.board);
  const ships = useTexts(bingoSv.ships, bingoEn.ships);
  const groups = board.groups.filter(group => only === undefined || group.course === only);
  return <section className={dark ? styles.boardDark : styles.board} aria-labelledby="bingo-board">
    <h2 id="bingo-board">{text.heading}</h2>
    {groups.map(group => <div key={group.course} className={styles.boardGroup}>
      {only === undefined && <h3>{group.name}</h3>}
      {group.runners.length === 0 ? <p className={styles.muted}>{text.none}</p> : board.mode === "SHIPS" ? <table className={styles.table} data-testid="bingo-board">
        <thead><tr><th scope="col">#</th><th scope="col">{text.name}</th><th scope="col">{ships.points}</th><th scope="col">{ships.sunk}</th>
          <th scope="col">{ships.hitsColumn}</th><th scope="col">{ships.waterColumn}</th><th scope="col">{ships.wrongColumn}</th><th scope="col">{ships.lastColumn}</th></tr></thead>
        <tbody>{group.runners.map((row, index) => <tr key={`${row.name}-${index}`} data-mine={row.name === mine || undefined}>
          <td>{index + 1}</td><td>{row.name} <span className={styles.muted}>{text.status[row.status]}</span></td>
          <td>{row.points ?? 0}</td><td>{row.sunk ?? 0}</td><td>{row.hits ?? 0}</td><td>{row.water ?? 0}</td><td>{row.wrong ?? 0}</td>
          <td>{row.lastShotAt ? new Date(row.lastShotAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) : "–"}</td>
        </tr>)}</tbody>
      </table> : <table className={styles.table} data-testid="bingo-board">
        <thead><tr><th scope="col">#</th><th scope="col">{text.name}</th><th scope="col">{text.cells}</th><th scope="col">{text.time}</th>
          <th scope="col">{text.distance}</th></tr></thead>
        <tbody>{group.runners.map((row, index) => <tr key={`${row.name}-${index}`} data-mine={row.name === mine || undefined}>
          <td>{index + 1}</td><td>{row.name} <span className={styles.muted}>{text.status[row.status]}</span></td>
          <td>{row.cells}/{group.cells}</td><td>{formatBingoTime(row.seconds)}</td><td>{formatBingoDistance(row.distanceM)}</td>
        </tr>)}</tbody>
      </table>}
    </div>)}
  </section>;
}

/** Topplistan på tävlingssidan, uppdateras som på löparens sida. */
export function LiveBingoBoard({ raceId, initial }: { raceId: string; initial: BingoLeaderboard }) {
  return <BingoBoard board={useBingoBoard(raceId, initial)} />;
}
