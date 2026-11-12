"use client";

import { useState } from "react";
import type { ClubTermCopyResponse, ClubTermView } from "@o-tid/contracts";
import { planCopyEn } from "../../i18n/club-plan-copy-en";
import { planCopySv } from "../../i18n/club-plan-copy-sv";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { PlanChange } from "./plan-session-card";
import styles from "./club-planning.module.css";

/**
 * Ägaren 2026-11-12: "Kopiera upplägg från termin" i en tom termin. Servern lägger varje träning på samma veckodag i motsvarande
 * vecka, med ledarna (övriga uppgifter utan person); ingen träning skapas och inga mejl skickas.
 */
export function PlanTermCopy({ termId, terms, busy, change }: { termId: string; terms: readonly ClubTermView[]; busy: boolean; change: PlanChange }) {
  const text = useTexts(planCopySv, planCopyEn);
  const sources = terms.filter(term => term.termId !== termId && term.sessions > 0);
  const [fromTermId, setFromTermId] = useState(sources[sources.length - 1]?.termId ?? "");
  if (sources.length === 0) return null;
  return <section className={`${styles.form} ${styles.noPrint}`} aria-labelledby="plan-term-copy" data-testid="plan-term-copy">
    <h3 id="plan-term-copy" className={styles.termTitle}>{text.copyTerm}</h3>
    <p className={styles.small}>{text.copyHelp}</p>
    <div className={styles.inline}>
      <label className={styles.termChoice}><span>{text.copyFrom}</span>
        <select value={fromTermId} onChange={event => setFromTermId(event.target.value)}>
          {sources.map(term => <option key={term.termId} value={term.termId}>{term.name}</option>)}
        </select></label>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy || !fromTermId} onClick={() => void change(`/terms/${termId}/copy`, "POST", { formatVersion: 1, fromTermId },
          json => { const result = json as ClubTermCopyResponse; return text.copied(result.copied, result.outside); })}>{text.copy}</Button>
      </div>
    </div>
  </section>;
}
