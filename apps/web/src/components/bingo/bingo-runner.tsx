"use client";

import { useEffect, useRef, useState } from "react";
import type { BingoGroup, BingoLeaderboard, BingoMode } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import type { JudgedShot } from "@o-tid/domain";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { forgetBingoRun, formatBingoDistance, formatBingoGap, formatBingoTime } from "../../lib/bingo-run";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import { BingoBoard, useBingoBoard } from "./bingo-board";
import { BingoCard } from "./bingo-card";
import { HoldButton, useNow } from "./bingo-hold";
import { BingoMap, type BingoMapImage } from "./bingo-map";
import { ShipBoard, ShipFire, useShips } from "./bingo-ships";
import { BingoSignup } from "./bingo-signup";
import { useBingoRun } from "./use-bingo-run";
import styles from "./bingo.module.css";

/** De andras prickar: gruppens antal per ruta utan löparen själv (om hen har stått i rutan och skjutit). */
function othersOn(counts: Readonly<Record<string, number>> | undefined, mine: readonly JudgedShot[]): Record<string, number> {
  const own = new Set(mine.filter(shot => shot.result !== "WRONG").map(shot => shot.cell));
  return Object.fromEntries(Object.entries(counts ?? {}).map(([cell, count]) => [cell, Math.max(0, count - (own.has(cell) ? 1 : 0))]));
}

/**
 * Löparens sida (ADR-0225), Bingo eller Sänka skepp: anmälan (namn, grupp, Starta); under loppet fickläget (nästan svart,
 * stora siffror, brickan eller skottbrädet och gruppens topplista, Mål och Avbryt med långt tryck); efter målgången
 * resultatet, kartan och topplistan. Kartan och positionen visas aldrig under loppet.
 */
export function BingoRunner({ raceId, mode, title, groups, georeference, mapScale, image, initialBoard }: {
  raceId: string; mode: BingoMode; title: string; groups: readonly BingoGroup[]; georeference: MapGeoreference | null; mapScale: number;
  image: Omit<BingoMapImage, "href"> | null; initialBoard: BingoLeaderboard;
}) {
  const text = useTexts(bingoSv.runner, bingoEn.runner);
  const shipText = useTexts(bingoSv.ships, bingoEn.ships);
  const bingo = useBingoRun({ raceId, mode, groups, georeference, mapScale });
  const board = useBingoBoard(raceId, initialBoard, bingo.run?.acked);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState<{ text: string; at: number }>();
  const run = bingo.run;
  const now = useNow(run?.status === "RUNNING");
  const group = bingo.group ?? groups[0];
  const ships = useShips(group ?? { course: "", name: "", cellMeters: 0, ships: [], sharedShips: [], sharedSeed: 0, cells: [] }, run?.seed, run?.shots ?? [], bingo.metersPerMm);
  // Pling och vibration vid träff (inte för skott som fanns när sidan laddades).
  const judgedCount = ships.judged.length, lastResult = ships.judged[judgedCount - 1]?.result;
  const pinged = useRef<number | undefined>(undefined);
  const ping = bingo.ping;
  useEffect(() => {
    if (pinged.current !== undefined && judgedCount > pinged.current && (lastResult === "HIT" || lastResult === "SUNK")) ping();
    pinged.current = judgedCount;
  }, [judgedCount, lastResult, ping]);

  if (!run || !bingo.group || !group) {
    return <BingoSignup mode={mode} title={title} groups={groups} georeferenced={georeference !== null} board={board}
      onStart={(name, course) => void bingo.start(name, course)} />;
  }

  const shipsMode = run.seed !== undefined;
  const taken = new Set(run.run.taken.map(row => row.cell));
  const seconds = ((run.finishedAt ?? now) - run.startedAt) / 1000;
  const problem = bingo.problem ? text[bingo.problem] : undefined;
  const unsent = run.acked < run.version;
  const sunkCells = new Set(ships.ships.filter(ship => ship.cells.every(cell => ships.judged.some(shot => shot.cell === cell && shot.result !== "WRONG")))
    .flatMap(ship => ship.cells));

  const fire = async (cell: string) => {
    const result = await bingo.shoot(cell);
    if (!result.ok) { setMessage({ text: shipText.noPosition(result.accuracyM), at: Date.now() }); return; }
    // Tom text: beskedet är bedömningen av det senaste skottet (samma regler som servern).
    setMessage({ text: "", at: Date.now() });
  };
  const last = ships.judged[ships.judged.length - 1];
  const verdict = last && message?.text === ""
    ? last.result === "SUNK" ? shipText.sunkShip(last.cell) : last.result === "HIT" ? shipText.hit(last.cell)
      : last.result === "WATER" ? shipText.water(last.cell) : shipText.wrong(last.cell) : message?.text;

  if (run.status === "RUNNING") {
    const recent = bingo.lastTaken && now - bingo.lastTaken.at < 8000 ? bingo.lastTaken.cell : undefined;
    return <main className={styles.pocket} data-testid="bingo-pocket">
      {shipsMode ? <div className={styles.numbers}>
        <div><span className={styles.big} data-testid="ship-points">{ships.score.points}</span><span>{shipText.points}</span></div>
        <div><span className={styles.big}>{ships.score.sunk}<small>/{ships.ships.length}</small></span><span>{shipText.sunk}</span></div>
        <div><span className={styles.big}>{formatBingoTime(seconds)}</span><span>{text.time}</span></div>
      </div> : <div className={styles.numbers}>
        <div><span className={styles.big} data-testid="bingo-count">{taken.size}<small>/{group.cells.length}</small></span><span>{text.cells}</span></div>
        <div><span className={styles.big}>{formatBingoTime(seconds)}</span><span>{text.time}</span></div>
        <div><span className={styles.big}>{formatBingoDistance(run.run.distanceM)}</span><span>{text.distance}</span></div>
      </div>}
      {shipsMode ? <>
        {verdict && <p className={styles.gap} role="alert" data-testid="ship-verdict">{verdict}</p>}
        {problem && <p className={styles.gap} role="alert">{problem}</p>}
        <ShipFire aiming={bingo.aiming} now={now} onFire={fire}>
          {(selected, select) => <ShipBoard group={group} judged={ships.judged} sunkCells={sunkCells} selected={selected} onSelect={select} dark
            others={othersOn(board.groups.find(item => item.course === group.course)?.shotCells, ships.judged)}
            label={shipText.legend} />}
        </ShipFire>
        <p className={styles.status}>{shipText.legend} · {unsent ? text.unsent : text.saved}</p>
      </> : <>
        <p className={styles.status} role="status">
          {recent ? <strong>{text.taken(recent)}</strong> : problem ?? (bingo.accuracy !== undefined ? text.gps(bingo.accuracy) : text.waitingGps)}
          {" · "}{unsent ? text.unsent : text.saved}
        </p>
        {bingo.gapNotice && <p className={styles.gap} role="alert">{text.gap(formatBingoGap(bingo.gapNotice, run.startedAt))}</p>}
        {bingo.wakeLockFailed && <p className={styles.gap}>{text.wakeLockFailed}</p>}
        <BingoCard group={group} taken={taken} dark label={text.result(taken.size, group.cells.length)} />
      </>}
      {bingo.resumed && <p className={styles.gap}>{text.resumed}</p>}
      {bingo.storageFailed && <p className={styles.gap} role="alert">{text.storageFailed}</p>}
      <div className={styles.holds}>
        <HoldButton label={text.finish} hold={text.hold} confirmText={`${text.finish}?`} onDone={() => bingo.end("FINISHED")} testId="bingo-finish" />
        <HoldButton label={text.abandon} hold={text.hold} confirmText={`${text.abandon}?`} onDone={() => bingo.end("ABANDONED")} testId="bingo-abandon" />
      </div>
      <BingoBoard board={board} only={group.course} dark mine={run.name} />
    </main>;
  }

  const mapImage = image ? { ...image, href: `/api/public/races/${encodeURIComponent(raceId)}/map` } : undefined;
  return <main className={styles.page} data-testid="bingo-done">
    <h1>{run.status === "FINISHED" ? text.finished : text.abandoned}</h1>
    <p className={styles.kicker}>{title} · {group.name}</p>
    {shipsMode ? <div className={styles.result}>
      <div><strong data-testid="ship-result">{shipText.points} {ships.score.points}</strong></div>
      <div>{shipText.sunk} {ships.score.sunk}/{ships.ships.length} · {shipText.hitsColumn} {ships.score.hits} · {shipText.wrongColumn} {ships.score.wrong}</div>
      <div>{text.time} {formatBingoTime(seconds)}</div>
    </div> : <div className={styles.result}>
      <div><strong data-testid="bingo-result">{text.result(taken.size, group.cells.length)}</strong></div>
      <div>{text.time} {formatBingoTime(seconds)}</div>
      <div>{text.distance} {formatBingoDistance(run.run.distanceM)}</div>
    </div>}
    <p className={styles.muted} role="status">{unsent ? text.unsent : text.saved}</p>
    <h2>{shipsMode ? shipText.mapTitle : text.mapTitle}</h2>
    {shipsMode ? <BingoMap group={group} taken={sunkCells} image={mapImage} label={shipText.mapTitle} ships={ships.ships.filter(ship => !ship.shared).map(ship => ship.cells)}
      sharedShips={ships.ships.filter(ship => ship.shared).map(ship => ship.cells)}
      shots={ships.judged} tracks={[]} />
      : <BingoMap group={group} taken={taken} tracks={[{ id: run.runnerId, points: run.run.track, color: "#d0021b" }]} label={text.mapTitle} image={mapImage} />}
    {shipsMode ? <ShipBoard group={group} judged={ships.judged} sunkCells={sunkCells} selected={undefined} label={shipText.legend} />
      : <BingoCard group={group} taken={taken} label={text.result(taken.size, group.cells.length)} />}
    <BingoBoard board={board} mine={run.name} />
    {blocked && <Notice tone="error" role="alert">{text.againBlocked}</Notice>}
    <Button variant="secondary" onClick={() => {
      if (forgetBingoRun(raceId, run)) { setBlocked(false); setMessage(undefined); bingo.reset(); } else { setBlocked(true); void bingo.sync(); }
    }} data-testid="bingo-again">{text.again}</Button>
  </main>;
}
