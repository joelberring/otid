"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseSettingDocument, CourseSettingEdit } from "@o-tid/course-setting";
import { courseSettingCuttingSv as text } from "../../i18n/course-setting-cutting-sv";
import {
  bakeEdits, circleCuttingEdit, circleCuttingOf, currentDetailGaps, DETAIL_GAPS_DELAY_MS, detailRequest, type DetailGaps, type DetailResult
} from "../../lib/course-setting-circle-cutting";
import type { MapRenderSession } from "../../lib/course-setting-map-protocol";
import { Button } from "../ui";
import own from "./course-setting-circle-cutting.module.css";
import styles from "./course-setting.module.css";

/** Detaljgapen för editorn: `gaps` till `layoutOverprint`, `pending` medan Workern räknar. */
export interface DetailGapsState {
  readonly gaps: DetailGaps | undefined;
  readonly pending: boolean;
  readonly available: boolean;
}

/**
 * Ringklipp (ADR-0180 beslut 10): när "klipp över detaljer" är på räknar kartans Worker gapen för kontrollerna, en kort
 * stund efter senaste ändringen (en dragning ger många). En flyttad kontroll ritas hel tills gapen räknats om.
 */
export function useDetailGaps(session: MapRenderSession | undefined, document: CourseSettingDocument): DetailGapsState {
  const on = circleCuttingOf(document).details;
  const request = useMemo(() => on ? detailRequest(document) : undefined, [document, on]);
  const latest = useRef(request);
  latest.current = request;
  const key = request?.key;
  const [result, setResult] = useState<DetailResult & { key: string }>();
  const first = result === undefined;
  useEffect(() => {
    if (!session || !key) return;
    const timer = setTimeout(() => {
      const current = latest.current;
      if (!current) return;
      session.detailGaps(current.circles, current.sprint, gaps => setResult({ circles: current.circles, gaps, key: current.key }));
    }, first ? 0 : DETAIL_GAPS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [session, key, first]);
  // Nyckeln ändras med ringarna; samma nyckel ger samma gap (och samma objekt, så att banpåtrycket inte räknas om i onödan).
  const gaps = useMemo(() => currentDetailGaps(result, latest.current), [result, key]);
  return { gaps: on ? gaps : undefined, pending: on && session !== undefined && result?.key !== key, available: session !== undefined };
}

/** Valen för ringklipp och knappen som gör detaljklippen fasta (de följer då med till Purple Pen). */
export function CircleCuttingPanel({ document, cutting, onEdits }: {
  document: CourseSettingDocument; cutting: DetailGapsState; onEdits: (edits: readonly CourseSettingEdit[]) => void;
}) {
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
