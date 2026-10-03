import React from "react";
import type { StartCheckinConflictReviewCandidate } from "@o-tid/contracts";
import { checkinConflictReviewSv as text } from "../i18n/checkin-conflict-review-sv";
import { forestWatchSv as forest } from "../i18n/forest-watch-sv";

export function AdministratorConflictEvidence({ candidate }: { candidate: StartCheckinConflictReviewCandidate }) {
  const source = candidate.source;
  return <>
    <h3>{source.displayName} – {source.className}</h3>
    <p>{text.current}: {forest.reports[source.startState]} · {source.manualReturnRegistered ? text.returnYes : text.returnNo}
      {source.readoutReturnRegistered && <> · {forest.readoutReturn}</>}{source.activeDns && <> · {forest.activeDns}</>}</p>
    <p>{text.generated}: {candidate.generatedAt} · {text.revision}: {source.revision}</p>
    <h4>{text.reports} ({source.conflicts.length})</h4>
    <ul>{source.conflicts.map(row => <li key={row.operation.requestId}>
      {row.deviceLabel}: {forest.reports[row.operation.action.state]}
      {row.operation.action.kind === "FINISH_CORRECTION" && <> · {row.operation.action.manualReturnRegistered ? text.returnYes : text.returnNo}</>}
      <br />{text.observed}: {row.operation.observedAt} · {text.received}: {row.receipt.receivedAt}
      {row.receipt.effect.kind === "CONFLICT" && <> · {text.errors[row.receipt.effect.reason]}</>}
    </li>)}</ul>
    {!source.conflicts.length && <p>{text.noReports}</p>}
  </>;
}
