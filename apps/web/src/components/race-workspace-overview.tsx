"use client";

import { useState } from "react";
import type { EntryTransferCandidates } from "@o-tid/contracts";
import { missingFixedStartTime, needsPaymentAttention } from "../lib/administrator-roster-filter";
import { raceWorkspaceOverviewSv as text } from "../i18n/race-workspace-overview-sv";
import styles from "./race-workspace-overview.module.css";

type WorkflowMode = "PARTICIPANTS" | "BEFORE" | "DURING" | "AFTER";
type FollowUpFilter = "OLDER_RESULTS" | "RENTAL_CARDS" | "PAYMENT";

export function RaceWorkspaceOverview({ data, disabled, onNavigate, onFollowUp, onMissingFixedStart, onOpenClass }: {
  data: EntryTransferCandidates;
  disabled: boolean;
  onNavigate: (mode: WorkflowMode) => void;
  onFollowUp: (filter: FollowUpFilter) => void;
  onMissingFixedStart: (classId: string) => void;
  onOpenClass: (classId: string) => void;
}) {
  const [classSearch, setClassSearch] = useState("");
  const fixedClasses = data.classes.filter((raceClass) => raceClass.startRule === "FIXED");
  const missingByClass = new Map(fixedClasses.map((raceClass) => [raceClass.id, data.entries.filter((entry) =>
    entry.classId === raceClass.id && missingFixedStartTime(entry, raceClass.startRule)).length]));
  const missingFixedTimes = [...missingByClass.values()].reduce((total, missing) => total + missing, 0);
  const query = classSearch.trim().toLocaleLowerCase("sv-SE");
  const visibleClasses = data.classes.map((raceClass, index) => ({
    raceClass, index, missing: missingByClass.get(raceClass.id) ?? 0,
  })).filter(({ raceClass }) => !query || raceClass.name.toLocaleLowerCase("sv-SE").includes(query) ||
    raceClass.courseName.toLocaleLowerCase("sv-SE").includes(query))
    .sort((left, right) => right.missing - left.missing || left.index - right.index);
  const withoutActiveCard = data.entries.filter((entry) => entry.activeAssignment === null && !entry.multipleActiveAssignments).length;
  const withMultipleActiveCards = data.entries.filter((entry) => entry.multipleActiveAssignments).length;
  const olderResults = data.entries.filter((entry) => entry.resultFreshness === "OLDER_SNAPSHOT").length;
  const rentals = data.entries.filter((entry) => entry.activeAssignment?.isRental === true &&
    !entry.activeAssignment.rentalReturned).length;
  const payment = data.entries.filter((entry) => needsPaymentAttention(entry.paymentStatus)).length;

  return <section className={styles.overview} aria-label={text.sectionLabel}>
    <p className={styles.description}>{text.basisHelp}</p>
    <section className={styles.classPanel} aria-labelledby="race-overview-classes">
      <h3 id="race-overview-classes">{text.classTableLabel}</h3>
      {data.classes.length === 0 ? <p className={styles.empty}>{text.emptyClasses}</p> :
        <><div className={styles.classFinder}>
          <label className={styles.classSearch}>{text.classSearch}
            <input type="search" value={classSearch} onChange={(event) => setClassSearch(event.target.value)} />
          </label>
          <p className={styles.matchCount} role="status" aria-live="polite">
            {text.classMatchCount(visibleClasses.length, data.classes.length)}
          </p>
        </div>
        <p className={styles.orderHelp}>{text.classOrderHelp}</p>
        {visibleClasses.length === 0 ? <p className={styles.empty}>{text.noClassMatches}</p> :
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={text.classTableLabel}>
          <table className={styles.table}>
            <thead><tr><th scope="col">{text.classes}</th><th scope="col">{text.startRule}</th><th scope="col">{text.classCount}</th><th scope="col" className={styles.courseColumn}>{text.course}</th><th scope="col">{text.fixedStartMissing}</th></tr></thead>
            <tbody>{visibleClasses.map(({ raceClass, missing }) => {
              return <tr key={raceClass.id}>
                <th scope="row"><button type="button" className={styles.classLink} disabled={disabled}
                  aria-label={text.openClass(raceClass.name)} onClick={() => onOpenClass(raceClass.id)}>{raceClass.name}</button></th>
                <td>{raceClass.startRule === "FIXED" ? text.startFixed : text.startPunch}</td>
                <td className={styles.numeric}>{raceClass.entryCount} / {raceClass.maxEntries ?? text.unlimited}</td>
                <td className={styles.courseColumn}>{raceClass.courseName} · {text.courseVersion(raceClass.courseVersion)}</td>
                <td className={styles.numeric}>{raceClass.startRule !== "FIXED" ? "–" : missing === 0 ? 0 :
                  <button type="button" className={styles.missingStartLink} disabled={disabled}
                    aria-label={text.openMissingFixedStart(raceClass.name, missing)}
                    onClick={() => onMissingFixedStart(raceClass.id)}>{missing}</button>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}</>}
    </section>

    <section className={styles.followUps} aria-labelledby="race-overview-followups">
      <h3 id="race-overview-followups">{text.attentionLabel}</h3>
      {olderResults + rentals + payment === 0 ? <p className={styles.empty}>{text.zeroAttention}</p> : <div className={styles.followUpList}>
        <button type="button" className="secondary" disabled={disabled || olderResults === 0} onClick={() => onFollowUp("OLDER_RESULTS")}>
          <span>{text.olderResults}</span><strong>{olderResults}</strong>
        </button>
        <button type="button" className="secondary" disabled={disabled || rentals === 0} onClick={() => onFollowUp("RENTAL_CARDS")}>
          <span>{text.rentals}</span><strong>{rentals}</strong>
        </button>
        <button type="button" className="secondary" disabled={disabled || payment === 0} onClick={() => onFollowUp("PAYMENT")}>
          <span>{text.payment}</span><strong>{payment}</strong>
        </button>
      </div>}
    </section>
    <div className={styles.areas} aria-label={text.areasLabel}>
      <section className={styles.area}>
        <h2>{text.beforeTitle}</h2>
        <p className={styles.description}>{text.beforeDescription}</p>
        <dl className={styles.metrics}>
          <div><dt>{text.classes}</dt><dd>{data.classes.length}</dd></div>
          <div><dt>{text.fixedStartMissing}</dt><dd>{missingFixedTimes}</dd></div>
        </dl>
        <button type="button" className="secondary" disabled={disabled} onClick={() => onNavigate("BEFORE")}>{text.openBefore}</button>
      </section>
      <section className={styles.area}>
        <h2>{text.participantsTitle} · {data.entries.length}</h2>
        <p className={styles.description}>{text.participantsDescription}</p>
        <button type="button" className="secondary" disabled={disabled} onClick={() => onNavigate("PARTICIPANTS")}>{text.openParticipants}</button>
      </section>
      <section className={styles.area}>
        <h2>{text.duringTitle}</h2>
        <p className={styles.description}>{text.duringDescription}</p>
        <dl className={styles.metrics}>
          <div><dt>{text.noActiveCard}</dt><dd>{withoutActiveCard}</dd></div>
          <div><dt>{text.multipleCards}</dt><dd>{withMultipleActiveCards}</dd></div>
        </dl>
        <button type="button" className="secondary" disabled={disabled} onClick={() => onNavigate("DURING")}>{text.openDuring}</button>
      </section>
      <section className={styles.area}>
        <h2>{text.afterTitle}</h2>
        <p className={styles.description}>{text.afterDescription}</p>
        <dl className={styles.metrics}>
          <div><dt>{text.olderResults}</dt><dd>{olderResults}</dd></div>
          <div><dt>{text.rentals}</dt><dd>{rentals}</dd></div>
        </dl>
        <button type="button" className="secondary" disabled={disabled} onClick={() => onNavigate("AFTER")}>{text.openAfter}</button>
      </section>
    </div>
  </section>;
}
