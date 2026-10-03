"use client";

import React from "react";
import Link from "next/link";
import type { EntryTransferCandidates } from "@o-tid/contracts";
import { raceWorkflowDetailSv as text } from "../i18n/race-workflow-detail-sv";
import { missingFixedStartTime } from "../lib/administrator-roster-filter";
import styles from "./race-workflow-detail.module.css";

export type PreparationStepArea = (typeof text.steps)[number]["area"];

export function RacePreparationGuide({ data, disabled, onOpenArea, onMissingFixedStart }: {
  data: EntryTransferCandidates;
  disabled: boolean;
  onOpenArea?: (area: PreparationStepArea) => void;
  onMissingFixedStart?: () => void;
}) {
  const classesById = new Map(data.classes.map((raceClass) => [raceClass.id, raceClass]));
  const missingStartCount = data.entries.filter((entry) =>
    missingFixedStartTime(entry, classesById.get(entry.classId)?.startRule)).length;
  return <section className={styles.panel} aria-labelledby="race-preparation-title">
    <header className={styles.sectionHeader}>
      <div><h2 id="race-preparation-title">{text.preparationTitle}</h2><p>{text.preparationIntro}</p></div>
    </header>
    <section className={styles.importEntry} aria-labelledby="race-preparation-import">
      <div><h3 id="race-preparation-import">{text.importTitle}</h3>
        <p>{text.importKinds}</p><p className={styles.importAccess}>{text.importAccess}</p></div>
      {disabled ? <span className={styles.importUnavailable} aria-disabled="true" title={text.importLocked}>{text.importAction}</span> :
        <Link className={styles.importAction} href={`/admin/${data.raceId}/imports`} prefetch={false}>{text.importAction}</Link>}
    </section>
    <section className={styles.preparationSteps} aria-labelledby="race-preparation-steps">
      <h3 id="race-preparation-steps">{text.stepsTitle}</h3>
      <ol className={styles.steps}>
        {text.steps.map((step, index) => <li key={step.area}>
          <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
          <div>{onOpenArea ? <button type="button" className={styles.stepLink} disabled={disabled}
            onClick={() => onOpenArea(step.area)}>{step.title}</button> : <strong>{step.title}</strong>}
            <p>{step.description}</p>
            {step.area === "DRAW" && <p className={missingStartCount > 0 ? styles.missingStartWarning : styles.missingStartNeutral}>
              {missingStartCount > 0 ? <>{text.missingStartBasis} {onMissingFixedStart ?
                <button type="button" className={styles.missingStartLink} disabled={disabled} onClick={onMissingFixedStart}>
                  {text.missingStartAction(missingStartCount)}
                </button> : text.missingStartCount(missingStartCount)}</> : text.missingStartZero}
            </p>}</div>
        </li>)}
      </ol>
    </section>
    <section className={styles.classSection} aria-labelledby="race-preparation-classes">
      <h3 id="race-preparation-classes">{text.classesTitle}</h3>
      {data.classes.length === 0 ? <p className={styles.empty}>{text.emptyClasses}</p> :
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={text.classesTitle}>
          <table className={styles.table}>
            <thead><tr><th scope="col">{text.className}</th><th scope="col">{text.start}</th><th scope="col">{text.entriesCapacity}</th></tr></thead>
            <tbody>{data.classes.map((raceClass) => <tr key={raceClass.id}>
              <th scope="row">{raceClass.name}</th>
              <td>{raceClass.startRule === "FIXED" ? text.fixed : text.free}</td>
              <td className={styles.numeric}>{raceClass.entryCount} / {raceClass.maxEntries ?? text.unlimited}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
  </section>;
}
