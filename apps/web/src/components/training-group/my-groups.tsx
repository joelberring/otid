"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { GroupSummary } from "@o-tid/contracts";
import { GROUP_CODE_PATTERN, suggestGroupCode } from "@o-tid/domain";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { groupRequest } from "../../lib/training-group-client";
import { Button, Field, Notice } from "../ui";
import styles from "./training-group.module.css";

const text = trainingGroupSv.myGroups;

/**
 * Steg 68 (ADR-0182 beslut 2): Mina tävlingar → Mina grupper. Gruppen öppnas i ledarnas vy; en ny grupp får ett kortnamn
 * till länken som föreslås ur namnet.
 */
export function MyGroups() {
  const [groups, setGroups] = useState<GroupSummary[]>();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function load() {
    const result = await groupRequest("/api/organizer/groups");
    if (result.status === 200) setGroups((result.json as { groups: GroupSummary[] }).groups);
  }
  useEffect(() => { void load(); }, []);

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
  return <section className={styles.myGroups} aria-labelledby="my-groups-heading">
    <h2 id="my-groups-heading">{text.title}</h2>
    <p className={styles.muted}>{text.hint}</p>
    {groups && groups.length === 0 && <p className={styles.muted}>{text.empty}</p>}
    {groups && groups.length > 0 && <ul className={styles.groupList}>
      {groups.map(group => <li key={group.groupId}>
        <div><strong>{group.name}</strong><span>{text.role[group.role]} · {text.sessions(group.sessions)}</span></div>
        <div className={styles.rowActions}>
          <Link href={`/g/${group.code}`}>{text.publicPage}</Link>
          {group.role === "LEADER" && <Link className={styles.buttonLink} href={`/organizer/groups/${group.groupId}`}>{text.open}</Link>}
        </div>
      </li>)}
    </ul>}
    <details className={styles.createGroup}>
      <summary>{text.newGroup}</summary>
      <form className={styles.form} noValidate onSubmit={event => void create(event)}>
        <Field label={text.name}><input value={name} maxLength={120} placeholder={text.namePlaceholder} disabled={busy}
          onChange={event => { setName(event.target.value); setRequestId(crypto.randomUUID()); }} /></Field>
        <Field label={text.code} help={text.codeHelp(shownCode)}><input value={shownCode} maxLength={40} autoCapitalize="none" spellCheck={false}
          disabled={busy} onChange={event => { setCode(event.target.value); setCodeTouched(true); setRequestId(crypto.randomUUID()); }} /></Field>
        <Button type="submit" disabled={busy || !name.trim()} aria-busy={busy}>{text.create}</Button>
        {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      </form>
    </details>
  </section>;
}
