"use client";

import { useState } from "react";
import Link from "next/link";
import type { BingoAdminView } from "@o-tid/contracts";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { formatBingoDistance, formatBingoTime } from "../../lib/bingo-run";
import { courseSettingBase } from "../../lib/course-setting-api";
import { raceHubPath } from "../../lib/public-race-format";
import { useTexts } from "../language-provider";
import { Notice } from "../ui";
import { BingoBoard, useBingoBoard } from "./bingo-board";
import { VirtualControlsView, type ControlState } from "./virtual-controls-view";
import styles from "./bingo.module.css";

/**
 * Ledarens vy för virtuella kontroller (ADR-0226): per bana löparna med kontroller, tid, duell och lag, mellantiderna och den
 * valda löparens spår och stämplingar på kartan; dueller som på tävlingssidan.
 */
export function VirtualLeader({ raceId, view, failed }: { raceId: string; view: BingoAdminView; failed: boolean }) {
  const text = useTexts(bingoSv.leader, bingoEn.leader);
  const vk = useTexts(bingoSv.virtual, bingoEn.virtual);
  const board = useBingoBoard(raceId, { formatVersion: 1, mode: "CONTROLS", groups: [], duels: [] }, view.runners.length + view.runners.reduce((sum, row) => sum + row.updatedAt, 0));
  const courses = view.courses ?? [];
  const [course, setCourse] = useState<string>();
  const [runner, setRunner] = useState<string>();
  const current = courses.find(item => item.course === course) ?? courses[0];
  const runners = view.runners.filter(row => row.course === current?.course);
  const one = runners.find(row => row.id === runner) ?? runners[0];
  const states = new Map<string, ControlState>((one?.punches ?? []).map(punch => [punch.control, "MINE"]));
  return <main className={styles.leader} data-testid="bingo-leader">
    <h1>{vk.leaderTitle}</h1>
    <p className={styles.muted}>{text.help}</p>
    {failed && <Notice tone="error" role="alert">{text.failed}</Notice>}
    {!view.enabled && <Notice tone="error">{text.off}</Notice>}
    <div className={styles.row}>
      <Link href={`${raceHubPath(view.shortCode)}/bingo`}>{text.runnerPage}</Link>
      {courses.length > 1 && <select value={current?.course} onChange={event => { setCourse(event.target.value); setRunner(undefined); }} aria-label={vk.course}>
        {courses.map(item => <option key={item.course} value={item.course}>{item.name}</option>)}</select>}
    </div>
    {current && <div className={styles.leaderGrid}>
      <section aria-label={current.name}>
        <h2>{current.name}</h2>
        {runners.length === 0 ? <p>{text.none}</p> : <table className={styles.table} data-testid="bingo-leader-table">
          <thead><tr><th scope="col">{text.name}</th><th scope="col">{vk.controls}</th><th scope="col">{text.time}</th><th scope="col">{text.distance}</th>
            <th scope="col">{text.state}</th></tr></thead>
          <tbody>{runners.map(row => <tr key={row.id} data-mine={row.id === one?.id || undefined}>
            <td><button type="button" className={styles.linkButton} aria-pressed={row.id === one?.id} onClick={() => setRunner(row.id)}>{row.name}</button>
              {(row.duel || row.team) && <div className={styles.muted}>{[row.duel, row.team].filter(Boolean).join(" · ")}</div>}
              <div className={styles.muted}>{(row.punches ?? []).map(punch => `${punch.code} ${formatBingoTime(punch.fromStartMs / 1000)}`).join(", ") || "–"}</div></td>
            <td>{row.controls ?? 0}</td><td>{formatBingoTime(row.seconds)}</td><td>{formatBingoDistance(row.distanceM)}</td>
            <td>{text.status[row.status]}</td>
          </tr>)}</tbody>
        </table>}
      </section>
      <section aria-label={text.map}>
        <h2>{text.map}{one ? ` · ${one.name}` : ""}</h2>
        <VirtualControlsView course={current} states={states} label={text.map} track={one?.track} punches={one?.punches}
          image={view.image ? { ...view.image, href: `${courseSettingBase(raceId)}/map/image` } : undefined} />
      </section>
    </div>}
    <BingoBoard board={board} />
  </main>;
}
