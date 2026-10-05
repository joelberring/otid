"use client";

import styles from "../race-administrator-workspace.module.css";
import local from "./rogaining.module.css";
import { rogainingSv as text } from "../../i18n/rogaining-sv";
import { Button, EmptyState, Notice, Section, Table, numeric } from "../ui";
import type { Workspace } from "./workspace-state";

/**
 * Kontroller & poäng (ADR-0170 beslut 5): tidsgräns och straff per klass och poäng per kontroll, ändras direkt i
 * raderna. Ändras inget resultat sparas det direkt; annars visas beskedet och resultaten räknas om (ADR-0169).
 * Banorna (kontrollmängden) och klasserna ligger under, i samma del.
 */
export function RogainingPanel({ ws }: { ws: Workspace }) {
  const { busy, courseList, courseListError, pending, raceId, rogainingAttempt, rogainingError, rogainingPoints, rogainingPreview,
    rogainingRules, rogainingSaved, changeRogainingPoints, changeRogainingRule, previewRogaining, resetRogaining, saveRogaining, shows } = ws;
  if (!shows("ROGAINING")) return null;
  const setup = courseList?.rogaining;
  const classes = courseList?.classes ?? [];
  const locked = busy || !!rogainingAttempt || (!!pending.current && !rogainingAttempt);
  const edited = Object.keys(rogainingPoints).length + Object.keys(rogainingRules).length > 0;
  const id = `rogaining-${raceId}`;
  return <Section id={id} title={text.title} help={text.help}>
    {rogainingSaved && <Notice tone="ok" role="status">{rogainingSaved}</Notice>}
    {!setup && !courseListError && <p role="status" className={styles.workflowHelp}>{text.loading}</p>}
    {setup && setup.controls.length === 0 && <EmptyState title={text.noControls}>{text.noControlsHelp}</EmptyState>}
    {setup && setup.controls.length > 0 && <form className={local.form} aria-label={text.title}
      onSubmit={event => { event.preventDefault(); void saveRogaining(); }}>
      {classes.length > 0 && <div className={local.part}>
        <h3>{text.classesTitle}</h3>
        <Table className={local.rules}>
          <thead><tr><th scope="col">{text.className}</th><th scope="col" className={numeric}>{text.timeLimit}</th>
            <th scope="col" className={numeric}>{text.penalty}</th></tr></thead>
          <tbody>{classes.map(raceClass => {
            const stored = setup.classes.find(row => row.classId === raceClass.classId)?.rules ?? null;
            const input = rogainingRules[raceClass.classId];
            const limit = input?.limit ?? (stored ? String(stored.timeLimitMinutes) : "");
            const penalty = input?.penalty ?? (stored ? String(stored.penaltyPoints) : "");
            return <tr key={raceClass.classId}>
              <th scope="row">{raceClass.name}{!stored && <span className={local.note}>{text.notRogaining}</span>}</th>
              <td className={numeric}><input className={local.number} type="text" inputMode="numeric" value={limit} disabled={locked}
                aria-label={text.timeLimitLabel(raceClass.name)} onChange={event => changeRogainingRule(raceClass.classId, "limit", event.target.value)} /></td>
              <td className={numeric}><input className={local.number} type="text" inputMode="numeric" value={penalty} disabled={locked}
                aria-label={text.penaltyLabel(raceClass.name)} onChange={event => changeRogainingRule(raceClass.classId, "penalty", event.target.value)} /></td>
            </tr>;
          })}</tbody>
        </Table>
      </div>}
      <div className={local.part}>
        <h3>{text.controlsTitle}</h3>
        <ul className={local.controls}>{setup.controls.map(control => {
          const value = rogainingPoints[control.code] ?? String(control.points);
          const changed = control.points !== control.defaultPoints;
          return <li key={control.code}>
            <label><span className={local.code}>{control.code}</span>
              <input className={local.number} type="text" inputMode="numeric" value={value} disabled={locked}
                aria-label={text.controlLabel(control.code)} onChange={event => changeRogainingPoints(control.code, event.target.value)} />
              <span className={local.unit} aria-hidden="true">p</span></label>
            {changed && <span className={local.note}>{text.changed(control.defaultPoints)}</span>}
          </li>;
        })}</ul>
      </div>
      {rogainingPreview && <section className={styles.review} role="status" aria-live="polite">
        {rogainingPreview.readOutCount === 0 ? <p>{text.nobodyReadOut}</p>
          : rogainingPreview.changes.length === 0 ? <p>{text.noResultChange(rogainingPreview.readOutCount)}</p> : <>
            <h3>{text.changesTitle(rogainingPreview.changes.length)}</h3>
            <ul className={styles.changeList}>{rogainingPreview.changes.map(change => <li key={change.entryId}>
              <strong>{change.displayName}</strong> · {change.className} · {text.outcome(text.status[change.before.status]!, change.before.total)}
              {" → "}{text.outcome(text.status[change.after.status]!, change.after.total)}
            </li>)}</ul>
            <p>{text.confirmHelp}</p>
          </>}
        {rogainingPreview.notRecalculatedCount > 0 && <Notice tone="attention">{text.notRecalculated(rogainingPreview.notRecalculatedCount)}</Notice>}
      </section>}
      {rogainingError && <Notice tone="error" role="alert">{rogainingError}</Notice>}
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || (!edited && !rogainingAttempt)}>
          {rogainingPreview?.requiresConfirmation ? text.saveConfirmed : text.save}</Button>
        <Button variant="secondary" disabled={locked || !edited} onClick={() => void previewRogaining()}>{text.preview}</Button>
        {edited && !rogainingAttempt && <Button variant="quiet" disabled={busy} onClick={resetRogaining}>{text.reset}</Button>}
      </div>
    </form>}
  </Section>;
}
