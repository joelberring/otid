"use client";

import { useState } from "react";
import type { BoxArea } from "../../lib/map-project-area-box";
import { mapProjectGeneralizeSv } from "../../i18n/map-project-generalize-sv";
import { Button } from "../ui";
import type { useMapProjectGeneralize } from "./use-map-project-generalize";
import styles from "./map-project-editor.module.css";

const text = mapProjectGeneralizeSv;
const TOLERANCES = [0, 0.05, 0.1, 0.2] as const;
type Area = BoxArea & { areaId: string };

/** ADR-0219 K6 (del 1): generaliseringen i sidopanelen: välj område och steg, räkna fram och lämna som förslag. */
export function MapProjectGeneralizePanel({ generalize, areas }: { generalize: ReturnType<typeof useMapProjectGeneralize>; areas: readonly Area[] }) {
  const [where, setWhere] = useState("");
  const [tolerance, setTolerance] = useState<number>(0.1);
  const [removeSmall, setRemoveSmall] = useState(true);
  if (!generalize.canPropose) return null;
  const area = areas.find(row => row.areaId === where);
  const outline = area?.polygon[0];
  const within = outline && outline.length >= 3 ? { minX: Math.min(...outline.map(p => p.x)), maxX: Math.max(...outline.map(p => p.x)),
    minY: Math.min(...outline.map(p => p.y)), maxY: Math.max(...outline.map(p => p.y)) } : undefined;
  const result = generalize.result;
  const planned = result ? generalize.edits() : undefined;
  return <details className={styles.settings} data-testid="map-project-generalize">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    <label>{text.where}<select value={where} onChange={event => setWhere(event.target.value)}>
      <option value="">{text.whole}</option>
      {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
    </select></label>
    <label>{text.simplify}<select value={tolerance} onChange={event => setTolerance(Number(event.target.value))} data-testid="map-project-generalize-tolerance">
      {TOLERANCES.map(value => <option key={value} value={value}>{text.tolerance(value)}</option>)}
    </select></label>
    <label className={styles.check}><input type="checkbox" checked={removeSmall} onChange={event => setRemoveSmall(event.target.checked)} />{text.removeSmall}</label>
    <span className={styles.actions}>
      <Button variant="secondary" disabled={!!generalize.busy || (tolerance === 0 && !removeSmall)} data-testid="map-project-generalize-preview"
        onClick={() => generalize.preview({ simplifyMm: tolerance, removeSmall, within })}>{text.preview}</Button>
    </span>
    {result && planned && <div role="status" data-testid="map-project-generalize-result">
      <p>{text.summary(result.simplified, result.pointsBefore, result.pointsAfter)}</p>
      <p>{text.removed(result.removed.SMALL_AREA, result.removed.SHORT_LINE, result.removed.SMALL_CLOSED)}</p>
      {planned.skipped > 0 && <p className={styles.muted}>{text.skipped(planned.skipped)}</p>}
      {planned.edits.length > 0 && <span className={styles.actions}>
        <Button disabled={!!generalize.busy} onClick={() => void generalize.propose()} data-testid="map-project-generalize-propose">
          {text.propose(planned.edits.length)}</Button>
      </span>}
    </div>}
    {generalize.busy && <p role="status" className={styles.muted}>{generalize.busy}</p>}
    {generalize.message && <p role={generalize.message.tone === "ok" ? "status" : "alert"}
      className={generalize.message.tone === "ok" ? styles.muted : styles.problem} data-testid="map-project-generalize-message">{generalize.message.text}</p>}
  </details>;
}
