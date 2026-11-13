"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GEO_JOB_MAX_TILES, newestLaserTiles, type MapProjectView } from "@o-tid/contracts";
import { LASER_SEARCH_LIMITS } from "@o-tid/map-revision";
import { mapGuideEn } from "../../i18n/map-guide-en";
import { mapGuideSv } from "../../i18n/map-guide-sv";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { estimateMinutes, GUIDE_STEPS, guideDefaultArea, guideState, laserAreaSize, latestAreaJob, type GuideStep } from "../../lib/map-project-guide";
import { CONTOUR_STYLES, defaultLaserJob, type ContourStyle } from "../../lib/map-project-laser-request";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import { LaserCredentialHint, LaserServerStatus } from "./map-project-laser-shared";
import type { useMapProjectImport } from "./use-map-project-import";
import type { LaserArea, useMapProjectLaser } from "./use-map-project-laser";
import styles from "./map-project-guide.module.css";

/**
 * Det enda guiden minns själv: vilka körningars grundkarta som lagts in i kartan från den här webbläsaren (servern vet inte
 * vilka objekt som kom ur vilken körning). Allt annat härleds ur körningarna, uppgifterna och kandidaterna.
 */
const placedKey = (projectId: string) => `otid-map-guide-placed:${projectId}`;
function readPlaced(projectId: string): readonly string[] {
  try {
    const value = JSON.parse(localStorage.getItem(placedKey(projectId)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((row): row is string => typeof row === "string") : [];
  } catch { return []; }
}
/** Kurvbilden som valdes senast för kartan (ägaren: man ska inte behöva välja varje gång). */
const contoursKey = (projectId: string) => `otid-map-guide-contours:${projectId}`;
function readContours(projectId: string): ContourStyle {
  try {
    const value = localStorage.getItem(contoursKey(projectId));
    return (CONTOUR_STYLES as readonly string[]).includes(value ?? "") ? value as ContourStyle : "normal";
  } catch { return "normal"; }
}

/**
 * Ägaren 2026-11-13 («rörigt», 27 paneler; förstod inte ordningen och fick «Området är för stort» utan att veta vad han
 * skulle göra): guiden «Ny grundkarta» överst i Underlag. Fyra steg – område, hämta och kör, vänta, granska och lägg in –
 * med en huvudknapp i taget. Den gör samma sak som laserpanelen (samma hook, `useMapProjectLaser`) med förvalen, och läget
 * härleds ur det som finns (`guideState`), så att den står rätt efter en omladdning.
 */
export function MapProjectGuide({ view, laser, importer, areas, onSplit }: { view: MapProjectView; laser: ReturnType<typeof useMapProjectLaser>;
  importer: ReturnType<typeof useMapProjectImport>; areas: readonly LaserArea[];
  /** Startar «Dela med ett streck» för delen (eller hela kartområdet); saknas för den som inte får dela. */
  onSplit: ((areaId: string | undefined) => void) | undefined }) {
  const text = useTexts(mapGuideSv, mapGuideEn);
  const laserText = useTexts(mapSourcesSv.laser, mapSourcesEn.laser);
  const jobs = laser.list?.jobs;
  // Området: det valda, annars där den senaste körningen gjordes.
  const [picked, setPicked] = useState<string>();
  const fallback = jobs ? guideDefaultArea(jobs, areas.map(row => row.areaId)) : "";
  const area = areas.find(row => row.areaId === (picked ?? fallback));
  const where = area?.areaId ?? "";
  /** Sökningen svarade med fler rutor än en körning tar (uppskattningen ur rutnätet kan vara för låg). */
  const [counted, setCounted] = useState<{ where: string; tiles: number }>();
  /** «Ny körning»: den klara körningen lämnas bakom och guiden börjar om för området. */
  const [ignore, setIgnore] = useState<string>();
  const [placed, setPlaced] = useState<readonly string[]>([]);
  useEffect(() => { setPlaced(readPlaced(view.projectId)); }, [view.projectId]);
  const [contours, setContours] = useState<ContourStyle>("normal");
  useEffect(() => { setContours(readContours(view.projectId)); }, [view.projectId]);
  const chooseContours = (style: ContourStyle) => {
    setContours(style);
    try { localStorage.setItem(contoursKey(view.projectId), style); } catch { /* utan lagring: bara den här sidan */ }
  };
  const [openChoice, setOpenChoice] = useState<boolean>();
  const [cancelling, setCancelling] = useState(false);

  const job = jobs ? latestAreaJob(jobs, area?.areaId ?? null, ignore) : undefined;
  const shown = !!job && importer.file?.name === laser.baseMapName(job);
  // Kandidaterna som visades är inlagda eller lämnade som förslag: körningen är klar för guidens del.
  const shownJob = useRef<string | undefined>(undefined);
  const { file, accepted, sent } = importer;
  const shownId = shown ? job.jobId : file && jobs?.find(row => laser.baseMapName(row) === file.name)?.jobId;
  useEffect(() => {
    if (file) { shownJob.current = shownId; return; }
    const jobId = shownJob.current;
    shownJob.current = undefined;
    if (!jobId || (accepted === undefined && sent === undefined)) return;
    setPlaced(current => {
      const next = [...current.filter(row => row !== jobId), jobId].slice(-30);
      try { localStorage.setItem(placedKey(view.projectId), JSON.stringify(next)); } catch { /* utan lagring: bara den här sidan */ }
      return next;
    });
    setOpenChoice(undefined);
  }, [shownId, file, accepted, sent, view.projectId]);

  const box = laser.boxOf(area);
  if (!view.viewer.canPropose || !box) return null;

  const message = laser.messageFor("guide");
  const size = laserAreaSize(box, laser.clipOf(area, 0), counted?.where === where ? counted.tiles : undefined);
  const tooLarge = size.tooLarge ?? (message?.code === "SOURCE_AREA_TOO_LARGE" ? "search" : undefined);
  const state = guideState({ credential: !laser.credential ? "unknown" : laser.ready ? "ready" : "missing", tooLarge, job,
    loadable: !!job && laser.baseMapFiles(job).length > 1, candidates: shown, placed: !!job && placed.includes(job.jobId) });
  const open = openChoice ?? !state.finished;
  const estimate = job && jobs && state.step === "wait" ? estimateMinutes(job, jobs) : undefined;
  const busyText = laser.busyFor("guide");

  /** Steg 2: söker laserrutorna för området och startar körningen med förvalen (det laserpanelen gör i flera klick). */
  async function run() {
    const found = await laser.search(area, "guide");
    if (!found) return;
    const tiles = newestLaserTiles(found.items);
    if (tiles.length === 0) { laser.tell("guide", "error", text.run.noTiles); return; }
    if (tiles.length > GEO_JOB_MAX_TILES) { setCounted({ where, tiles: tiles.length }); return; }
    await laser.start(defaultLaserJob(laserText.defaultName(area?.name), { tiles, clip: laser.clipOf(area), areaId: area?.areaId, extras: found.extras }, importer.sprint, contours), "guide", text.run.starting);
  }
  const restart = () => { if (job) setIgnore(job.jobId); setOpenChoice(true); laser.clear(); };

  const bodies: Record<GuideStep, ReactNode> = {
    area: <>
      <label>{text.area.label}
        <select value={where} disabled={laser.busy} onChange={event => { setPicked(event.target.value); setIgnore(undefined); laser.clear(); }} data-testid="map-project-guide-area">
          <option value="">{text.area.whole}</option>
          {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
        </select></label>
      {state.step !== "area" ? <p className={styles.muted} data-testid="map-project-guide-size">{text.area.size(size.tiles, size.km2, GEO_JOB_MAX_TILES)}</p> : <>
        <p role="alert" className={styles.problem} data-testid="map-project-guide-too-large">{tooLarge === "tiles"
          ? text.area.tooLargeTiles(area?.name, size.tiles, GEO_JOB_MAX_TILES) : text.area.tooLargeSearch(area?.name, LASER_SEARCH_LIMITS.maxAreaKm2)}</p>
        <p>{onSplit ? text.area.splitNext : text.area.splitByOwner}{!area && areas.length > 0 ? ` ${text.area.pickSmaller}` : ""}</p>
        {onSplit && <span className={styles.actions}>
          <Button onClick={() => onSplit(area?.areaId)} data-testid="map-project-guide-split">{text.split}</Button></span>}
        {tooLarge === "tiles" && <p className={styles.muted}>{text.area.manual}</p>}
      </>}
    </>,
    run: state.step !== "run" ? null : <>
      {state.detail === "checking" && <p className={styles.muted} role="status">{text.run.checking}</p>}
      {state.detail === "credential" && <div data-testid="map-project-guide-credential"><p>{text.run.credential}</p><LaserCredentialHint /></div>}
      {state.detail !== "checking" && state.detail !== "credential" && <>
        {state.detail === "failed" && <p role="alert" className={styles.problem}>{text.run.failed(job?.error ?? null)}</p>}
        {state.detail === "unusable" && <p className={styles.problem}>{text.run.unusable}</p>}
        <p>{text.run.help(area?.name)}</p>
        <p className={styles.muted}>{text.run.automatic}</p>
        <label>{text.run.contours}
          <select value={contours} disabled={laser.busy} onChange={event => chooseContours(event.target.value as ContourStyle)} data-testid="map-project-guide-contours">
            {CONTOUR_STYLES.map(style => <option key={style} value={style}>{text.run.contourStyles[style]}</option>)}
          </select></label>
        <p className={styles.muted}>{text.run.contoursHelp}</p>
        <span className={styles.actions}>
          <Button disabled={laser.busy} onClick={() => void run()} data-testid="map-project-guide-run">{state.detail === "ready" ? text.run.button : text.run.again}</Button>
        </span>
      </>}
    </>,
    wait: state.step !== "wait" || !job || !laser.list ? null : <>
      <p role="status" data-testid="map-project-guide-progress"><strong>{job.name}</strong>: {state.detail === "queued" ? text.wait.queued : text.wait.running}
        {job.progress ? ` ${text.wait.progress(job.progress.step, job.progress.done, job.progress.total)}` : ""}
        {job.status === "QUEUED" && laser.list.queue?.ahead[job.jobId] !== undefined ? ` ${text.wait.ahead(laser.list.queue.ahead[job.jobId]!)}` : ""}</p>
      <LaserServerStatus list={laser.list} testId="map-project-guide" />
      <p className={styles.muted} data-testid="map-project-guide-estimate">{estimate && text.wait.estimate(estimate.minutes, estimate.basis)}</p>
      <p>{text.wait.close}</p>
      {(job.own || view.viewer.canManage) && <span className={styles.actions}>
        {cancelling ? <>
          <span>{text.wait.cancelSure}</span>
          <Button variant="secondary" onClick={() => { setCancelling(false); void laser.remove(job, "guide"); }} data-testid="map-project-guide-cancel-yes">{text.wait.cancelYes}</Button>
          <Button variant="quiet" onClick={() => setCancelling(false)}>{text.wait.cancelNo}</Button>
        </> : <Button variant="quiet" onClick={() => setCancelling(true)} data-testid="map-project-guide-cancel">{text.wait.cancel}</Button>}
      </span>}
    </>,
    review: state.step !== "review" || !job || state.finished ? null : state.detail === "candidates" ? <>
      <p data-testid="map-project-guide-candidates">{text.review.candidates(importer.result?.objects.length ?? 0)}</p>
      <p className={styles.muted}>{text.review.adjust}</p>
      {importer.computing && <p className={styles.muted} role="status">{text.review.computing}</p>}
    </> : <>
      <p>{text.review.load(job.name)}</p>
      <span className={styles.actions}>
        <Button disabled={laser.busy} onClick={() => void laser.loadBaseMap(job, "guide")} data-testid="map-project-guide-load">{text.review.button}</Button>
        {laser.ready && <Button variant="quiet" disabled={laser.busy} onClick={restart} data-testid="map-project-guide-rerun">{text.review.restart}</Button>}
      </span>
    </>
  };

  return <section className={styles.guide} aria-labelledby="map-project-guide-heading" data-testid="map-project-guide" data-step={state.finished ? "finished" : state.step}>
    <div className={styles.head}>
      <h3 id="map-project-guide-heading">{text.heading}</h3>
      <Button variant="quiet" aria-expanded={open} aria-controls="map-project-guide-steps" onClick={() => setOpenChoice(!open)} data-testid="map-project-guide-toggle">
        {open ? text.hide : text.show}</Button>
    </div>
    {state.finished ? <>
      <p data-testid="map-project-guide-finished">{text.finished(area?.name)} <span className={styles.muted}>{text.finishedNext}</span></p>
      <span className={styles.actions}><Button variant="secondary" onClick={restart} data-testid="map-project-guide-restart">{text.restart}</Button></span>
    </> : !open && <p className={styles.muted}>{text.stepLabel(GUIDE_STEPS.indexOf(state.step) + 1, text.stepNames[state.step], text.marks.current)}</p>}
    {open && <>
      {!state.finished && <p className={styles.muted}>{text.intro}</p>}
      <ol className={styles.steps} id="map-project-guide-steps">
        {GUIDE_STEPS.map((step, index) => <li key={step} className={styles.step} data-state={state.marks[step]} data-testid={`map-project-guide-step-${step}`}
          aria-current={state.marks[step] === "current" ? "step" : undefined}>
          <span className={styles.mark} aria-hidden="true">{state.marks[step] === "done" ? "✓" : index + 1}</span>
          <div className={styles.body}>
            <span className={styles.name}>{text.stepNames[step]}<span className={styles.srOnly}> ({text.marks[state.marks[step]]})</span></span>
            {bodies[step]}
            {state.marks[step] === "current" && <>
              {busyText && <p role="status" className={styles.muted} data-testid="map-project-guide-status">{busyText}</p>}
              {message && (message.tone === "error" || step === "review") && <p role={message.tone === "ok" ? "status" : "alert"}
                className={message.tone === "ok" ? styles.muted : styles.problem} data-testid="map-project-guide-message">
                {message.tone === "ok" ? message.text : message.code && message.code in text.problems ? text.problems[message.code] : `${message.text} ${text.retry}`}</p>}
            </>}
          </div>
        </li>)}
      </ol>
    </>}
  </section>;
}
