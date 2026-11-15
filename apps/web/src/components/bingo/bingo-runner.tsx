"use client";

import { useEffect, useRef, useState } from "react";
import type { BingoGroup, BingoLeaderboard } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { forgetBingoRun, formatBingoDistance, formatBingoGap, formatBingoTime, readBingoName, saveBingoName } from "../../lib/bingo-run";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import { BingoBoard, useBingoBoard } from "./bingo-board";
import { BingoCard } from "./bingo-card";
import { BingoMap, type BingoMapImage } from "./bingo-map";
import { useBingoRun } from "./use-bingo-run";
import styles from "./bingo.module.css";

const HOLD_MS = 2000;

/**
 * Knapp som kräver ett långt tryck (2 s) i fickläget, så att den inte trycks av misstag. Med tangentbordet (eller en
 * skärmläsare) blir det en bekräftelse i stället.
 */
function HoldButton({ label, hold, confirmText, onDone, testId }: { label: string; hold: string; confirmText: string; onDone: () => void; testId: string }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const stop = () => { window.clearTimeout(timer.current); timer.current = undefined; setHolding(false); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <button type="button" className={styles.hold} data-holding={holding || undefined} data-testid={testId}
    onPointerDown={event => { event.preventDefault(); setHolding(true); timer.current = window.setTimeout(() => { stop(); onDone(); }, HOLD_MS); }}
    onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0 && window.confirm(confirmText)) onDone(); }}>
    <span>{label}</span><span className={styles.holdHelp}>{hold}</span>
    <span className={styles.holdBar} aria-hidden="true" />
  </button>;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Löparens sida i bingon (ADR-0225): namn, grupp och Starta; under loppet fickläget (mörkt, stora siffror, brickan och
 * gruppens topplista, Mål och Avbryt med långt tryck); efter målgången resultatet, kartan med spåret och topplistan.
 * Kartan och positionen visas aldrig under loppet.
 */
export function BingoRunner({ raceId, title, groups, georeference, mapScale, image, initialBoard }: {
  raceId: string; title: string; groups: readonly BingoGroup[]; georeference: MapGeoreference | null; mapScale: number;
  image: Omit<BingoMapImage, "href"> | null; initialBoard: BingoLeaderboard;
}) {
  const text = useTexts(bingoSv.runner, bingoEn.runner);
  const bingo = useBingoRun({ raceId, groups, georeference, mapScale });
  const board = useBingoBoard(raceId, initialBoard);
  const [name, setName] = useState("");
  const [course, setCourse] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  useEffect(() => setName(readBingoName()), []);
  const run = bingo.run;
  const now = useNow(run?.status === "RUNNING");
  const ready = groups.length > 0 && georeference !== null;

  if (!run || !bingo.group) {
    const trimmed = name.trim();
    return <main className={styles.page} data-testid="bingo-signup">
      <h1>{text.title}</h1>
      <p className={styles.kicker}>{title}</p>
      <p>{text.intro}</p>
      {!georeference && <Notice tone="error" role="alert">{text.noGeoreference}</Notice>}
      {groups.length === 0 && <Notice tone="error" role="alert">{text.noGroups}</Notice>}
      <form className={styles.signup} onSubmit={event => {
        event.preventDefault();
        if (!trimmed || !course || !ready) return;
        saveBingoName(trimmed);
        void bingo.start(trimmed.slice(0, 60), course);
      }}>
        <label className={styles.field}>{text.name}
          <input type="text" value={name} maxLength={60} autoComplete="given-name" required onChange={event => setName(event.target.value)}
            data-testid="bingo-runner-name" />
          <span className={styles.muted}>{text.nameHelp}</span></label>
        <fieldset className={styles.groups} disabled={!trimmed}>
          <legend>{text.group}</legend>
          {groups.map(group => <label key={group.course} className={styles.groupChoice}>
            <input type="radio" name="bingo-group" value={group.course} checked={course === group.course} onChange={() => setCourse(group.course)} />
            <span><strong>{group.name}</strong> <span className={styles.muted}>{text.groupLine(group.cells.length, group.cellMeters)}</span></span>
          </label>)}
        </fieldset>
        <section className={styles.rules} aria-labelledby="bingo-rules">
          <h2 id="bingo-rules">{text.instructions}</h2>
          <ul>{text.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
        </section>
        <Button type="submit" className={styles.start} disabled={!trimmed || !course || !ready} data-testid="bingo-start">{text.start}</Button>
      </form>
      <BingoBoard board={board} />
    </main>;
  }

  const group = bingo.group;
  const taken = new Set(run.run.taken.map(row => row.cell));
  const seconds = ((run.finishedAt ?? now) - run.startedAt) / 1000;
  const problem = bingo.problem ? text[bingo.problem] : undefined;
  const unsent = run.acked < run.version;

  if (run.status === "RUNNING") {
    const recent = bingo.lastTaken && now - bingo.lastTaken.at < 8000 ? bingo.lastTaken.cell : undefined;
    return <main className={styles.pocket} data-testid="bingo-pocket">
      <div className={styles.numbers}>
        <div><span className={styles.big} data-testid="bingo-count">{taken.size}<small>/{group.cells.length}</small></span><span>{text.cells}</span></div>
        <div><span className={styles.big}>{formatBingoTime(seconds)}</span><span>{text.time}</span></div>
        <div><span className={styles.big}>{formatBingoDistance(run.run.distanceM)}</span><span>{text.distance}</span></div>
      </div>
      <p className={styles.status} role="status">
        {recent ? <strong>{text.taken(recent)}</strong> : problem ?? (bingo.accuracy !== undefined ? text.gps(bingo.accuracy) : text.waitingGps)}
        {" · "}{unsent ? text.unsent : text.saved}
      </p>
      {bingo.gapNotice && <p className={styles.gap} role="alert">{text.gap(formatBingoGap(bingo.gapNotice, run.startedAt))}</p>}
      {bingo.resumed && <p className={styles.gap}>{text.resumed}</p>}
      {bingo.wakeLockFailed && <p className={styles.gap}>{text.wakeLockFailed}</p>}
      {bingo.storageFailed && <p className={styles.gap} role="alert">{text.storageFailed}</p>}
      <BingoCard group={group} taken={taken} dark label={text.result(taken.size, group.cells.length)} />
      <div className={styles.holds}>
        <HoldButton label={text.finish} hold={text.hold} confirmText={`${text.finish}?`} onDone={() => bingo.end("FINISHED")} testId="bingo-finish" />
        <HoldButton label={text.abandon} hold={text.hold} confirmText={`${text.abandon}?`} onDone={() => bingo.end("ABANDONED")} testId="bingo-abandon" />
      </div>
      <BingoBoard board={board} only={group.course} dark mine={run.name} />
    </main>;
  }

  return <main className={styles.page} data-testid="bingo-done">
    <h1>{run.status === "FINISHED" ? text.finished : text.abandoned}</h1>
    <p className={styles.kicker}>{title} · {group.name}</p>
    <div className={styles.result}>
      <div><strong data-testid="bingo-result">{text.result(taken.size, group.cells.length)}</strong></div>
      <div>{text.time} {formatBingoTime(seconds)}</div>
      <div>{text.distance} {formatBingoDistance(run.run.distanceM)}</div>
    </div>
    <p className={styles.muted} role="status">{unsent ? text.unsent : text.saved}</p>
    <h2>{text.mapTitle}</h2>
    <BingoMap group={group} taken={taken} tracks={[{ id: run.runnerId, points: run.run.track, color: "#d0021b" }]} label={text.mapTitle}
      image={image ? { ...image, href: `/api/public/races/${encodeURIComponent(raceId)}/map` } : undefined} />
    <BingoCard group={group} taken={taken} label={text.result(taken.size, group.cells.length)} />
    <BingoBoard board={board} mine={run.name} />
    {blocked && <Notice tone="error" role="alert">{text.againBlocked}</Notice>}
    <Button variant="secondary" onClick={() => {
      if (forgetBingoRun(raceId, run)) { setBlocked(false); bingo.reset(); } else { setBlocked(true); void bingo.sync(); }
    }} data-testid="bingo-again">{text.again}</Button>
  </main>;
}
