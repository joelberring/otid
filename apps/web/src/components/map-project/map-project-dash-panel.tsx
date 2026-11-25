"use client";

import { mapProjectDashEn } from "../../i18n/map-project-dash-en";
import { mapProjectDashSv } from "../../i18n/map-project-dash-sv";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { DashScope, useMapProjectDashPoints } from "./use-map-project-dash-points";
import styles from "./map-project-editor.module.css";

const SCOPES: readonly DashScope[] = ["selected", "view", "map"];

/**
 * Styrpunkter på streckade linjer (hjälpkurvor, stigar) i sidopanelens Bearbeta-flik: välj omfattning och regler,
 * förhandsgranska antal och romber på kartan, och placera som ett ångringsbart steg.
 */
export function MapProjectDashPanel({ dash }: { dash: ReturnType<typeof useMapProjectDashPoints> }) {
  const text = useTexts(mapProjectDashSv, mapProjectDashEn);
  if (!dash.canEdit) return null;
  const counts = dash.plan?.counts;
  return <details className={styles.settings} data-testid="map-project-dash-panel">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    <label>{text.scopeLabel}{" "}
      <select value={dash.scope} onChange={event => { dash.setScope(event.target.value as DashScope); dash.clear(); }}
        data-testid="map-project-dash-scope">
        {SCOPES.map(scope => <option key={scope} value={scope}>{text.scopes[scope]}</option>)}
      </select>
    </label>
    <label className={styles.check}>
      <input type="checkbox" checked={dash.bends} onChange={event => dash.setBends(event.target.checked)}
        data-testid="map-project-dash-bends" />
      {text.rules.bends}
    </label>
    <label className={styles.check}>
      <input type="checkbox" checked={dash.slopeTags} onChange={event => dash.setSlopeTags(event.target.checked)}
        data-testid="map-project-dash-slope-tags" />
      {text.rules.slopeTags}
    </label>
    <label className={styles.check}>
      <input type="checkbox" checked={dash.junctions} onChange={event => dash.setJunctions(event.target.checked)}
        data-testid="map-project-dash-junctions" />
      {text.rules.junctions}
    </label>
    <label className={styles.check}>
      <input type="checkbox" checked={dash.keepExisting} onChange={event => dash.setKeepExisting(event.target.checked)}
        data-testid="map-project-dash-keep-existing" />
      {text.rules.keepExisting}
    </label>
    <span className={styles.actions}>
      <Button variant="secondary" disabled={dash.busy || (!dash.bends && !dash.slopeTags && !dash.junctions)}
        onClick={dash.preview} data-testid="map-project-dash-preview">{text.preview}</Button>
      {dash.plan && <Button variant="quiet" onClick={dash.clear} data-testid="map-project-dash-clear">{text.clear}</Button>}
    </span>
    {dash.busy && <p role="status" className={styles.muted}>{text.computing}</p>}
    {dash.status.kind === "problem" && <p role="alert" className={styles.problem} data-testid="map-project-dash-problem">
      {dash.status.problem === "noSelection" ? text.noSelection : text.noView}
    </p>}
    {counts && <div role="status" data-testid="map-project-dash-result">
      <p>{counts.added === 0 ? text.noneFound : text.previewSummary(counts.objects, counts.added, counts.bends, counts.slopeTags, counts.junctions)}</p>
      {counts.added > 0 && <span className={styles.actions}>
        <Button disabled={dash.busy} onClick={dash.apply} data-testid="map-project-dash-apply">{text.apply}</Button>
      </span>}
    </div>}
    {dash.status.kind === "applied" && <div role="status" data-testid="map-project-dash-applied">
      <p>{text.appliedSummary(dash.status.counts.added, dash.status.counts.bends, dash.status.counts.slopeTags, dash.status.counts.junctions)}</p>
      {dash.isSelectedDashed
        ? <span className={styles.actions}>
            <Button variant={dash.mode ? "primary" : "secondary"} aria-pressed={dash.mode} onClick={dash.toggleMode}
              data-testid="map-project-dash-adjust">{text.adjustManual}</Button>
          </span>
        : <p className={styles.muted}>{text.adjustManualHint}</p>}
    </div>}
  </details>;
}
