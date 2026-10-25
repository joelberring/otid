"use client";

import type { DecisionReview } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import controlStyles from "./readout-control.module.css";
import { decisionReviewSv as text } from "../../i18n/decision-review-sv";
import { raceAdministratorSv as adminText } from "../../i18n/race-administrator-sv";
import { decisionReviewText, withdrawChoiceFor } from "../../lib/decision-review";
import { Button } from "../ui";
import type { Workspace } from "./workspace-state";

/** Steg 45: deltagarkortets varning när ett beslut döljer en senare avläsning, med "Ta bort beslutet". */
export function DecisionReviewNotice({ ws, review }: { ws: Workspace; review: DecisionReview }) {
  return <section className={styles.review} role="alert" data-testid="decision-review" aria-label={text.listTitle}>
    <p><strong>! {decisionReviewText(review)}</strong></p>
    <p>{text.help}</p>
    <div><Button variant="secondary" disabled={ws.disabled}
      onClick={() => void ws.chooseStatusChange(withdrawChoiceFor(review.decision))}>{text.remove}</Button></div>
  </section>;
}

/** Steg 45: Resultat → Efterarbete → "Beslut att se över". */
export function DecisionReviewList({ ws }: { ws: Workspace }) {
  const { classNames, data, disabled, select } = ws;
  const rows = (data?.entries ?? []).filter((entry) => entry.decisionReview);
  return <div data-testid="decision-review-list">
    <p className={styles.workflowHelp}>{text.listHelp}</p>
    {rows.length === 0 ? <p>{text.listEmpty}</p> : <ul className={controlStyles.controlList}>
      {rows.map((entry) => <li key={entry.id} className={controlStyles.controlRowAction}>
        <span><strong>{entry.displayName}</strong>
          <span>{[entry.organisationName ?? adminText.none, classNames.get(entry.classId)].join(" · ")} · {decisionReviewText(entry.decisionReview!)}</span></span>
        <Button variant="secondary" disabled={disabled} aria-label={`${text.open} ${entry.displayName}`}
          onClick={() => select(entry.id)}>{text.open}</Button>
      </li>)}
    </ul>}
  </div>;
}
