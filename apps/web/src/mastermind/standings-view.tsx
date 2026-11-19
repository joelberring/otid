import { useEffect, useState } from "react";
import { formatDuration, type StandingRow } from "@o-tid/domain/mastermind";
import type { MastermindTexts } from "./texts";

/** Tiden sedan spelets start (datorns klocka), varje sekund. */
export function useElapsed(startedAt: string | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  return Number.isFinite(start) ? Math.max(0, now - start) : undefined;
}

function RunningTime({ startedAt }: { startedAt: string | undefined }) {
  const elapsed = useElapsed(startedAt);
  return <>{elapsed === undefined ? "–" : formatDuration(elapsed)}</>;
}

/** Statistiken: varje avslutat spel och de som pågår, med lagnamn, gissningar och tid. */
/** Statistiken; `onAbort` (arrangörens dator) ger spel som pågår en knapp för att avbryta dem. */
export function StandingsTable({ rows, names, viewing, onSelect, onAbort, t }: {
  rows: readonly StandingRow[]; names: Readonly<Record<string, string>>; viewing: number | undefined;
  onSelect: (cardNumber: number) => void; onAbort?: ((gameId: string) => void) | undefined; t: MastermindTexts;
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
          {rows.map((row) => {
            const name = names[String(row.cardNumber)];
            return (
              <tr key={row.gameId} className={`mm-standing-${row.status}${row.status === "playing" && row.cardNumber === viewing ? " mm-standing-active" : ""}`}>
                <td className="mm-num">{row.place ?? ""}</td>
                <td>
                  <button type="button" className="mm-link" onClick={() => onSelect(row.cardNumber)}>{name || t.card(row.cardNumber)}</button>
                  {name && <span className="mm-muted"> {row.cardNumber}</span>}
                </td>
                <td className="mm-num">{row.guesses}</td>
                <td className="mm-num mm-time">
                  {row.status === "playing" ? <span className="mm-muted"><RunningTime startedAt={row.startedAt} /></span>
                    : row.durationMs === undefined ? "–" : formatDuration(row.durationMs)}
                </td>
                <td>{row.status === "playing" ? t.playing : row.status === "won" ? t.wonShort : t.lostShort}
                  {onAbort && row.status === "playing" && <> <button type="button" className="mm-button mm-small"
                    aria-label={t.abortFor(name || t.card(row.cardNumber))} onClick={() => onAbort(row.gameId)}>{t.abort}</button></>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
