"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  classControlNeutralizationCandidateSchema,
  classControlNeutralizationRequestSchema,
  classControlNeutralizationResponseSchema,
  type ClassControlNeutralizationCandidate,
  type ClassControlNeutralizationRequest
} from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import styles from "./race-administrator-workspace.module.css";

type Attempt = { candidate: ClassControlNeutralizationCandidate; request: ClassControlNeutralizationRequest };

export function ClassControlNeutralization({ raceId, classes, onCommitted, onPendingChange }: {
  raceId: string;
  classes: readonly { id: string; name: string }[];
  onCommitted: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [classId, setClassId] = useState(""), [candidate, setCandidate] = useState<ClassControlNeutralizationCandidate>();
  const [controlId, setControlId] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [outcomeUncertain, setOutcomeUncertain] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const pending = busy || Boolean(candidate) || Boolean(attempt);
  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator/classes`;
  async function loadCandidate() {
    if (!classId || busy) return;
    setBusy(true); setError(""); setCandidate(undefined); setControlId(""); setAcknowledged(false);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(classId)}/control-neutralization`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("candidate");
      const value = classControlNeutralizationCandidateSchema.parse(await response.json());
      if (value.raceId !== raceId || value.classId !== classId) throw new Error("scope");
      setCandidate(value);
    } catch { setError("Underlaget kunde inte läsas. Uppdatera och försök igen."); }
    finally { setBusy(false); }
  }
  function inspect(event: FormEvent) {
    event.preventDefault();
    if (!candidate || !controlId || !acknowledged || busy) return;
    const control = candidate.controls.find((value) => value.id === controlId);
    if (!control) { setError("Välj en kontrollförekomst i den visade banan."); return; }
    const parsed = classControlNeutralizationRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      expectedSnapshotVersion: candidate.snapshotVersion, expectedBasisHash: candidate.basisHash, classId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId, courseControlId: control.id, sequence: control.sequence,
      controlCode: control.controlCode, acknowledgedNoAutomaticRecalculation: true });
    if (!parsed.success) { setError("Valet kunde inte granskas."); return; }
    setAttempt({ candidate, request: parsed.data }); setError("");
  }
  async function commit() {
    if (!attempt || busy) return;
    setBusy(true); setError("");
    try {
      const csrf = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
      if (!csrf) throw new Error("csrf");
      setOutcomeUncertain(true);
      const response = await fetch(`${base}/${encodeURIComponent(attempt.candidate.classId)}/control-neutralization`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-otid-csrf": csrf,
          "idempotency-key": `class-control-neutralization:${attempt.request.requestId}` }, body: JSON.stringify(attempt.request)
      });
      if (response.status === 409) { setOutcomeUncertain(false); setAttempt(undefined); setCandidate(undefined); setError("Underlaget har ändrats. Läs in klassen igen och granska på nytt."); return; }
      if (!response.ok) throw new Error("commit");
      const receipt = classControlNeutralizationResponseSchema.parse(await response.json());
      if (receipt.raceId !== raceId || receipt.classId !== attempt.candidate.classId || receipt.requestId !== attempt.request.requestId ||
          JSON.stringify(receipt.request) !== JSON.stringify(attempt.request)) throw new Error("receipt");
      setOutcomeUncertain(false);
      setAttempt(undefined); setCandidate(undefined); setAcknowledged(false); onCommitted();
    } catch { setError("Svaret är osäkert. Bekräfta inte igen med ett nytt val; försök med samma granskade begäran."); }
    finally { setBusy(false); }
  }
  return <details className={styles.courseClassPanel} open={isOpen || pending} onToggle={(event) => {
    if (pending && !event.currentTarget.open) event.currentTarget.open = true;
    else if (!pending) setIsOpen(event.currentTarget.open);
  }}>
    <summary>Neutralisera en kontroll för klass</summary>
    <form className={styles.panel} onSubmit={inspect}>
      <p>Gör en exakt kontrollförekomst frivillig för denna klass. Råstämplingar och gamla resultat ändras inte; omräkning görs separat.</p>
      <label>Klass<select value={classId} disabled={busy || !!attempt} onChange={(event) => { setClassId(event.target.value); setCandidate(undefined); setError(""); }}>
        <option value="">Välj klass</option>{classes.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
      </select></label>
      {!candidate && !attempt && <button type="button" disabled={!classId || busy} onClick={() => void loadCandidate()}>Läs in kontrollföljd</button>}
      {candidate && !attempt && <>
        <p><strong>{candidate.className}</strong> · banversion {candidate.courseVersion} · {candidate.historicalResultRevisionCount} äldre resultatrevisioner.</p>
        <label>Kontrollförekomst<select value={controlId} disabled={busy} onChange={(event) => setControlId(event.target.value)}>
          <option value="">Välj exakt förekomst</option>{candidate.controls.map((control) => <option key={control.id} value={control.id}>#{control.sequence} · kod {control.controlCode}</option>)}
        </select></label>
        <label className={styles.confirmPerson}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />Jag förstår att gamla resultat inte räknas om automatiskt.</label>
        <button type="submit" disabled={!controlId || !acknowledged || busy}>Granska neutralisering</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setCandidate(undefined); setControlId(""); setAcknowledged(false); setError(""); }}>{text.cancel}</button>
      </>}
      {attempt && <section className={styles.review} role="alert" aria-live="polite">
        <h2>Bekräfta neutralisering</h2><p><strong>{attempt.candidate.className}</strong>: förekomst #{attempt.request.sequence}, kod {attempt.request.controlCode} blir frivillig.</p>
        <p>Inga tidigare resultat eller råstämplingar ändras. Omräkning görs separat efter detta beslut.</p>
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void commit()}>Bekräfta neutralisering</button>{!outcomeUncertain && <><button type="button" className="secondary" disabled={busy} onClick={() => setAttempt(undefined)}>Ändra</button><button type="button" className="secondary" disabled={busy} onClick={() => { setAttempt(undefined); setCandidate(undefined); setControlId(""); setAcknowledged(false); }}>{text.cancel}</button></>}</div>
      </section>}
      {error && <p className={styles.warning} role="alert">{error}</p>}
    </form>
  </details>;
}
