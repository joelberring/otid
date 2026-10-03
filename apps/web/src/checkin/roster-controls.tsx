import React, { useState, type FormEvent } from "react";
import type { StartCheckinOperation, StartCheckinRosterResponse } from "@o-tid/contracts";
import type { CheckinVaultSnapshot } from "../lib/checkin-vault";
import { checkinLocalView } from "../lib/checkin-local-view";
import { checkinRosterText as t } from "./roster-text-sv";

type Entry = StartCheckinRosterResponse["entries"][number];
type State = StartCheckinOperation["action"]["state"];

const states: readonly State[] = ["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"];

function plannedStart(entry: Entry, timeZone: string): string {
  if (entry.startRule === "PUNCH") return t.freeStart;
  if (entry.fixedStartTime === null) return "–";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset"
  }).format(new Date(entry.fixedStartTime));
}

function card(entry: Entry): string {
  return entry.multipleActiveAssignments ? t.multipleCards : entry.cardNumber ?? t.noCard;
}

function PrintRoster({ entries, snapshot, classLabel }: { entries: Entry[]; snapshot: CheckinVaultSnapshot; classLabel: string }) {
  return <section className="checkin-print" aria-label={t.printTitle}>
    <h2>{t.printTitle}</h2><p>{t.printHelp}</p>
    <p>{t.printBasis}: {snapshot.roster.snapshotVersion} · {snapshot.roster.generatedAt} · {snapshot.roster.timeZone}</p>
    <p>{t.printFilter}: {classLabel} · {entries.length} {t.of} {snapshot.roster.entries.length}</p>
    <table><thead><tr><th scope="col">{t.name}</th><th scope="col">{t.club}</th><th scope="col">{t.className}</th>
      <th scope="col">{t.plannedStart}</th><th scope="col">{t.card}</th><th scope="col">{t.printPaperMark}</th></tr></thead>
      <tbody>{entries.map((entry) => <tr key={entry.entryId}><td>{entry.displayName}</td><td>{entry.organisationName ?? t.noClub}</td>
        <td>{entry.className}</td><td>{plannedStart(entry, snapshot.roster.timeZone)}</td><td>{card(entry)}</td><td aria-label={t.printPaperMark}>□</td></tr>)}</tbody>
    </table>
  </section>;
}

function EntryDetails({ entry, snapshot }: { entry: Entry; snapshot: CheckinVaultSnapshot }) {
  const local = checkinLocalView(entry, snapshot.operations);
  return <>
    <h3>{entry.displayName}</h3>
    <p>{t.className}: {entry.className}</p>
    <p>{t.club}: {entry.organisationName ?? t.noClub}</p>
    <p>{t.card}: {card(entry)}</p>
    <p>{t.plannedStart}: {plannedStart(entry, snapshot.roster.timeZone)}</p>
    <p>{t.serverStart}: {t.startStates[entry.startState]}</p>
    <p>{t.localIntent}: {t.startStates[local.state]}</p>
    <p>{t.pending}: {local.pending}</p>
    <p>{t.conflicts}: {local.conflicts}</p>
    <p>{t.reviewedConflicts}: {local.reviewedConflicts}</p>
    {entry.conflictingReports && <p role="alert">{t.historicalConflict}</p>}
  </>;
}

function StartActions({ entry, snapshot, writing, busy, onMark }: {
  entry: Entry; snapshot: CheckinVaultSnapshot; writing: boolean; busy: boolean;
  onMark: (entryId: string, action: StartCheckinOperation["action"]) => void;
}) {
  const local = checkinLocalView(entry, snapshot.operations);
  return <div className="checkin-actions" aria-label={`${t.startSave}: ${entry.displayName}`}>
    {states.map((state) => <button key={state} type="button"
      disabled={!writing || busy || local.conflicts > 0 || state === local.state}
      onClick={() => onMark(entry.entryId, { kind: "MARK_START", state })}>{t.startActions[state]}</button>)}
  </div>;
}

function FinishAction({ entry, snapshot, writing, busy, onMark }: {
  entry: Entry; snapshot: CheckinVaultSnapshot; writing: boolean; busy: boolean;
  onMark: (entryId: string, action: StartCheckinOperation["action"]) => void;
}) {
  const local = checkinLocalView(entry, snapshot.operations);
  const [state, setState] = useState<State>(local.state);
  const [manualReturnRegistered, setManualReturnRegistered] = useState(local.manualReturnRegistered);
  const unchanged = state === local.state && manualReturnRegistered === local.manualReturnRegistered;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!writing || busy || local.conflicts > 0 || unchanged) return;
    onMark(entry.entryId, { kind: "FINISH_CORRECTION", state, manualReturnRegistered });
  };
  return <form aria-label={`${t.finishSave}: ${entry.displayName}`} onSubmit={submit}>
    <label>{t.finishState}<select aria-label={t.finishState} value={state} disabled={!writing || busy || local.conflicts > 0}
      onChange={(event) => setState(event.target.value as State)}>
      {states.map((value) => <option key={value} value={value}>{t.startStates[value]}</option>)}
    </select></label>
    <label><input type="checkbox" checked={manualReturnRegistered} disabled={!writing || busy || local.conflicts > 0}
      onChange={(event) => setManualReturnRegistered(event.target.checked)} />{t.manualReturn}</label>
    <button disabled={!writing || busy || local.conflicts > 0 || unchanged}>{t.finishSave}</button>
  </form>;
}

export function CheckinRosterControls({ snapshot, writing, busy, onWritingChange, onMark }: {
  snapshot: CheckinVaultSnapshot; writing: boolean; busy: boolean;
  onWritingChange: (value: boolean) => void;
  onMark: (entryId: string, action: StartCheckinOperation["action"]) => void;
}) {
  const [classId, setClassId] = useState("");
  const classes = [...new Map(snapshot.roster.entries.map((entry) => [entry.classId, entry.className])).entries()];
  const entries = snapshot.roster.entries.filter((entry) => !classId || entry.classId === classId);
  const classLabel = classId ? classes.find(([id]) => id === classId)?.[1] ?? t.allClasses : t.allClasses;
  const isStart = snapshot.registration.capability === "START_CHECKIN";
  return <section aria-label={t.title}>
    <h2>{t.title}</h2>
    <label>{t.classFilter}<select aria-label={t.classFilter} value={classId} disabled={busy} onChange={(event) => setClassId(event.target.value)}>
      <option value="">{t.allClasses}</option>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <label><input type="checkbox" checked={writing} disabled={busy} onChange={(event) => onWritingChange(event.target.checked)} />{t.writing}</label>
    <p>{writing ? t.writingOn : t.writingOff} {t.writingHelp}</p>
    <p>{t.localKnowledge}</p>
    <p>{t.shown} {entries.length} {t.of} {snapshot.roster.entries.length}</p>
    {isStart && <button type="button" disabled={busy} onClick={() => window.print()}>{t.print}</button>}
    {isStart && <PrintRoster entries={entries} snapshot={snapshot} classLabel={classLabel} />}
    {entries.length === 0 && <p>{t.noEntries}</p>}
    {entries.map((entry) => <article key={`${entry.entryId}-${snapshot.version}`} aria-label={entry.displayName}>
      <EntryDetails entry={entry} snapshot={snapshot} />
      {isStart ? <StartActions entry={entry} snapshot={snapshot} writing={writing} busy={busy} onMark={onMark} />
        : <FinishAction key={`${entry.entryId}-${snapshot.version}`} entry={entry} snapshot={snapshot} writing={writing} busy={busy} onMark={onMark} />}
    </article>)}
  </section>;
}
