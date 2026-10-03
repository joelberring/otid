import { useMemo, useState } from "react";
import type { ClassResultRecalculationAttempt, ClassResultRecalculationCandidates } from "../lib/class-result-recalculation-admin-client";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import styles from "./race-administrator-workspace.module.css";

type ClassOption = { id: string; name: string };

export function ClassResultRecalculation({ classes, disabled, candidates, attempt, unknown, error, saved,
  onLoad, onPrepare, onSubmit, onRetry, onCancel }: {
  classes: ClassOption[];
  disabled: boolean;
  candidates: ClassResultRecalculationCandidates | undefined;
  attempt: ClassResultRecalculationAttempt | undefined;
  unknown: boolean;
  error: string;
  saved: string;
  onLoad: (classId: string) => void;
  onPrepare: (entryIds: string[]) => void;
  onSubmit: (attempt: ClassResultRecalculationAttempt) => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const [classId, setClassId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const ready = useMemo(() => candidates?.entries.filter((entry) => entry.readiness === "READY") ?? [], [candidates]);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 100 ? current : [...current, id].sort());
  return <div className={styles.afterRecalculationContent}>
    <p>{text.classRecalculationHelp}</p>
    {error && <p className={styles.warning} role="alert">{error}</p>}
    {saved && <p role="status">{saved}</p>}
    {attempt ? <div className={styles.review} role="alert">
      <h3>{text.classRecalculationReview}</h3>
      <p>{attempt.className} · {text.classRecalculationSelected(attempt.entryIds.length)}</p>
      <p>{text.snapshot}: {attempt.request.snapshotVersion} · {text.engine}: {attempt.request.engineVersion}</p>
      <p>{text.classRecalculationManifest}: <code>{attempt.request.manifestHash}</code></p>
      <button disabled={disabled} onClick={() => unknown ? onRetry() : onSubmit(attempt)}>{unknown ? text.classRecalculationRetry : text.classRecalculationConfirm}</button>
      {!unknown && <button className="secondary" disabled={disabled} onClick={onCancel}>{text.cancel}</button>}
    </div> : <>
      <label>{text.classRecalculationClass}<select value={classId} disabled={disabled} onChange={(event) => { setClassId(event.target.value); setSelected([]); }}>
        <option value="">{text.chooseClass}</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <button type="button" className="secondary" disabled={disabled || !classId} onClick={() => { setSelected([]); onLoad(classId); }}>{text.classRecalculationLoad}</button>
      {candidates && candidates.classId === classId && <>
        <p>{text.classRecalculationSelected(selected.length)} · {text.classRecalculationManifest}: <code>{candidates.manifestHash}</code></p>
        <div className={styles.toolbar}><button type="button" className="secondary" disabled={disabled || ready.length === 0} onClick={() => setSelected(ready.slice(0, 100).map((entry) => entry.id).sort())}>{text.classRecalculationSelectAll}</button>
          <button type="button" className="secondary" disabled={disabled || selected.length === 0} onClick={() => setSelected([])}>{text.classRecalculationClear}</button></div>
        <ul className={styles.followUpList}>{candidates.entries.map((entry) => <li key={entry.id}>
          <label><input type="checkbox" checked={selected.includes(entry.id)} disabled={disabled || entry.readiness !== "READY"} onChange={() => toggle(entry.id)} />
            <span><strong>{entry.displayName}</strong><br />{text.classRecalculationReadiness[entry.readiness]}</span></label>
        </li>)}</ul>
        <button disabled={disabled || selected.length < 1 || selected.length > 100} onClick={() => onPrepare(selected)}>{text.classRecalculationReview}</button>
      </>}
    </>}
  </div>;
}
