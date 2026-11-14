"use client";

import { useState } from "react";
import { mapProjectRectifyEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import type { WarpKind } from "@o-tid/map-revision";
import type { BoxArea } from "../../lib/map-project-area-box";
import { residualMeters } from "../../lib/map-project-control-points";
import { mapSavedChoiceEn } from "../../i18n/map-knolls-en";
import { mapSavedChoiceSv } from "../../i18n/map-knolls-sv";
import { mapProjectRectifySv } from "../../i18n/map-project-rectify-sv";
import { Button } from "../ui";
import type { useMapProjectRectify } from "./use-map-project-rectify";
import styles from "./map-project-editor.module.css";

type Area = BoxArea & { areaId: string };
const KINDS: readonly WarpKind[] = ["similarity", "affine", "rubber"];

/** ADR-0219 K6b: passpunkterna för hela kartan i sidopanelen: sätt punkter, välj sätt och område, räkna fram och föreslå. */
export function MapProjectRectifyPanel({ rectify, areas, scale }: { rectify: ReturnType<typeof useMapProjectRectify>; areas: readonly Area[]; scale: number }) {
  const text = useTexts(mapProjectRectifySv, mapProjectRectifyEn);
  const [where, setWhere] = useState("");
  const [laserJob, setLaserJob] = useState("");
  const shared = useTexts(mapSavedChoiceSv, mapSavedChoiceEn);
  if (!rectify.canPropose) return null;
  const area = areas.find(row => row.areaId === where);
  const outline = area?.polygon[0];
  const within = outline && outline.length >= 3 ? { minX: Math.min(...outline.map(p => p.x)), maxX: Math.max(...outline.map(p => p.x)),
    minY: Math.min(...outline.map(p => p.y)), maxY: Math.max(...outline.map(p => p.y)) } : undefined;
  const fit = rectify.fit, result = rectify.result;
  const planned = result ? rectify.edits() : undefined;
  const moved = result?.changes.map(change => residualMeters(change.moved, scale)) ?? [];
  const choices = rectify.laserChoices;
  return <details className={styles.settings} data-testid="map-project-rectify" onToggle={event => { if (event.currentTarget.open) void rectify.loadJobs(); }}>
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {/* Ägaren 2026-11-14: passpunkterna kan sökas ur lasern (kartans höjdkurvor mot markens höjd) i stället för att klickas. */}
    {rectify.canLaser && <>
      <h4>{text.laser.heading}</h4>
      <p className={styles.muted}>{text.laser.help}</p>
      {choices && choices.length === 0 ? <p className={styles.muted}>{text.laser.none}</p> : choices && <>
        <label>{text.laser.job}<select value={laserJob || choices[0]!.id} onChange={event => setLaserJob(event.target.value)}>
          {choices.map(row => <option key={row.id} value={row.id}>{row.stages ? shared.allStages(row.stages.base, row.stages.total) : row.jobs[0]!.name}</option>)}
        </select></label>
        <span className={styles.actions}><Button variant="secondary" disabled={!!rectify.busy} onClick={() => void rectify.fromLaser(laserJob || choices[0]!.id)}
          data-testid="map-project-rectify-laser">{text.laser.run}</Button></span>
      </>}
    </>}
    <span className={styles.actions}>
      {rectify.picking ? <Button variant="secondary" onClick={rectify.stop}>{text.stop}</Button>
        : <Button variant="secondary" onClick={rectify.start} data-testid="map-project-rectify-start">{text.start}</Button>}
      <Button variant="secondary" disabled={!rectify.pending && rectify.pairs.length === 0} onClick={rectify.undo}>{text.undo}</Button>
      <Button variant="quiet" disabled={rectify.pairs.length === 0} onClick={rectify.clear}>{text.clear}</Button>
    </span>
    {rectify.picking && <p aria-live="polite" data-testid="map-project-rectify-hint">{rectify.pending ? text.hintTo : text.hintFrom}</p>}
    {rectify.pairs.length === 0 ? <p className={styles.muted}>{text.none}</p> : <ol className={styles.rows} data-testid="map-project-rectify-list">
      {rectify.pairs.slice(0, 12).map((_, index) => <li key={index}>
        {text.point(index + 1, fit?.residuals[index] !== undefined ? text.residual(residualMeters(fit.residuals[index], scale)) : "–")}{" "}
        <Button variant="quiet" aria-label={text.removePoint(index + 1)} onClick={() => rectify.remove(index)}>×</Button>
      </li>)}
      {rectify.pairs.length > 12 && <li className={styles.muted}>{text.morePoints(rectify.pairs.length - 12)}</li>}
    </ol>}
    <fieldset className={styles.fieldset}>
      <legend>{text.kind}</legend>
      {KINDS.map(kind => <label key={kind} className={styles.check}><input type="radio" name="rectify-kind" checked={rectify.kind === kind}
        disabled={kind !== "similarity" && rectify.pairs.length < 3} onChange={() => rectify.choose(kind)} />{text.kinds[kind]}</label>)}
    </fieldset>
    {fit && <p data-testid="map-project-rectify-fit">{text.fit(fit.kind, residualMeters(fit.rms, scale))}</p>}
    <label>{text.where}<select value={where} onChange={event => setWhere(event.target.value)}>
      <option value="">{text.whole}</option>
      {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
    </select></label>
    <span className={styles.actions}>
      <Button variant="secondary" disabled={!fit || !!rectify.busy} onClick={() => rectify.preview(within)} data-testid="map-project-rectify-preview">
        {text.preview}</Button>
    </span>
    {result && planned && <div role="status" data-testid="map-project-rectify-result">
      <p>{text.summary(result.changes.length, moved.length ? moved.reduce((sum, value) => sum + value, 0) / moved.length : 0, Math.max(0, ...moved))}</p>
      {planned.skipped > 0 && <p className={styles.muted}>{text.skipped(planned.skipped)}</p>}
      {planned.edits.length > 0 && <span className={styles.actions}>
        {rectify.canApply && <Button disabled={!!rectify.busy} onClick={rectify.apply} data-testid="map-project-rectify-apply">{text.apply(result.changes.length)}</Button>}
        <Button variant={rectify.canApply ? "secondary" : "primary"} disabled={!!rectify.busy} onClick={() => void rectify.propose()} data-testid="map-project-rectify-propose">{text.propose(planned.edits.length)}</Button>
      </span>}
    </div>}
    {rectify.busy && <p role="status" className={styles.muted}>{rectify.busy}</p>}
    {rectify.message && <p role={rectify.message.tone === "ok" ? "status" : "alert"}
      className={rectify.message.tone === "ok" ? styles.muted : styles.problem} data-testid="map-project-rectify-message">{rectify.message.text}</p>}
  </details>;
}
