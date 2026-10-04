"use client";

import type { EntryTransferCandidates } from "@o-tid/contracts";
import { raceWorkflowDetailSv as text } from "../i18n/race-workflow-detail-sv";
import styles from "./race-workflow-detail.module.css";
import { formatClockTime } from "../lib/clock-time";

type Entry = EntryTransferCandidates["entries"][number];
type RaceClass = EntryTransferCandidates["classes"][number];
type EditAction = "IDENTITY" | "TRANSFER" | "CARD" | "TIME" | "PAYMENT";

export function RaceParticipantFacts({ entry, raceClass, timeZone, disabled, activeAction, onEdit }: {
  entry: Entry;
  raceClass: RaceClass;
  timeZone: string;
  disabled: boolean;
  activeAction: string;
  onEdit: (action: EditAction) => void;
}) {
  const assignment = entry.activeAssignment;
  const cardValue = entry.multipleActiveAssignments ? text.multipleCards : assignment === null ? text.noCard :
    `${assignment.cardNumber}${assignment.isRental ? ` · ${text.cardRental} · ${assignment.rentalReturned ? text.returned : text.notReturned}` : ""}`;
  const startValue = raceClass.startRule === "PUNCH" ? text.free : entry.fixedStartTime === null ? text.noFixedTime : formatClockTime(entry.fixedStartTime, timeZone);
  const paymentValue = entry.paymentStatus === "UNMARKED" ? text.paymentUnmarked : entry.paymentStatus === "UNPAID" ? text.paymentUnpaid :
    entry.paymentStatus === "PAID" ? text.paymentPaid : text.paymentWaived;

  return <section className={`${styles.panel} ${styles.participantFacts}`} aria-labelledby="race-participant-facts-title">
    <header className={styles.sectionHeader}><h2 id="race-participant-facts-title">{text.factsTitle}</h2></header>
    <dl className={styles.facts}>
      <div><dt>{text.name}</dt><dd>{entry.displayName}</dd></div>
      <div><dt>{text.club}</dt><dd>{entry.organisationName ?? "–"}</dd></div>
      <div><dt>{text.class}</dt><dd>{raceClass.name}</dd></div>
      <div><dt>{text.card}</dt><dd>{cardValue}</dd></div>
      <div><dt>{text.startTime}</dt><dd>{startValue}</dd></div>
      <div><dt>{text.payment}</dt><dd>{paymentValue}</dd></div>
    </dl>
    <nav className={styles.editActions} aria-label={text.editActions}>
      <button type="button" className="secondary" aria-label={text.editIdentity} aria-pressed={activeAction === "IDENTITY"} disabled={disabled} onClick={() => onEdit("IDENTITY")}>{text.shortIdentity}</button>
      <button type="button" className="secondary" aria-label={text.editTransfer} aria-pressed={activeAction === "TRANSFER"} disabled={disabled} onClick={() => onEdit("TRANSFER")}>{text.shortTransfer}</button>
      <button type="button" className="secondary" aria-label={text.editCard} aria-pressed={activeAction === "CARD"} disabled={disabled} onClick={() => onEdit("CARD")}>{text.shortCard}</button>
      <button type="button" className="secondary" aria-label={text.editTime} aria-pressed={activeAction === "TIME"} disabled={disabled || raceClass.startRule !== "FIXED"} onClick={() => onEdit("TIME")}>{text.shortTime}</button>
      <button type="button" className="secondary" aria-label={text.editPayment} aria-pressed={activeAction === "PAYMENT"} disabled={disabled} onClick={() => onEdit("PAYMENT")}>{text.shortPayment}</button>
    </nav>
  </section>;
}
