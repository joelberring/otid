"use client";

import { useState } from "react";
import { PHOTO_CLASS_COLORS } from "@o-tid/map-revision/base-map";
import { mapPhotoFillEn } from "../../i18n/map-photo-fill-en";
import { mapPhotoFillSv } from "../../i18n/map-photo-fill-sv";
import { useLocale, useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectPhotoFill } from "./use-map-project-photo-fill";
import styles from "./map-project-editor.module.css";

/**
 * Fyll ytor ur flygbilden (ägaren 2026-11-23): välj det synliga utsnittet eller hela kartan, klassa, gå igenom utkastet på kartan
 * (kryssrutor och symbol per klass) och lägg in. «Fråga AI om osäkra rutor» kopierar ett uppdrag till ägarens Claude-samtal: O-Tid
 * anropar inte Claude, AI-kopplingens verktyg `classify_cells` visar de osäkra rutorna och tar emot svaren.
 */
export function MapProjectPhotoFillPanel({ photo, projectName, canEdit }: { photo: ReturnType<typeof useMapProjectPhotoFill>; projectName: string; canEdit: boolean }) {
  const text = useTexts(mapPhotoFillSv, mapPhotoFillEn);
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const number = (value: number, digits = 1) => value.toLocaleString(locale, { maximumFractionDigits: digits });
  const { status } = photo;
  const busy = status.kind === "busy";
  const problem = status.kind === "problem" ? (status.problem === "zoomIn" ? text.zoomIn : status.problem === "noView" ? text.noView
    : status.problem === "noPhoto" ? text.noPhoto : text.notSaved) : undefined;
  const box = photo.ranBox && `{"min_x": ${photo.ranBox.minX.toFixed(1)}, "min_y": ${photo.ranBox.minY.toFixed(1)}, "max_x": ${photo.ranBox.maxX.toFixed(1)}, "max_y": ${photo.ranBox.maxY.toFixed(1)}}`;
  async function copyPrompt() {
    if (!box) return;
    await navigator.clipboard?.writeText(text.aiPrompt(projectName, box, photo.includeGround)).then(() => setCopied(true), () => setCopied(false));
  }
  if (!canEdit) return null;
  return <details className={styles.settings} data-testid="map-project-photo-fill">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {!photo.hasPhoto ? <p className={styles.muted}>{text.noPhoto}</p> : <>
      <p className={styles.muted}>{photo.infrared ? text.infrared : text.noInfrared}</p>
      <label className={styles.check}><input type="checkbox" checked={photo.includeGround} onChange={event => photo.setIncludeGround(event.target.checked)}
        data-testid="map-project-photo-fill-ground" /> {text.includeGround}</label>
      <span className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={() => photo.run("view")} data-testid="map-project-photo-fill-view">{text.run}: {text.scopeView}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => photo.run("map")} data-testid="map-project-photo-fill-map">{text.scopeMap}</Button>
      </span>
    </>}
    {busy && <p role="status">{text.busy(status.done, status.total)}</p>}
    {problem && <p role="alert" className={styles.problem}>{problem}</p>}
    {status.kind === "committed" && <p role="status" data-testid="map-project-photo-fill-committed">{text.committed(status.count, status.cut)}</p>}
    {photo.cells.length > 0 && <>
      {status.kind === "done" && <p role="status" data-testid="map-project-photo-fill-result">{text.result(photo.cells.length, number(status.seconds), number(status.km2, 3))}</p>}
      {photo.counts.map(row => <div key={row.kind} className={styles.check}>
        <input type="checkbox" checked={row.on && !!row.symbol} disabled={!row.symbol} onChange={() => photo.toggle(row.kind)} aria-label={text.classes[row.kind]}
          data-testid={`map-project-photo-fill-class-${row.kind}`} />
        <span aria-hidden style={{ display: "inline-block", width: 14, height: 14, background: PHOTO_CLASS_COLORS[row.kind], opacity: 0.7 }} />
        <span>{text.classes[row.kind]}: {text.row(row.count, number(row.areaM2 / 10_000, 2))}</span>
        {row.options.length > 1 ? <select value={row.symbol?.id} onChange={event => photo.choose(row.kind, event.target.value)} data-testid={`map-project-photo-fill-symbol-${row.kind}`}>
          {row.options.map(symbol => <option key={symbol.id} value={symbol.id}>{symbol.code} {symbol.name}</option>)}
        </select> : row.symbol ? <small>{row.symbol.code}</small> : <small className={styles.muted}>{text.missingSymbol}</small>}
      </div>)}
      {photo.unsure > 0 && <p className={styles.muted} data-testid="map-project-photo-fill-unsure">{text.unsure(photo.unsure, photo.large)}</p>}
      <label className={styles.check}><input type="checkbox" checked={photo.takeUnsure} onChange={event => photo.setTakeUnsure(event.target.checked)} /> {text.takeUnsure}</label>
      <span className={styles.actions}>
        <Button disabled={photo.taken === 0} onClick={photo.commit} data-testid="map-project-photo-fill-commit">{text.commit(photo.taken)}</Button>
        <Button variant="quiet" onClick={photo.clear}>{text.clear}</Button>
      </span>
      {photo.unsure > 0 && box && <>
        <span className={styles.actions}><Button variant="secondary" onClick={() => void copyPrompt()} data-testid="map-project-photo-fill-ai">{text.ai}</Button></span>
        <small className={styles.muted}>{copied ? text.aiCopied : text.aiHelp}</small>
      </>}
    </>}
  </details>;
}
