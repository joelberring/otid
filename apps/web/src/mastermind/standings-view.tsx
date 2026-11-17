import { useEffect, useState } from "react";
import { formatDuration, type StandingRow } from "./game";
import type { MastermindTexts } from "./texts";

/** Tiden sedan första stämplingen, varje sekund. `clockOffsetMs`: stationens klocka minus datorns, när den är känd. */
export function useElapsed(firstPunchAt: string | undefined, clockOffsetMs: number): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!firstPunchAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [firstPunchAt]);
  if (!firstPunchAt) return undefined;
  const start = Date.parse(firstPunchAt);
  return Number.isFinite(start) ? Math.max(0, now + clockOffsetMs - start) : undefined;
}

function RunningTime({ firstPunchAt, clockOffsetMs }: { firstPunchAt: string | undefined; clockOffsetMs: number }) {
  const elapsed = useElapsed(firstPunchAt, clockOffsetMs);
  return <>{elapsed === undefined ? "–" : formatDuration(elapsed)}</>;
}

/** Statistiken: varje avslutat spel och de som pågår, med lagnamn, gissningar och tid. */
export function StandingsTable({ rows, names, viewing, clockOffsetMs, onSelect, t }: {
  rows: readonly StandingRow[]; names: Readonly<Record<string, string>>; viewing: number | undefined; clockOffsetMs: number;
  onSelect: (cardNumber: number) => void; t: MastermindTexts;
}) {
  if (rows.length === 0) return <p className="mm-muted">{t.noPlayers}</p>;
  return (
    <div className="mm-table-wrap">
      <table className="mm-standings">
        <thead>
          <tr><th scope="col" className="mm-num">{t.place}</th><th scope="col">{t.team}</th><th scope="col" className="mm-num">{t.guessesColumn}</th>
            <th scope="col" className="mm-num">{t.time}</th><th scope="col">{t.statusColumn}</th></tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const name = names[String(row.cardNumber)];
            return (
              <tr key={`${row.cardNumber}-${index}`} className={`mm-standing-${row.status}${row.status === "playing" && row.cardNumber === viewing ? " mm-standing-active" : ""}`}>
                <td className="mm-num">{row.place ?? ""}</td>
                <td>
                  <button type="button" className="mm-link" onClick={() => onSelect(row.cardNumber)}>{name || t.card(row.cardNumber)}</button>
                  {name && <span className="mm-muted"> {row.cardNumber}</span>}
                </td>
                <td className="mm-num">{row.guesses}</td>
                <td className="mm-num mm-time">
                  {row.status === "playing" ? <span className="mm-muted"><RunningTime firstPunchAt={row.firstPunchAt} clockOffsetMs={clockOffsetMs} /></span>
                    : row.durationMs === undefined ? "–" : formatDuration(row.durationMs)}
                </td>
                <td>{row.status === "playing" ? t.playing : row.status === "won" ? t.wonShort : t.lostShort}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
