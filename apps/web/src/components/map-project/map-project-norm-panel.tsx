"use client";

import { NORM_RULES, type NormIssue } from "@o-tid/map-revision";
import { mapProjectNormSv } from "../../i18n/map-project-norm-sv";
import { Button } from "../ui";
import type { useMapProjectNorm } from "./use-map-project-norm";
import styles from "./map-project-editor.module.css";

const text = mapProjectNormSv;
const SHOWN = 30;

/** Normkontrollen i sidopanelen: av och på, standarden, antal per regel och ställena (Visa flyttar kartan dit). */
export function MapProjectNormPanel({ norm, onShow }: { norm: ReturnType<typeof useMapProjectNorm>; onShow: (issue: NormIssue) => void }) {
  const result = norm.result;
  return <section className={styles.panel} aria-labelledby="map-project-norm" data-testid="map-project-norm">
    <h2 id="map-project-norm">{text.heading}</h2>
    <label className={styles.check}><input type="checkbox" checked={norm.active} onChange={event => norm.setActive(event.target.checked)}
      data-testid="map-project-norm-toggle" />{text.toggle}</label>
    <p className={styles.muted}>{text.help}</p>
    {norm.active && !result && <p className={styles.muted} role="status">{text.computing}</p>}
    {result && <>
      <p className={styles.muted}>{text.standard(result.standard, result.factor)}</p>
      <p role="status" data-testid="map-project-norm-count">{result.issues.length === 0 ? text.none : text.count(result.issues.length, result.truncated)}</p>
      {NORM_RULES.map(rule => {
        const issues = result.issues.filter(issue => issue.rule === rule);
        if (issues.length === 0) return null;
        return <details key={rule} className={styles.settings} data-testid="map-project-norm-rule" data-rule={rule}>
          <summary>{text.rules[rule]} ({issues.length})</summary>
          <ul className={styles.rows}>
            {issues.slice(0, SHOWN).map((issue, index) => <li key={`${issue.key}-${index}`} className={styles.areaRow}>
              <span className={styles.muted}>{text.detail(rule, issue.code, issue.value, issue.limit)}</span>
              <Button variant="quiet" onClick={() => onShow(issue)}>{text.show}</Button>
            </li>)}
          </ul>
          {issues.length > SHOWN && <p className={styles.muted}>{text.more(issues.length - SHOWN)}</p>}
        </details>;
      })}
    </>}
  </section>;
}
