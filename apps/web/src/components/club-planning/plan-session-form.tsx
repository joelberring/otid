"use client";

import { useState, type FormEvent } from "react";
import type { ClubPlanResponse, ClubPlanSessionView, TrainingLevel, TrainingMoment } from "@o-tid/contracts";
import { isoWeekday } from "@o-tid/domain";
import { clubPlanningEn } from "../../i18n/club-planning-en";
import { clubPlanningSv } from "../../i18n/club-planning-sv";
import { isClock, isIsoDate } from "../../lib/form-validation";
import { useTexts } from "../language-provider";
import { MomentPicker, tagsFromText } from "../training-moments/moment-picker";
import { Button, DateInput, Field, Select } from "../ui";
import styles from "./club-planning.module.css";

export type PlanSessionFields = { sessionDate: string; startTime: string | null; title: string; place: string; note: string;
  clubMapId: string | null; trainingGroupId: string | null; responsibleAccountId: string | null; moments: TrainingMoment[]; levels: TrainingLevel[] };
type Body = { formatVersion: 1; tags: string[] } & PlanSessionFields & ({ requestId: string; termId: string; weekly: boolean } | { version: number });

/** ADR-0221: en planerad träning – ny (med "Varje vecka till terminens slut") eller ändrad. */
export function PlanSessionForm({ plan, termId, initialDate, session, busy, onSave, onCancel }: {
  plan: ClubPlanResponse; termId: string; initialDate?: string; session?: ClubPlanSessionView; busy: boolean;
  onSave: (body: Body) => Promise<void>; onCancel: () => void;
}) {
  const text = useTexts(clubPlanningSv, clubPlanningEn);
  const [fields, setFields] = useState<PlanSessionFields>(() => ({ sessionDate: session?.sessionDate ?? initialDate ?? "",
    startTime: session?.startTime ?? null, title: session?.title ?? "", place: session?.place ?? "", note: session?.note ?? "",
    clubMapId: session?.clubMapId ?? null, trainingGroupId: session?.trainingGroupId ?? null,
    responsibleAccountId: session?.responsibleAccountId ?? null, moments: [...session?.moments ?? []], levels: [...session?.levels ?? []] }));
  const [tags, setTags] = useState((session?.tags ?? []).join(", "));
  const [time, setTime] = useState(session?.startTime ?? "");
  const [weekly, setWeekly] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [tried, setTried] = useState(false);
  const set = <K extends keyof PlanSessionFields>(key: K, value: PlanSessionFields[K]) => setFields(current => ({ ...current, [key]: value }));
  const errors = { sessionDate: isIsoDate(fields.sessionDate) ? undefined : text.errors.invalid,
    time: time.trim() === "" || isClock(time) ? undefined : text.errors.invalid, title: fields.title.trim() ? undefined : text.errors.invalid };
  const leaders = plan.people.filter(person => person.leader);
  // Den ansvarige och gruppen som redan är valda står kvar i listan även om de inte längre finns bland valen.
  const groups = session?.trainingGroupId && !plan.groups.some(group => group.groupId === session.trainingGroupId)
    ? [...plan.groups, { groupId: session.trainingGroupId, name: session.groupName ?? "" }] : plan.groups;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    const clock = time.trim() === "" ? null : time.trim().replace(".", ":").padStart(5, "0").slice(0, 5);
    const values = { ...fields, startTime: clock, title: fields.title.trim(), place: fields.place.trim(), note: fields.note.trim(), tags: tagsFromText(tags) };
    await onSave(session ? { formatVersion: 1, version: session.version, ...values } : { formatVersion: 1, requestId, termId, weekly, ...values });
  }

  const weekday = isIsoDate(fields.sessionDate) ? text.weekdays[isoWeekday(fields.sessionDate) - 1] ?? "" : "";
  return <form className={styles.form} noValidate onSubmit={event => void submit(event)} aria-label={session ? text.session.edit : text.session.new}
    data-testid="plan-session-form">
    <div className={styles.inline}>
      <Field label={text.session.date} error={tried ? errors.sessionDate : undefined}>
        <DateInput value={fields.sessionDate} onChange={event => set("sessionDate", event.target.value.trim())} /></Field>
      <Field label={text.session.time} error={tried ? errors.time : undefined}>
        <input value={time} inputMode="numeric" maxLength={5} placeholder="18:00" onChange={event => setTime(event.target.value)} /></Field>
    </div>
    <Field label={text.session.title} error={tried ? errors.title : undefined}>
      <input value={fields.title} maxLength={160} placeholder={text.session.titlePlaceholder} onChange={event => set("title", event.target.value)} /></Field>
    <Field label={text.session.place}><input value={fields.place} maxLength={160} onChange={event => set("place", event.target.value)} /></Field>
    <div className={styles.inline}>
      <Select label={text.session.map} value={fields.clubMapId ?? ""} onChange={event => set("clubMapId", event.target.value || null)}>
        <option value="">{text.session.noMap}</option>
        {plan.maps.map(map => <option key={map.mapId} value={map.mapId}>{map.name}</option>)}
      </Select>
      <Select label={text.session.responsible} help={text.session.responsibleHelp} value={fields.responsibleAccountId ?? ""}
        onChange={event => set("responsibleAccountId", event.target.value || null)}>
        <option value="">{text.session.noResponsible}</option>
        {leaders.map(person => <option key={person.accountId} value={person.accountId}>{person.name}</option>)}
      </Select>
    </div>
    {groups.length > 0 && <Select label={text.session.group} help={text.session.groupHelp} value={fields.trainingGroupId ?? ""}
      onChange={event => set("trainingGroupId", event.target.value || null)}>
      <option value="">{text.session.noGroup}</option>
      {groups.map(group => <option key={group.groupId} value={group.groupId}>{group.name}</option>)}
    </Select>}
    <MomentPicker moments={fields.moments} levels={fields.levels} tags={tags} onChange={change => {
      if (change.moments) set("moments", change.moments);
      if (change.levels) set("levels", change.levels);
      if (change.tags !== undefined) setTags(change.tags);
    }} />
    <Field label={text.session.note}><textarea value={fields.note} maxLength={2000} onChange={event => set("note", event.target.value)} /></Field>
    {!session && <label className={styles.check}><input type="checkbox" checked={weekly} onChange={event => setWeekly(event.target.checked)} />
      <span>{text.session.weekly}</span></label>}
    {!session && weekly && weekday && <p className={styles.small}>{text.session.weeklyHelp(weekday)}</p>}
    <div className={styles.actions}>
      <Button type="submit" disabled={busy}>{text.session.save}</Button>
      <Button variant="quiet" onClick={onCancel}>{text.session.cancel}</Button>
    </div>
  </form>;
}
