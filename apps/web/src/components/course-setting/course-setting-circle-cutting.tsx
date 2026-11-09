"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { courseSettingCuttingEn } from "../../i18n/course-setting-notes-en";
import { useTexts } from "../language-provider";
import { numberObstaclePoints, type CourseSettingDocument, type CourseSettingEdit, type NumberObstaclesData } from "@o-tid/course-setting";
import { courseSettingCuttingSv } from "../../i18n/course-setting-cutting-sv";
import {
  bakeEdits, circleCuttingEdit, circleCuttingOf, currentDetailGaps, DETAIL_GAPS_DELAY_MS, detailRequest, type DetailGaps, type DetailResult
} from "../../lib/course-setting-circle-cutting";
import type { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { Button } from "../ui";
import own from "./course-setting-circle-cutting.module.css";
import styles from "./course-setting.module.css";

/**
 * Detaljgapen för editorn och hindren för numren (ADR-0211 beslut 4): `options` sprids in i `layoutOverprint`s val,
 * `pending` medan Workern räknar.
 */
export interface DetailGapsState {
  readonly gaps: DetailGaps | undefined;
  readonly obstacles: Readonly<Record<string, NumberObstaclesData>> | undefined;
  readonly options: { readonly detailGaps?: DetailGaps; readonly numberObstacles?: Readonly<Record<string, NumberObstaclesData>> };
  readonly pending: boolean;
  readonly available: boolean;
  /** Workern kunde inte räkna gapen (ringarna ritas hela). */
  readonly failed: boolean;
}

const pointsKey = (points: readonly { id: string; at: { x: number; y: number } }[]) => points.map(point => `${point.id}:${point.at.x.toFixed(2)},${point.at.y.toFixed(2)}`).join("|");

/**
 * Ringklipp (ADR-0180 beslut 10): när "klipp över detaljer" är på räknar kartans Worker gapen för kontrollerna, en kort
 * stund efter senaste ändringen (en dragning ger många). En flyttad kontroll ritas hel tills gapen räknats om. Samma
 * beställning ger kartans hinder för numren (alltid, när kartan finns), så att numren placeras likadant i editorn,
 * förhandsvisningen och PDF:en.
 */
export function useDetailGaps(session: MapRenderSession | undefined, document: CourseSettingDocument | null | undefined): DetailGapsState {
  const on = document ? circleCuttingOf(document).details : false;
  const request = useMemo(() => on && document ? detailRequest(document) : undefined, [document, on]);
  const points = useMemo(() => document ? numberObstaclePoints(document) : [], [document]);
  const pointKey = pointsKey(points);
  const latest = useRef(request);
  latest.current = request;
  const latestPoints = useRef(points);
  latestPoints.current = points;
  const key = `${request?.key ?? ""}#${pointKey}`;
  const [result, setResult] = useState<DetailResult & { key: string; failed?: boolean; obstacles: Readonly<Record<string, NumberObstaclesData>>; points: string }>();
  const first = result === undefined;
  useEffect(() => {
    if (!session || !document) return;
    const timer = setTimeout(() => {
      const current = latest.current, currentPoints = latestPoints.current;
      session.detailGaps(current?.circles ?? [], current?.sprint ?? false, (gaps, failed, obstacles) =>
        setResult({ circles: current?.circles ?? [], gaps, key: `${current?.key ?? ""}#${pointsKey(currentPoints)}`, failed, obstacles, points: pointsKey(currentPoints) }), currentPoints);
    }, first ? 0 : DETAIL_GAPS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [session, key, first, Boolean(document)]);
  // Nyckeln ändras med ringarna; samma nyckel ger samma gap (och samma objekt, så att banpåtrycket inte räknas om i onödan).
  const gaps = useMemo(() => currentDetailGaps(result, latest.current), [result, key]);
  const shown = on ? gaps : undefined;
  // Hindren gäller bara när kontrollerna ligger kvar där de låg när de räknades.
  const obstacles = result && result.points === pointKey ? result.obstacles : undefined;
  const options = useMemo(() => ({ ...(shown ? { detailGaps: shown } : {}), ...(obstacles ? { numberObstacles: obstacles } : {}) }), [shown, obstacles]);
  return { gaps: shown, obstacles, options, pending: on && session !== undefined && result?.key !== key, available: session !== undefined,
    failed: on && result?.failed === true };
}

/** Valen för ringklipp och knappen som gör detaljklippen fasta (de följer då med till Purple Pen). */
export function CircleCuttingPanel({ document, cutting, onEdits }: {
  document: CourseSettingDocument; cutting: DetailGapsState; onEdits: (edits: readonly CourseSettingEdit[]) => void;
}) {
  const text = useTexts(courseSettingCuttingSv, courseSettingCuttingEn);
  const choice = circleCuttingOf(document);
  const [baked, setBaked] = useState<string>();
  const set = (change: Parameters<typeof circleCuttingEdit>[1]) => { setBaked(undefined); onEdits([circleCuttingEdit(document, change)]); };
  return <section className={styles.panel} aria-labelledby="course-setting-cutting">
    <h2 id="course-setting-cutting">{text.heading}</h2>
    <label className={own.check}>
      <input type="checkbox" checked={choice.overlap} onChange={event => set({ overlap: event.target.checked })} data-testid="cutting-overlap" />
      <span>{text.overlap}<small>{text.overlapHelp}</small></span>
    </label>
    <label className={own.check}>
      <input type="checkbox" checked={choice.details} onChange={event => set({ details: event.target.checked })} data-testid="cutting-details" />
      <span>{text.details}<small>{text.detailsHelp}</small></span>
    </label>
    {choice.details && !cutting.available && <p className={styles.muted}>{text.noMap}</p>}
    {choice.details && cutting.pending && <p role="status" className={styles.muted}>{text.computing}</p>}
    {choice.details && cutting.failed && <p role="alert" className={styles.muted}>{text.failed}</p>}
    {choice.details && cutting.available && <div className={styles.row}>
      <Button variant="secondary" disabled={cutting.pending || !cutting.gaps} title={text.bakeHelp} data-testid="cutting-bake"
        onClick={() => {
          const { edits, controls } = bakeEdits(document, cutting.gaps);
          if (edits.length > 0) onEdits(edits);
          setBaked(text.baked(controls));
        }}>{text.bake}</Button>
    </div>}
    {baked && <p role="status" className={styles.muted}>{baked}</p>}
  </section>;
}
