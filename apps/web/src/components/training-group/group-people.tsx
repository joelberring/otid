"use client";

import { useState, type FormEvent } from "react";
import type { GroupLeaderView } from "@o-tid/contracts";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { groupFailure, groupRequest } from "../../lib/training-group-client";
import { Button, Field, Notice } from "../ui";
import styles from "./training-group.module.css";
import { FromClubPicker } from "../club-affiliation/from-club-picker";

const text = trainingGroupSv.leader;

/**
 * Steg 68 (ADR-0182 beslut 1): ledare och medlemmar läggs till med e-post. ADR-0189 beslut 9: svaret är detsamma med och utan
 * konto; adressen står som "väntar på inloggning" tills personen loggar in med den.
 */
export function GroupPeople({ view, onChanged }: { view: GroupLeaderView; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"LEADER" | "MEMBER">("LEADER");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const leaders = view.members.filter(member => member.role === "LEADER" && !member.pending).length;

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest(`/api/organizer/groups/${view.groupId}/members`, "POST", { formatVersion: 1, requestId,
        email: email.trim(), role });
      if (result.status === 409) { setProblem(text.personExists); setRequestId(crypto.randomUUID()); return; }
      if (result.status !== 201 && result.status !== 200) { setProblem(groupFailure(result.status)); return; }
      setEmail(""); setRequestId(crypto.randomUUID()); onChanged();
    } finally { setBusy(false); }
  }

  async function remove(memberId: string) {
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest(`/api/organizer/groups/${view.groupId}/members`, "DELETE", { formatVersion: 1, memberId });
      if (result.status === 409) { setProblem(text.lastLeader); return; }
      if (result.status !== 200) { setProblem(groupFailure(result.status)); return; }
      onChanged();
    } finally { setBusy(false); }
  }

  return <>
    <p className={styles.muted}>{text.peopleHint}</p>
    <ul className={styles.plainList} aria-label={text.sections.people}>
      {view.members.map(member => <li key={member.memberId}>
        <div><strong>{member.displayName ?? member.email}</strong><span>{member.pending
          ? `${trainingGroupSv.myGroups.role[member.role]} · ${text.pending}`
          : [member.email, trainingGroupSv.myGroups.role[member.role]].filter(Boolean).join(" · ")}</span></div>
        {(member.pending || member.role !== "LEADER" || leaders > 1) && <Button variant="secondary" disabled={busy}
          aria-label={`${text.remove}: ${member.displayName ?? member.email}`} onClick={() => void remove(member.memberId)}>{text.remove}</Button>}
      </li>)}
    </ul>
    <form className={styles.form} noValidate onSubmit={event => void add(event)}>
      <div className={styles.inline}>
        <Field label={text.email}><input type="email" autoCapitalize="none" spellCheck={false} value={email} disabled={busy}
          onChange={event => { setEmail(event.target.value); setRequestId(crypto.randomUUID()); }} /></Field>
        <Field label={text.personRole}><select value={role} disabled={busy}
          onChange={event => { setRole(event.target.value as "LEADER" | "MEMBER"); setRequestId(crypto.randomUUID()); }}>
          <option value="LEADER">{trainingGroupSv.myGroups.role.LEADER}</option>
          <option value="MEMBER">{trainingGroupSv.myGroups.role.MEMBER}</option>
        </select></Field>
      </div>
      <Button type="submit" disabled={busy || !email.includes("@")}>{text.add}</Button>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
    </form>
    {/* ADR-0209: "Från klubben" med rollen som är vald ovan. */}
    <FromClubPicker context={{ kind: "TRAINING_GROUP", id: view.groupId }} role={role} roleLabel={trainingGroupSv.myGroups.role[role]} disabled={busy}
      onInvited={onChanged} />
  </>;
}
