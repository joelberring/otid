"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bingoAdminViewSchema, type BingoAdminView } from "@o-tid/contracts";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { formatBingoDistance, formatBingoTime, formatShips } from "../../lib/bingo-run";
import { courseSettingBase } from "../../lib/course-setting-api";
import { raceHubPath } from "../../lib/public-race-format";
import { useTexts } from "../language-provider";
import { Notice } from "../ui";
import { BingoMap } from "./bingo-map";
import styles from "./bingo.module.css";

const REFRESH_MS = 10_000;
const COLORS = ["#d0021b", "#0057b8", "#1b8a2f", "#e07b00", "#7b2cbf", "#008b8b", "#c2185b", "#5d4037", "#455a64", "#9e9d24"];

/** Ledarens vy (ADR-0225), bara för administratören: ett läge per grupp och löpare, uppdateras var tionde sekund, och spåren. */
export function BingoLeader({ raceId }: { raceId: string }) {
  const text = useTexts(bingoSv.leader, bingoEn.leader);
  const ships = useTexts(bingoSv.ships, bingoEn.ships);
  const [view, setView] = useState<BingoAdminView>();
  const [failed, setFailed] = useState(false);
  const [course, setCourse] = useState<string>();
  const [runner, setRunner] = useState<string>();
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`${courseSettingBase(raceId)}/bingo`, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = bingoAdminViewSchema.parse(await response.json());
        if (!stopped) { setView(next); setFailed(false); }
      } catch (error) { console.warn("Bingons läge kunde inte hämtas", error); if (!stopped) setFailed(true); }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [raceId]);

  if (!view) return <main className={styles.leader}><h1>{text.title}</h1>{failed ? <Notice tone="error" role="alert">{text.failed}</Notice>
    : <p role="status">{text.loading}</p>}</main>;
  const group = view.groups.find(item => item.course === course) ?? view.groups[0];
  const shipsMode = view.mode === "SHIPS";
  const runners = view.runners.filter(row => row.course === group?.course)
    .sort((a, b) => Number(a.status === "ABANDONED") - Number(b.status === "ABANDONED") || (shipsMode ? b.points - a.points || b.sunk - a.sunk : 0)
      || b.taken.length - a.taken.length || a.seconds - b.seconds);
  const color = (id: string) => COLORS[Math.max(0, runners.findIndex(row => row.id === id)) % COLORS.length]!;
  const shown = runners.filter(row => runner === undefined || row.id === runner);
  const taken = new Set(shipsMode ? [] : shown.flatMap(row => row.taken.map(item => item.cell)));
  const one = runner === undefined ? undefined : runners.find(row => row.id === runner);
  return <main className={styles.leader} data-testid="bingo-leader">
    <h1>{text.title}</h1>
    <p className={styles.muted}>{text.help}</p>
    {failed && <Notice tone="error" role="alert">{text.failed}</Notice>}
    {!view.enabled && <Notice tone="error">{text.off}</Notice>}
    <div className={styles.row}>
      <Link href={`${raceHubPath(view.shortCode)}/bingo`}>{text.runnerPage}</Link>
      {view.groups.length > 1 && <select value={group?.course} onChange={event => { setCourse(event.target.value); setRunner(undefined); }}
        aria-label={text.all}>
        {view.groups.map(item => <option key={item.course} value={item.course}>{item.name}</option>)}</select>}
    </div>
    {group && <div className={styles.leaderGrid}>
      <section aria-label={group.name}>
        <h2>{group.name}</h2>
        {shipsMode && <p data-testid="bingo-shared-ships"><span className={styles.swatch} style={{ background: "#0057b8" }} aria-hidden="true" />
          {ships.sharedList(formatShips(group.sharedCells ?? []) || "–")}</p>}
        {runners.length === 0 ? <p>{text.none}</p> : <table className={styles.table} data-testid="bingo-leader-table">
          <thead><tr><th scope="col">{text.name}</th>{shipsMode ? <><th scope="col">{ships.points}</th><th scope="col">{ships.sunk}</th>
            <th scope="col">{ships.sharedColumn}</th><th scope="col">{ships.hitsColumn}</th><th scope="col">{ships.waterColumn}</th><th scope="col">{ships.wrongColumn}</th></> : <><th scope="col">{text.cells}</th>
            <th scope="col">{text.distance}</th></>}<th scope="col">{text.time}</th>
            <th scope="col">{text.state}</th><th scope="col">{text.updated}</th></tr></thead>
          <tbody>{runners.map(row => <tr key={row.id} data-mine={row.id === runner || undefined}>
            <td><button type="button" className={styles.linkButton} aria-pressed={row.id === runner}
              onClick={() => setRunner(current => current === row.id ? undefined : row.id)}>
              <span className={styles.swatch} style={{ background: color(row.id) }} aria-hidden="true" />{row.name}</button>
              {shipsMode && <div className={styles.muted}>{ships.ownList(formatShips(row.ships.slice(row.sharedShips)) || "–")}</div>}</td>
            {shipsMode ? <><td>{row.points}</td><td>{row.sunk}/{row.ships.length}</td><td>{row.sharedSunk}/{row.sharedShips}</td><td>{row.hits}</td><td>{row.water ?? row.shots.filter(shot => shot.result === "WATER").length}</td><td>{row.wrong}</td></>
              : <><td>{row.taken.length}/{group.cells.length}</td><td>{formatBingoDistance(row.distanceM)}</td></>}<td>{formatBingoTime(row.seconds)}</td>
            <td>{text.status[row.status]}{row.gaps.length > 0 && <span className={styles.muted}> · {text.gaps(row.gaps.length)}</span>}</td>
            <td>{new Date(row.updatedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
          </tr>)}</tbody>
        </table>}
      </section>
      <section aria-label={text.map}>
        <h2>{text.map}{runner !== undefined && <> · <button type="button" className={styles.linkButton} onClick={() => setRunner(undefined)}>{text.all}</button></>}</h2>
        <BingoMap group={group} taken={taken} label={text.map}
          tracks={shown.map(row => ({ id: row.id, points: shipsMode ? row.shots.map(shot => [shot.x, shot.y, shot.at] as const) : row.track,
            color: color(row.id) }))}
          ships={shipsMode && one ? one.ships.slice(one.sharedShips) : undefined} sharedShips={shipsMode ? group.sharedCells : undefined}
          shots={shipsMode ? shown.flatMap(row => row.shots.map(shot => ({ ...shot, ...(one ? {} : { color: color(row.id) }) }))) : undefined}
          image={view.image ? { ...view.image, href: `${courseSettingBase(raceId)}/map/image` } : undefined} />
      </section>
    </div>}
  </main>;
}
