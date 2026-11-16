"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BingoLeaderboard, VirtualCourseView, VirtualSettings } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { forgetBingoRun, formatBingoDistance, formatBingoTime, readBingoName, saveBingoName } from "../../lib/bingo-run";
import { useTexts } from "../language-provider";
import { Button, Notice } from "../ui";
import { BingoBoard, useBingoBoard } from "./bingo-board";
import { BingoGuide } from "./bingo-guide";
import { HoldButton, useNow } from "./bingo-hold";
import { useVirtualRun } from "./use-virtual-run";
import { VirtualControlsView, type ControlState, type VirtualMapImage } from "./virtual-controls-view";
import styles from "./bingo.module.css";

const DUEL = /^[A-Z0-9]{2,12}$/;

/**
 * Löparens sida med virtuella kontroller (ADR-0226): namn, bana, valfri duell och lag, instruktionen och Starta; under loppet
 * fickläget med banans kontroller (utan karta och position), notiser när någon annan i duellen tar en kontroll, och efter
 * målgången mellantiderna, kartan med spåret och topplistan.
 */
export function VirtualRunner({ raceId, title, courses, settings, georeference, mapScale, image, initialBoard }: {
  raceId: string; title: string; courses: readonly VirtualCourseView[]; settings: VirtualSettings; georeference: MapGeoreference | null; mapScale: number;
  image: Omit<VirtualMapImage, "href"> | null; initialBoard: BingoLeaderboard;
}) {
  const text = useTexts(bingoSv.runner, bingoEn.runner);
  const vk = useTexts(bingoSv.virtual, bingoEn.virtual);
  const virtual = useVirtualRun({ raceId, courses, settings, georeference, mapScale });
  const board = useBingoBoard(raceId, initialBoard, virtual.run?.acked);
  const run = virtual.run;
  const now = useNow(run?.status === "RUNNING");
  const [name, setName] = useState("");
  const [course, setCourse] = useState<string>();
  const [duel, setDuel] = useState("");
  const [team, setTeam] = useState("");
  const [guide, setGuide] = useState(false);
  const [help, setHelp] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => setName(readBingoName()), []);

  // Duellen: vem som tog vilken kontroll först (min sida = mitt lag) och notiserna när någon annan tar en.
  const myTeam = run?.team ?? run?.name;
  const myDuel = run?.duel ? board.duels?.find(item => item.code === run.duel) : undefined;
  const states = useMemo(() => {
    const out = new Map<string, ControlState>();
    for (const item of myDuel?.taken ?? []) if (item.place === 1) out.set(item.control, item.team === myTeam ? "MINE" : "OTHER");
    for (const punch of virtual.judged) out.set(punch.control, "MINE");
    return out;
  }, [myDuel, myTeam, virtual.judged]);
  const seen = useRef<number | undefined>(undefined);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    const others = (myDuel?.taken ?? []).filter(item => item.team !== myTeam && item.points > 0);
    const latest = Math.max(0, ...others.map(item => item.at));
    if (seen.current !== undefined && latest > seen.current) {
      const item = others.find(entry => entry.at === latest)!;
      setNotice(vk.took(item.runner, item.code, item.points));
      virtual.ping();
    }
    seen.current = latest;
  }, [myDuel, myTeam, vk, virtual]);

  if (!run || !virtual.view) {
    const trimmed = name.trim(), code = duel.trim().toUpperCase();
    const duelOk = code === "" || DUEL.test(code);
    const ready = trimmed && course && duelOk && georeference !== null && courses.length > 0;
    const go = () => { saveBingoName(trimmed); virtual.start(trimmed.slice(0, 60), course!, code || undefined, team.trim().slice(0, 60) || undefined); };
    return <main className={styles.page} data-testid="virtual-signup">
      <h1>{vk.title}</h1>
      <p className={styles.kicker}>{title}</p>
      <p>{vk.intro}</p>
      {!georeference && <Notice tone="error" role="alert">{text.noGeoreference}</Notice>}
      {courses.length === 0 && <Notice tone="error" role="alert">{text.noGroups}</Notice>}
      {guide && ready ? <>
        <BingoGuide mode="CONTROLS" action={<Button className={styles.start} onClick={go} data-testid="bingo-understood">{text.understood}</Button>} />
        <Button variant="quiet" onClick={() => setGuide(false)}>{text.back}</Button>
      </> : <form className={styles.signup} onSubmit={event => { event.preventDefault(); if (ready) setGuide(true); }}>
        <label className={styles.field}>{text.name}
          <input type="text" value={name} maxLength={60} autoComplete="given-name" required onChange={event => setName(event.target.value)}
            data-testid="bingo-runner-name" /><span className={styles.muted}>{text.nameHelp}</span></label>
        <fieldset className={styles.groups} disabled={!trimmed}>
          <legend>{vk.course}</legend>
          {courses.map(item => <label key={item.course} className={styles.groupChoice}>
            <input type="radio" name="virtual-course" value={item.course} checked={course === item.course} onChange={() => setCourse(item.course)} />
            <span><strong>{item.name}</strong> <span className={styles.muted}>
              {vk.courseLine(item.controls.filter(control => control.kind === "CONTROL").length, item.order)}</span></span>
          </label>)}
        </fieldset>
        <label className={styles.field}>{vk.duel}
          <input type="text" value={duel} maxLength={12} autoCapitalize="characters" onChange={event => setDuel(event.target.value.toUpperCase())}
            aria-invalid={!duelOk || undefined} data-testid="virtual-duel" />
          <span className={styles.muted} role={duelOk ? undefined : "alert"}>{duelOk ? vk.duelHelp : vk.duelInvalid}</span></label>
        {duel.trim() && <label className={styles.field}>{vk.team}
          <input type="text" value={team} maxLength={60} onChange={event => setTeam(event.target.value)} data-testid="virtual-team" />
          <span className={styles.muted}>{vk.teamHelp}</span></label>}
        <Button type="submit" className={styles.start} disabled={!ready} data-testid="bingo-start">{text.start}</Button>
      </form>}
      <BingoBoard board={board} />
    </main>;
  }

  const view = virtual.view;
  const total = view.controls.filter(control => control.kind === "CONTROL").length;
  const taken = virtual.judged.filter(punch => view.controls.find(control => control.id === punch.control)?.kind === "CONTROL");
  const points = myDuel ? myDuel.teams.find(item => item.team === myTeam)?.points ?? 0 : taken.reduce((sum, punch) => sum + punch.points, 0);
  const showPoints = view.order === "SCORE" || Boolean(run.duel);
  const seconds = ((run.finishedAt ?? now) - run.startedAt) / 1000;
  const unsent = run.acked < run.version;
  const last = virtual.lastPunch;
  const message = last && now - last.at < 10_000 ? "code" in last ? vk.punched(last.code) : vk.missed(last.accuracy) : notice;

  if (run.status === "RUNNING") {
    if (help) return <main className={styles.pocket}><BingoGuide mode="CONTROLS" dark action={<button type="button" className={styles.fire}
      onClick={() => setHelp(false)}>{text.close}</button>} /></main>;
    return <main className={styles.pocket} data-testid="bingo-pocket">
      <button type="button" className={styles.helpButton} aria-label={text.help} onClick={() => setHelp(true)}>?</button>
      <div className={styles.numbers}>
        <div><span className={styles.big} data-testid="virtual-count">{taken.length}<small>/{total}</small></span><span>{vk.controls}</span></div>
        {showPoints && <div><span className={styles.big} data-testid="virtual-points">{points}</span><span>{vk.points}</span></div>}
        <div><span className={styles.big}>{formatBingoTime(seconds)}</span><span>{text.time}</span></div>
      </div>
      {message && <p className={styles.notice} role="alert" data-testid="virtual-message">{message}</p>}
      {virtual.problem && <p className={styles.gap} role="alert">{text[virtual.problem]}</p>}
      {virtual.restartGps && <button type="button" className={styles.fire} onClick={virtual.restartGps} data-testid="bingo-restart-gps">{text.restartGps}</button>}
      <VirtualControlsView course={view} states={states} dark label={vk.legend} />
      <p className={styles.status}>{vk.legend}</p>
      {settings.punch === "BUTTON" ? virtual.stamping ? <p className={styles.status} role="status">{vk.stamping}</p>
        : <button type="button" className={styles.fire} onClick={() => void virtual.stamp()} data-testid="virtual-stamp">{vk.stamp}</button>
        : <p className={styles.status}>{virtual.inApp ? vk.autoApp : vk.auto}</p>}
      <p className={virtual.gps.ready ? styles.gpsOk : styles.status} role="status">
        {virtual.gps.accuracy !== undefined ? text.gps(virtual.gps.accuracy) : text.waitingGps} · {unsent ? text.unsent : text.saved}</p>
      {virtual.storageFailed && <p className={styles.gap} role="alert">{text.storageFailed}</p>}
      <div className={styles.holds}>
        <HoldButton label={text.finish} hold={text.hold} confirmText={`${text.finish}?`} onDone={() => virtual.end("FINISHED")} testId="bingo-finish" />
        <HoldButton label={text.abandon} hold={text.hold} confirmText={`${text.abandon}?`} onDone={() => virtual.end("ABANDONED")} testId="bingo-abandon" />
      </div>
      <BingoBoard board={board} only={view.course} dark mine={run.name} />
    </main>;
  }

  return <main className={styles.page} data-testid="bingo-done">
    <h1>{run.status === "FINISHED" ? text.finished : text.abandoned}</h1>
    <p className={styles.kicker}>{title} · {view.name}</p>
    <div className={styles.result}>
      <div><strong data-testid="virtual-result">{vk.controls} {taken.length}/{total}{showPoints ? ` · ${vk.points} ${points}` : ""}</strong></div>
      <div>{text.time} {formatBingoTime(seconds)} · {text.distance} {formatBingoDistance(run.run.distanceM)}</div>
    </div>
    <p className={styles.muted} role="status">{unsent ? text.unsent : text.saved}</p>
    <h2>{vk.splits}</h2>
    <table className={styles.table}><thead><tr><th scope="col">{vk.control}</th><th scope="col">{vk.time}</th></tr></thead>
      <tbody>{virtual.judged.map(punch => <tr key={punch.control}><td>{punch.code}</td><td>{formatBingoTime(punch.fromStartMs / 1000)}</td></tr>)}</tbody></table>
    <h2>{vk.mapTitle}</h2>
    <VirtualControlsView course={view} states={states} label={vk.mapTitle} track={run.run.track} punches={virtual.judged}
      image={image ? { ...image, href: `/api/public/races/${encodeURIComponent(raceId)}/map` } : undefined} />
    <BingoBoard board={board} mine={run.name} />
    {blocked && <Notice tone="error" role="alert">{text.againBlocked}</Notice>}
    <Button variant="secondary" onClick={() => {
      if (forgetBingoRun(raceId, run)) { setBlocked(false); virtual.reset(); } else { setBlocked(true); void virtual.sync(); }
    }} data-testid="bingo-again">{text.again}</Button>
  </main>;
}
