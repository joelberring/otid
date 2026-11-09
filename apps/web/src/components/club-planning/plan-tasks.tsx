"use client";

import { useId, useState, type FormEvent } from "react";
import type { ClubPlanResponse, ClubPlanSessionView } from "@o-tid/contracts";
import { clubPlanningEn } from "../../i18n/club-planning-en";
import { clubPlanningSv } from "../../i18n/club-planning-sv";
import { useTexts } from "../language-provider";
import { Button, Field, Select } from "../ui";
import type { PlanChange } from "./plan-session-card";
import styles from "./club-planning.module.css";

type Who = "MEMBER" | "EMAIL" | "NONE";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * ADR-0221 beslut 3–4: uppgifterna på en planerad träning. Personen är en bekräftad medlem i klubben eller en e-postadress
 * (som blir kontots när hen loggar in); adressen syns bara här, för ledarna.
 */
export function PlanTasks({ plan, session, busy, change, toggle }: {
  plan: ClubPlanResponse; session: ClubPlanSessionView; busy: boolean; change: PlanChange;
  toggle: (taskId: string, done: boolean) => Promise<void>;
}) {
  const text = useTexts(clubPlanningSv, clubPlanningEn);
  const list = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [who, setWho] = useState<Who>("MEMBER");
  const [accountId, setAccountId] = useState("");
  const [email, setEmail] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [tried, setTried] = useState(false);
  /** Bocken syns direkt; planen läses om efter sparandet. */
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const errors = { title: title.trim() ? undefined : text.errors.invalid, accountId: who === "MEMBER" && !accountId ? text.errors.invalid : undefined,
    email: who === "EMAIL" && !EMAIL.test(email.trim()) ? text.errors.invalid : undefined };
  const path = `/sessions/${session.sessionId}/tasks`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    const assignee = who === "MEMBER" ? { kind: "MEMBER", accountId } : who === "EMAIL" ? { kind: "EMAIL", email: email.trim() } : { kind: "NONE" };
    const saved = await change(path, "POST", { formatVersion: 1, requestId, title: title.trim(), assignee },
      json => (json as { mailed?: boolean }).mailed ? text.task.mailed : text.task.added);
    if (saved) { setTitle(""); setAccountId(""); setEmail(""); setTried(false); setRequestId(crypto.randomUUID()); setOpen(false); }
  }

  return <div className={styles.tasks}>
    <h5>{text.task.title}</h5>
    {session.tasks.length === 0 ? <p className={styles.small}>{text.task.none}</p> : <ul>
      {session.tasks.map(task => <li key={task.taskId} data-testid="plan-task">
        <label className={styles.check}><input type="checkbox" checked={ticked[task.taskId] ?? task.done} disabled={busy}
          aria-label={`${text.task.done}: ${task.title}`} onChange={event => {
            const done = event.target.checked;
            setTicked(current => ({ ...current, [task.taskId]: done }));
            void toggle(task.taskId, done).finally(() => setTicked(current => { const next = { ...current }; delete next[task.taskId]; return next; }));
          }} />
          <span><strong>{task.title}</strong> · {task.assigneeName ?? (task.assigneeEmail ? `${task.assigneeEmail} (${text.task.pending})` : text.task.unassigned)}</span>
        </label>
        <Button variant="quiet" className={styles.noPrint} disabled={busy} aria-label={`${text.task.remove}: ${task.title}`}
          onClick={() => { if (window.confirm(text.task.removeConfirm(task.title))) void change(`${path}/${task.taskId}`, "DELETE", undefined); }}>×</Button>
      </li>)}
    </ul>}
    {!open ? <Button variant="quiet" className={styles.noPrint} disabled={busy} onClick={() => setOpen(true)}>{text.task.add}</Button>
      : <form className={styles.form} noValidate onSubmit={event => void submit(event)} aria-label={text.task.add}>
        <Field label={text.task.what} error={tried ? errors.title : undefined}>
          <input value={title} maxLength={120} list={list} onChange={event => setTitle(event.target.value)} /></Field>
        <datalist id={list}>{text.task.suggestions.map(option => <option key={option} value={option} />)}</datalist>
        <Select label={text.task.who} value={who} onChange={event => setWho(event.target.value as Who)}>
          <option value="MEMBER">{text.task.member}</option>
          <option value="EMAIL">{text.task.email}</option>
          <option value="NONE">{text.task.nobody}</option>
        </Select>
        {who === "MEMBER" && <Select label={text.task.chooseMember} value={accountId} error={tried ? errors.accountId : undefined}
          onChange={event => setAccountId(event.target.value)}>
          <option value="">{text.task.chooseMember}</option>
          {plan.people.map(person => <option key={person.accountId} value={person.accountId}>{person.name}</option>)}
        </Select>}
        {who === "EMAIL" && <Field label={text.task.email} help={text.task.emailHelp} error={tried ? errors.email : undefined}>
          <input type="email" value={email} maxLength={254} autoComplete="off" onChange={event => setEmail(event.target.value)} /></Field>}
        <div className={styles.actions}>
          <Button type="submit" disabled={busy}>{text.task.add}</Button>
          <Button variant="quiet" onClick={() => setOpen(false)}>{text.session.cancel}</Button>
        </div>
      </form>}
  </div>;
}
