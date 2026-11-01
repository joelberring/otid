"use client";

import { useState } from "react";
import { offlineSv as text } from "../../i18n/course-setting-offline-sv";
import { filterInspectionRows, type InspectionFilter, type InspectionRow } from "../../lib/course-setting-inspections";
import type { StoredMapInfo } from "../../lib/course-setting-offline";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

/** Steg 67: kontrollerna i banan som visas (eller alla) med "kollad", filtret "Ej kollade" och klick som visar kontrollen. */
export function InspectionsPanel({ rows, selected, onSelect, offline }: { rows: readonly InspectionRow[]; selected: string | undefined;
  onSelect: (control: string) => void; offline: boolean }) {
  const [filter, setFilter] = useState<InspectionFilter>("UNCHECKED");
  const visible = filterInspectionRows(rows, filter);
  const checked = rows.filter(row => row.inspection).length;
  return <section className={styles.panel} aria-labelledby="course-setting-inspections" data-testid="course-setting-inspections">
    <h2 id="course-setting-inspections">{text.inspection.heading}</h2>
    <p className={styles.muted}>{text.inspection.count(checked, rows.length)}</p>
    <div className={styles.segmented} role="group" aria-label={text.inspection.filter}>
      {(["UNCHECKED", "ALL"] as const).map(value => <Button key={value} variant="secondary" aria-pressed={filter === value}
        onClick={() => setFilter(value)}>{text.inspection.filters[value]}</Button>)}
    </div>
    {rows.length === 0 ? <p className={styles.muted}>{text.inspection.noControls}</p>
      : visible.length === 0 ? <p className={styles.muted}>{text.inspection.none}</p>
        : <ul className={styles.inspectionList}>
          {visible.map(row => <li key={row.control} data-checked={row.inspection ? "true" : undefined} data-selected={row.control === selected || undefined}>
            <button type="button" onClick={() => onSelect(row.control)}>
              <strong>{row.code}</strong>
              <span>{row.inspection ? `${row.movedSince ? "⚠" : "✓"} ${text.inspection.by(row.inspection.checkedBy.displayName, row.inspection.checkedAt)}`
                : text.inspection.unchecked}
                {row.inspection?.pending ? ` (${offline ? text.inspection.pending : text.inspection.sending})` : ""}
                {row.movedSince ? ` – ${text.inspection.movedSince}` : ""}</span>
            </button>
          </li>)}
        </ul>}
    <p className={styles.muted}>{text.inspection.help}</p>
  </section>;
}

/** Steg 67: "Spara kartan för offline" med storleken, vad som är sparat, och kön. */
export function OfflinePanel({ info, mapSha256, mapBytes, busy, message, waiting, onSave, onRemove, onSend, heading = true }: {
  info: StoredMapInfo | undefined; mapSha256: string | undefined; mapBytes: number | undefined; busy: boolean; message: string | undefined;
  waiting: number; onSave: () => void; onRemove: () => void; onSend: () => void;
  /** Rubriken (inte i dialogen, som har samma rubrik). */
  heading?: boolean;
}) {
  const stale = info !== undefined && mapSha256 !== undefined && info.sha256 !== mapSha256;
  return <section className={styles.panel} aria-label={text.panel.heading} data-testid="course-setting-offline">
    {heading && <h2>{text.panel.heading}</h2>}
    <p className={styles.muted}>{text.panel.help}</p>
    {info && <p data-testid="course-setting-offline-saved">{text.panel.saved(info.bytes, info.savedAt)}</p>}
    {stale && <p role="alert">{text.panel.stale}</p>}
    <div className={styles.row}>
      {(!info || stale) && <Button disabled={busy || !mapSha256} onClick={onSave}>{busy ? text.panel.saving : text.panel.save(mapBytes)}</Button>}
      {info && !stale && <Button variant="secondary" disabled={busy} onClick={onSave}>{busy ? text.panel.saving : text.panel.update}</Button>}
      {info && <Button variant="quiet" disabled={busy} onClick={onRemove}>{text.panel.remove}</Button>}
    </div>
    {message && <p role="status">{message}</p>}
    <p>{text.panel.waiting(waiting)}</p>
    {waiting > 0 && <div className={styles.row}><Button variant="secondary" onClick={onSend}>{text.panel.sendNow}</Button></div>}
  </section>;
}
