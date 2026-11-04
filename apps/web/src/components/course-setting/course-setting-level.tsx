"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  assessLevel, harderThan, levelChecks, levelDeviations, levelRank, type CourseCheck, type CourseSettingDocument, type CourseSettingEdit,
  type LevelAssessment, type LevelRank
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { courseSettingLevelSv as text } from "../../i18n/course-setting-level-sv";
import { levelGuideArticle } from "../../i18n/help-course-setting-sv";
import { LEVEL_COLORS, levelCheckText, levelRequest, levelRows, levelSignature, levelSprint, type LevelRow } from "../../lib/course-setting-level";
import { safely } from "../../lib/course-setting-safely";
import { toScreen, type Viewport } from "../../lib/course-setting-viewport";
import type { RouteChoiceSession } from "../../lib/route-choice-client";
import type { LevelMeasured } from "../../lib/route-choice-worker-protocol";
import { HelpLink } from "../help/help-panel";
import { Button } from "../ui";
import styles from "./course-setting-level.module.css";
import base from "./course-setting.module.css";

/**
 * Nivåstödet (ADR-0212) i editorn. Bara på begäran: "Bedöm nivån" (vald bana) och "Bedöm alla banor" räknar i vägvalens
 * Worker (samma motor och tabell som vägvalen), resultatet sparas per bana med en signatur och blir "Inaktuell – bedöm
 * igen" när banan, kontrollerna, beskrivningarna, spärrarna eller kartan ändras. Inget räknas om av sig självt.
 *
 * `useLevelStore` hålls tidigt i editorn (Varningar och kartan behöver resultatet); `useLevelSupport` startar körningarna
 * när vägvalens Worker är klar.
 */
interface Stored { readonly signature: string; readonly measured: LevelMeasured; readonly assessment: LevelAssessment }

export function useLevelStore({ document, mapSha256 }: { document: CourseSettingDocument; mapSha256: string | undefined }) {
  const [results, setResults] = useState<ReadonlyMap<string, Stored>>(new Map());
  const [wanted, setWanted] = useState(false);
  const [highlight, setHighlight] = useState<{ key: string; points: readonly { kind: string; at: Point }[] }>();
  /** Signaturen för banorna som har ett resultat (för att se om det är aktuellt). */
  const signatures = useMemo(() => new Map([...results.keys()].map(course => [course,
    document.courses.some(row => row.id === course) ? safely("Nivåstödet", () => levelSignature(levelRequest(document, course), mapSha256), () => "") : ""])),
  [document, results, mapSha256]);
  const fresh = useCallback((course: string) => {
    const stored = results.get(course);
    return stored && stored.signature === signatures.get(course) ? stored : undefined;
  }, [results, signatures]);
  // ADR-0212: avvikelserna som notiser bara med "Visa avvikelser mot nivån i Varningar" och ett aktuellt resultat.
  const checks = useMemo<CourseCheck[]>(() => !document.event.levelNotices ? [] : [...results.keys()].flatMap(course => {
    const stored = fresh(course);
    return stored ? safely("Nivåstödet", () => levelChecks(document, course, stored.assessment), () => []) : [];
  }), [document, results, fresh]);
  const checkText = useCallback((check: Extract<CourseCheck, { kind: "LEVEL_DEVIATION" }>) =>
    levelCheckText(document, check, fresh(check.course)?.assessment), [document, fresh]);
  const save = useCallback((course: string, value: Stored) => setResults(current => new Map(current).set(course, value)), []);
  /** En bedömning räknas i vägvalens Worker (varningarnas vägval väntar då). */
  const [running, setRunning] = useState(false);
  return { results, fresh, checks, checkText, save, wanted, setWanted, highlight, setHighlight, running, setRunning };
}

export type LevelStore = ReturnType<typeof useLevelStore>;

/** Märkena på kartan för vald bana (små och dämpade) och förslagen som visas. */
export function drawLevelMarks(ctx: CanvasRenderingContext2D, view: Viewport, document: CourseSettingDocument, assessment: LevelAssessment | undefined,
  highlight: LevelStore["highlight"], show: boolean): void {
  const at = (point: Point) => toScreen(view, point);
  const mark = (point: Point, rank: LevelRank, size: number) => {
    const colors = LEVEL_COLORS[rank];
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
    ctx.fillStyle = colors.fill;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colors.border;
    ctx.stroke();
  };
  ctx.save();
  if (show && assessment) {
    const offset = Math.max(10, 4 * view.pxPerMm);
    for (const item of assessment.controls) {
      const point = document.controls[item.features.control]?.at;
      if (point) { const p = at(point); mark({ x: p.x + offset * 0.7, y: p.y - offset * 0.7 }, item.verdict.rank, 5); }
    }
    for (const item of assessment.legs) {
      const a = document.controls[item.features.from]?.at, b = document.controls[item.features.to]?.at;
      if (a && b) mark(at({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), item.verdict.rank, 4);
    }
  }
  for (const point of highlight?.points ?? []) {
    const p = at(point.at);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(9, 1.2 * view.pxPerMm), 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255, 196, 0, 0.9)";
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#1a1a1a";
    ctx.stroke();
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "#1a1a1a";
    const label = text.candidates[point.kind as keyof typeof text.candidates] ?? "";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText(label, p.x + 12, p.y - 10);
    ctx.fillText(label, p.x + 12, p.y - 10);
  }
  ctx.restore();
}

/** Körningen: en bana i taget ur kön, när vägvalens Worker är ledig; avbryts den av vald sträcka tar den vid igen. */
export function useLevelSupport({ store, document, view, mapSha256, hasMap, session, ready, failed, busy, record }: {
  store: LevelStore; document: CourseSettingDocument; view: string; mapSha256: string | undefined; hasMap: boolean;
  session: RefObject<RouteChoiceSession | undefined>; ready: boolean; failed: boolean; busy: boolean;
  record: (key: string, best: number | undefined, straight: number) => void;
}) {
  const [queue, setQueue] = useState<readonly string[]>([]);
  const [running, setRunning] = useState<{ course: string; done: number; total: number }>();
  const [error, setError] = useState(false);
  const runningRef = useRef<string | undefined>(undefined);
  const documentRef = useRef(document);
  documentRef.current = document;
  useEffect(() => {
    if (!failed || (queue.length === 0 && !running)) return;
    setQueue([]); setRunning(undefined); runningRef.current = undefined; setError(true);
  }, [failed]);
  useEffect(() => { store.setRunning(running !== undefined); }, [running !== undefined]);
  useEffect(() => {
    if (!ready || failed || busy || runningRef.current || queue.length === 0) return;
    const worker = session.current;
    if (!worker) return;
    const course = queue[0]!;
    const current = documentRef.current;
    if (!current.courses.some(row => row.id === course)) { setQueue(list => list.slice(1)); return; }
    const request = levelRequest(current, course);
    const signature = levelSignature(request, mapSha256);
    runningRef.current = course;
    setRunning({ course, done: 0, total: request.legs.length });
    const finish = () => { runningRef.current = undefined; setRunning(undefined); };
    worker.level(request, message => { record(message.key, message.best, message.straight); setRunning({ course, done: message.done, total: message.total }); },
      measured => {
        const assessment = assessLevel(measured.controls, measured.legs);
        store.save(course, { signature, measured, assessment });
        finish();
        setQueue(list => list.filter(id => id !== course));
      },
      () => { finish(); setQueue([]); setError(true); },
      // Vald sträcka gick före: banan står kvar först i kön och räknas när Workern är ledig (redan räknade sträckor sparas i Workern).
      () => finish());
  }, [ready, failed, busy, queue, running]);
  const assess = (courses: readonly string[]) => {
    if (courses.length === 0) return;
    setError(false);
    store.setWanted(true);
    setQueue(list => [...list, ...courses.filter(id => !list.includes(id))]);
  };
  const course = document.courses.find(row => row.id === view);
  const assessable = [...document.courses].sort((a, b) => a.order - b.order).map(row => row.id);
  return { queue, running, error, assess, course, assessable, hasMap };
}

export type LevelSupport = ReturnType<typeof useLevelSupport>;

/** "Bedöm alla banor" i fliken Banor. */
export function LevelAllButton({ support }: { support: LevelSupport }) {
  if (!support.hasMap || support.assessable.length < 2) return null;
  return <div className={base.row}>
    <Button variant="secondary" data-testid="course-setting-level-all" disabled={support.running !== undefined}
      onClick={() => support.assess(support.assessable)}>{text.panel.assessAll}</Button>
  </div>;
}

function Badge({ rank }: { rank: LevelRank }) {
  return <span className={styles.badge} data-rank={rank} aria-label={text.panel.badge(text.rankName(rank))}>{text.rankName(rank)}</span>;
}

/** Resultatpanelen för vald bana i fliken Banor (i telefonen i bladet nertill). */
export function LevelPanel({ store, support, document, readOnly, onEdits, onShow }: {
  store: LevelStore; support: LevelSupport; document: CourseSettingDocument; readOnly: boolean; onEdits: (edits: CourseSettingEdit[]) => void;
  onShow: (row: LevelRow) => void;
}) {
  const [only, setOnly] = useState(false);
  const course = support.course;
  const stored = course ? store.results.get(course.id) : undefined;
  const fresh = course ? store.fresh(course.id) : undefined;
  const target = course?.level;
  const rows = useMemo(() => stored ? safely("Nivåstödet", () => levelRows(document, stored.assessment, target), () => []) : [], [document, stored, target]);
  if (!course) return null;
  const running = support.running?.course === course.id ? support.running : undefined;
  const queued = support.queue.includes(course.id) && !running;
  const sprint = stored?.measured.notApplicable === "SPRINT" || levelSprint(document);
  const shown = only ? rows.filter(row => row.deviation) : rows;
  const deviations = target && stored ? levelDeviations(stored.assessment, target) : [];
  const easier = deviations.filter(row => row.deviation.direction === "EASIER").length;
  const harder = stored ? harderThan(stored.assessment, target ? levelRank(target) : stored.assessment.typical) : undefined;
  const compare = target ? text.levelName(target) : stored ? text.rankName(stored.assessment.typical) : "";
  return <section className={base.panel} aria-labelledby="course-setting-level" data-testid="course-setting-level">
    <h2 id="course-setting-level">{text.panel.heading}</h2>
    <p className={base.muted}>{text.panel.support} <HelpLink article={levelGuideArticle(target)} label={text.field.guide(target)} /></p>
    <p className={base.muted} data-testid="course-setting-level-target">{target ? text.panel.target(text.levelName(target)) : text.panel.noTarget}</p>
    {!support.hasMap ? <p className={base.muted}>{text.panel.noMap}</p> : sprint ? <p className={base.muted} data-testid="course-setting-level-sprint">{text.panel.sprint}</p> : <>
      <div className={base.row}>
        <Button variant={stored ? "secondary" : "primary"} disabled={running !== undefined || queued} data-testid="course-setting-level-assess"
          onClick={() => support.assess([course.id])}>{stored ? text.panel.again : text.panel.assess}</Button>
        {running && <span role="status" className={base.muted}>{text.panel.running(running.done, running.total)}</span>}
        {queued && <span role="status" className={base.muted}>{text.panel.waiting}</span>}
        {stored && !fresh && !running && <span className={styles.stale} data-testid="course-setting-level-stale">{text.panel.stale}</span>}
      </div>
      {support.error && <p role="alert" className={base.muted}>{text.panel.failed}</p>}
      {course.kind === "SCORE" && <p className={base.muted}>{text.panel.score}</p>}
      {stored && <>
        <p role="status" data-testid="course-setting-level-summary" data-stale={!fresh || undefined}><strong>
          {rows.length === 0 ? text.panel.empty : text.panel.summary(text.rankName(stored.assessment.typical),
            text.rankName(stored.assessment.low), text.rankName(stored.assessment.high))}</strong>
          {rows.length > 0 && harder && <> {text.panel.harder(harder.legs, harder.controls, compare)}</>}
          {easier > 0 && target && <> {text.panel.easier(easier, text.levelName(target))}</>}</p>
        {target && !readOnly && <label className={base.inline}>
          <input type="checkbox" checked={Boolean(document.event.levelNotices)} data-testid="course-setting-level-notices"
            onChange={event => onEdits([{ type: "SET_EVENT", changes: { levelNotices: event.target.checked } }])} />{text.panel.notices}</label>}
        {target && document.event.levelNotices && <p className={base.muted}>{text.panel.noticesHelp}</p>}
        {rows.length > 0 && <details className={styles.details} open>
          <summary>{text.panel.details(rows.length)}</summary>
          {target && <label className={base.inline}><input type="checkbox" checked={only} onChange={event => setOnly(event.target.checked)} />
            {text.panel.onlyDeviations}</label>}
          <ul className={styles.rows}>{shown.slice(0, 200).map(row => <Row key={row.key} row={row} store={store} onShow={onShow} />)}</ul>
        </details>}
      </>}
      <p className={base.muted}>{text.panel.measures}</p>
    </>}
  </section>;
}

function Row({ row, store, onShow }: { row: LevelRow; store: LevelStore; onShow: (row: LevelRow) => void }) {
  const highlighted = store.highlight?.key === row.key;
  return <li className={styles.item} data-testid="course-setting-level-row" data-kind={row.kind} data-rank={row.rank}
    data-deviation={row.deviation?.direction}>
    <div className={styles.head}><Badge rank={row.rank} /><span><strong>{row.label}</strong>: {row.reason}</span></div>
    {row.deviation && <p className={styles.tag}>{row.deviation.direction === "HARDER" ? text.panel.harderTag : text.panel.easierTag}</p>}
    {row.tip && <p className={styles.tip} data-testid="course-setting-level-tip"><strong>{text.panel.tip}:</strong> {row.tip}</p>}
    <div className={base.row}>
      <Button variant="quiet" onClick={() => onShow(row)}>{text.panel.show}</Button>
      {row.candidates.length > 0 && <Button variant="quiet" aria-pressed={highlighted}
        onClick={() => { store.setHighlight(highlighted ? undefined : { key: row.key, points: row.candidates }); if (!highlighted) onShow(row); }}>
        {highlighted ? text.panel.hideSuggest : text.panel.suggest}</Button>}
    </div>
  </li>;
}
