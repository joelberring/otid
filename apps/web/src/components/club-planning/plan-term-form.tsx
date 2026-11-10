"use client";

import { useState, type FormEvent } from "react";
import type { ClubTermView } from "@o-tid/contracts";
import { suggestedTerm, swedishToday } from "@o-tid/domain";
import { clubPlanningEn } from "../../i18n/club-planning-en";
import { clubPlanningSv } from "../../i18n/club-planning-sv";
import { isIsoDate } from "../../lib/form-validation";
import { useTexts } from "../language-provider";
import { Button, DateInput, Field } from "../ui";
import styles from "./club-planning.module.css";

type TermBody = { formatVersion: 1; requestId?: string; name: string; startsOn: string; endsOn: string };
const today = () => swedishToday(new Date());

/** ADR-0221: ny termin (med ett förslag på nästa termin) eller ändra namn och datum; ta bort när den är tom. */
export function PlanTermForm({ term, busy, onSave, onCancel, onRemove }: {
  term: ClubTermView | undefined; busy: boolean; onSave: (body: TermBody, termId?: string) => Promise<void>; onCancel: () => void;
  onRemove: (() => Promise<void>) | undefined;
}) {
  const text = useTexts(clubPlanningSv, clubPlanningEn);
  const [initial] = useState(() => term ?? suggestedTerm(today(), { name: text.term.spring }, { name: text.term.autumn }));
  const [name, setName] = useState(initial.name);
  const [startsOn, setStartsOn] = useState(initial.startsOn);
  const [endsOn, setEndsOn] = useState(initial.endsOn);
  const [requestId] = useState(() => crypto.randomUUID());
  const [tried, setTried] = useState(false);
  const errors = { name: name.trim() ? undefined : text.errors.invalid, startsOn: isIsoDate(startsOn) ? undefined : text.errors.invalid,
    endsOn: isIsoDate(endsOn) && endsOn >= startsOn ? undefined : text.errors.invalid };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    const body: TermBody = { formatVersion: 1, name: name.trim(), startsOn, endsOn };
    await onSave(term ? body : { ...body, requestId }, term?.termId);
  }

  return <form className={`${styles.form} ${styles.noPrint}`} noValidate onSubmit={event => void submit(event)} aria-label={term ? text.term.edit : text.term.add}>
    <Field label={text.term.name} error={tried ? errors.name : undefined}>
      <input value={name} maxLength={80} placeholder={text.term.namePlaceholder} onChange={event => setName(event.target.value)} /></Field>
    <div className={styles.inline}>
      <Field label={text.term.startsOn} error={tried ? errors.startsOn : undefined}>
        <DateInput value={startsOn} onChange={event => setStartsOn(event.target.value.trim())} /></Field>
      <Field label={text.term.endsOn} error={tried ? errors.endsOn : undefined}>
        <DateInput value={endsOn} onChange={event => setEndsOn(event.target.value.trim())} /></Field>
    </div>
    <div className={styles.actions}>
      <Button type="submit" disabled={busy}>{text.term.save}</Button>
      <Button variant="quiet" onClick={onCancel}>{text.session.cancel}</Button>
      {onRemove && <Button variant="quiet" disabled={busy} onClick={() => void onRemove()}>{text.term.remove}</Button>}
    </div>
  </form>;
}
