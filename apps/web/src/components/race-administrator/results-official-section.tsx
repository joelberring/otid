"use client";

import { useEffect, useRef } from "react";
import styles from "../race-administrator-workspace.module.css";
import { resultsOfficialSv as text } from "../../i18n/results-official-sv";
import { sv } from "../../i18n/sv";
import { Button, Notice, Section } from "../ui";
import type { Workspace } from "./workspace-state";

/** Datum och klockslag för när resultaten blev klara, i tävlingens tidszon ("19 okt. 21:05"). */
function when(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(instant));
}

/**
 * "Resultaten är klara" (PLAN.md steg 27): en knapp som fastställer hela loppet, märker listorna Officiella resultat och ger
 * IOF-filen för Eventor; "Gör resultaten preliminära igen" ångrar. Ändras ett resultat efteråt visas listorna som preliminära
 * tills arrangören trycker igen. Finns inte för Träning och Liten tävling.
 */
export function ResultsOfficialSection({ ws }: { ws: Workspace }) {
  const { authenticated, busy, data, disabled, downloadOfficialResults, loadResultsOfficial, markResults, operation, pending, raceId,
    resultsOfficial, resultsOfficialBlocked, resultsOfficialMessage, resultsOfficialRequest, shows } = ws;
  const visible = shows("RESULTS");
  // Läses när Resultat visas och på nytt när arbetsytans lista läses om (ett beslut kan göra resultaten inaktuella),
  // men först när inget annat anrop pågår.
  const loadedFor = useRef<unknown>(undefined);
  useEffect(() => {
    if (!visible || !authenticated || busy || operation.current || pending.current || loadedFor.current === data) return;
    loadedFor.current = data;
    void loadResultsOfficial().then(outcome => { if (outcome === "aborted" && loadedFor.current === data) loadedFor.current = undefined; });
  }, [visible, authenticated, data, busy]);
  const timeZone = data?.timeZone ?? "Europe/Stockholm";
  const official = resultsOfficial?.official;
  const retry = !!resultsOfficialRequest && resultsOfficialMessage?.tone === "error";
  return <Section id={`results-official-${raceId}`} title={text.title} help={official?.current ? undefined : text.help}>
    <div className={styles.disclosureBody} data-testid="results-official">
      {!resultsOfficial ? <p className={styles.muted} role="status">{text.loading}</p>
        : official?.current ? <Notice tone="ok">{text.official(when(official.finalizedAt, timeZone))}</Notice>
          : official ? <Notice tone="attention">{text.changed(when(official.finalizedAt, timeZone))}</Notice>
            : <p className={styles.muted}>{text.preliminary}</p>}
      {resultsOfficialBlocked && <Notice tone="attention" role="alert"><p><strong>{text.blockedTitle}</strong></p>
        <ul className={styles.changeList}>
          {resultsOfficialBlocked.raceBlockers.map(code => <li key={code}>{sv.resultFinalizationBlockers[code]}</li>)}
          {resultsOfficialBlocked.classes.map(row => <li key={row.classId}>{text.blockedClass(row.className,
            row.blockerCodes.map(code => code === "MISSING_RESULT_REVISION" ? text.missingResults
              : sv.resultFinalizationBlockers[code]).join(" "))}</li>)}
        </ul></Notice>}
      {resultsOfficialMessage && <Notice tone={resultsOfficialMessage.tone} role={resultsOfficialMessage.tone === "ok" ? "status" : "alert"}>
        {resultsOfficialMessage.text}</Notice>}
      <div className={styles.actions}>
        {!official?.current && <Button disabled={disabled || !resultsOfficial} onClick={() => void markResults("OFFICIAL")}>
          {retry && resultsOfficialRequest?.action === "OFFICIAL" ? text.retry : official ? text.markAgain : text.mark}</Button>}
        {official && <Button variant={official.current ? "primary" : "secondary"} disabled={disabled}
          onClick={() => void downloadOfficialResults(official.finalizationId)}>{text.download}</Button>}
        {official && <Button variant="quiet" disabled={disabled} onClick={() => void markResults("PRELIMINARY")}>
          {retry && resultsOfficialRequest?.action === "PRELIMINARY" ? text.retry : text.undo}</Button>}
      </div>
    </div>
  </Section>;
}
