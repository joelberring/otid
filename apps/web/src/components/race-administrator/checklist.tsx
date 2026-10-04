"use client";

import styles from "../race-workspace-checklist.module.css";
import { raceWorkspaceNavigationSv as text } from "../../i18n/race-workspace-navigation-sv";
import { checklistFacts, checklistStatus, checklistSteps, inForest, type ChecklistTone } from "../../lib/admin-checklist";
import type { Workspace } from "./workspace-state";

const symbols: Record<ChecklistTone, string> = { DONE: "✓", ATTENTION: "⚠", OPEN: "○" };

/**
 * Checklistan överst i arbetsytan (ADR-0169 beslut 4): Banor → Klasser → Anmälda → Start → Avläsning → Resultat.
 * Varje steg visar en kort status i ord med en symbol bredvid. Ett klick visar stegets område.
 */
export function Checklist({ ws }: { ws: Workspace }) {
  const { courseList, data, forestData, navigateStep, raceId, step, unknownReadoutCandidate,
    navigationLocked } = ws;
  if (!data) return null;
  const facts = checklistFacts(data, {
    courseCount: courseList && courseList.snapshotVersion >= data.snapshotVersion ? courseList.courses.length : undefined,
    inForest: forestData ? inForest(forestData.entries).length : undefined,
    unknownCards: unknownReadoutCandidate?.readouts.length
  });
  return <nav className={styles.checklist} aria-label={text.checklist}>
    <ol>{checklistSteps.map((item, index) => {
      const status = checklistStatus(item, facts);
      const statusId = `checklist-${raceId}-${item}`;
      return <li key={item}>
        <button type="button" aria-label={text.steps[item]} aria-describedby={statusId}
          aria-current={step === item ? "step" : undefined} data-tone={status.tone} disabled={navigationLocked}
          onClick={() => navigateStep(item)}>
          <span className={styles.stepName} aria-hidden="true"><span className={styles.stepNumber}>{index + 1}</span>{text.steps[item]}</span>
          <span className={styles.stepStatus} id={statusId}>
            <span aria-hidden="true" className={styles.stepSymbol}>{symbols[status.tone]}</span>{status.text}
          </span>
        </button>
      </li>;
    })}</ol>
  </nav>;
}
