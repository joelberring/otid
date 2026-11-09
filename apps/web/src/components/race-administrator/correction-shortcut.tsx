"use client";

import { useState } from "react";
import { correctionEn } from "../../i18n/workspace-small-en";
import { useTexts } from "../language-provider";
import styles from "../race-administrator-workspace.module.css";
import { correctionSv } from "../../i18n/correction-sv";
import { Button } from "../ui";
import type { Workspace } from "./workspace-state";

/**
 * ADR-0191 beslut 1: "Rätta en löpare" i Avläsning och Resultat. Ingen egen rättelse här, bara vägen till deltagarkortets
 * Rätta, där allt som ändrar en löpares resultat finns.
 */
export function CorrectionShortcut({ ws }: { ws: Workspace }) {
  const text = useTexts(correctionSv, correctionEn);
  const { data, disabled, functionary, openCorrection, raceId } = ws;
  const [entryId, setEntryId] = useState("");
  if (!data || functionary) return null;
  const id = `correction-shortcut-${raceId}`;
  const entries = [...data.entries].sort((a, b) => a.displayName.localeCompare(b.displayName, "sv"));
  const classNames = new Map(data.classes.map(row => [row.id, row.name]));
  return <section className={styles.fixShortcut} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{text.shortcutTitle}</h3>
    <p className={styles.workflowHelp}>{text.shortcutHelp}</p>
    <div className={styles.toolbarRow}>
      <label>{text.shortcutChoose}<select value={entryId} disabled={disabled} onChange={event => setEntryId(event.target.value)}>
        <option value="">{text.shortcutPlaceholder}</option>
        {entries.map(entry => <option key={entry.id} value={entry.id}>
          {entry.displayName} · {classNames.get(entry.classId) ?? ""}{entry.activeAssignment ? ` · ${entry.activeAssignment.cardNumber}` : ""}</option>)}
      </select></label>
      <Button variant="secondary" disabled={disabled || !entryId} onClick={() => openCorrection(entryId)}>{text.shortcutOpen}</Button>
    </div>
  </section>;
}
