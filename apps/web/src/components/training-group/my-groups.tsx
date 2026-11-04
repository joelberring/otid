"use client";

import { useState, type FormEvent } from "react";
import type { GroupSummary } from "@o-tid/contracts";
import { GROUP_CODE_PATTERN, suggestGroupCode } from "@o-tid/domain";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { groupRequest } from "../../lib/training-group-client";
import { Button, Field, Notice } from "../ui";
import styles from "./training-group.module.css";

const text = trainingGroupSv.myGroups;

/**
 * Steg 68 (ADR-0182 beslut 2): en ny träningsgrupp från Mina tävlingar; kortnamnet till länken föreslås ur namnet. Ägaren
 * 2026-11-04: en liten åtgärd i remsan Mina grupper överst (`MyPlacesStrip`).
 */
export function NewGroupForm({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function create(event: FormEvent) {
    event.preventDefault();
    const shownCode = codeTouched ? code.trim().toLowerCase() : suggestGroupCode(name);
    if (!name.trim() || !GROUP_CODE_PATTERN.test(shownCode)) { setProblem(text.errors.invalid); return; }
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest("/api/organizer/groups", "POST", { formatVersion: 1, requestId, name: name.trim(), code: shownCode });
      if (result.status === 409) { setProblem(text.errors.taken); setRequestId(crypto.randomUUID()); return; }
      if (result.status !== 201 && result.status !== 200) { setProblem(result.status === 400 ? text.errors.invalid : text.errors.generic); return; }
      const group = (result.json as { group: GroupSummary }).group;
      window.location.assign(`/organizer/groups/${encodeURIComponent(group.groupId)}`);
    } finally { setBusy(false); }
  }

  const shownCode = codeTouched ? code : suggestGroupCode(name);
  return <>
    <Button variant="secondary" className={styles.smallAction} aria-expanded={open} onClick={onToggle}>{text.newGroup}</Button>
    {open && <form className={`${styles.form} ${styles.createInline}`} noValidate onSubmit={event => void create(event)}>
      <Field label={text.name}><input value={name} maxLength={120} placeholder={text.namePlaceholder} disabled={busy} autoFocus
        onChange={event => { setName(event.target.value); setRequestId(crypto.randomUUID()); }} /></Field>
      <Field label={text.code} help={text.codeHelp(shownCode)}><input value={shownCode} maxLength={40} autoCapitalize="none" spellCheck={false}
        disabled={busy} onChange={event => { setCode(event.target.value); setCodeTouched(true); setRequestId(crypto.randomUUID()); }} /></Field>
      <Button type="submit" disabled={busy || !name.trim()} aria-busy={busy}>{text.create}</Button>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    </form>}
  </>;
}
