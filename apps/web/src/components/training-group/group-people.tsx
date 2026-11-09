"use client";

import { useState, type FormEvent } from "react";
import { formErrorsEn } from "../../i18n/workspace-small-en";
import { useTexts } from "../language-provider";
import { INVITATION_BULK_MAX, invitationMailOutcomeSchema, type GroupLeaderView } from "@o-tid/contracts";
import { formErrorsSv } from "../../i18n/form-errors-sv";
import { invitationMailNote, invitationSummary, invitationSv } from "../../i18n/invitation-sv";
import { fatalStatus, inviteAll, parseInvitationAddresses } from "../../lib/invitation-bulk";
import { InvitationActions, invitationSentText } from "../invitation-actions";
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
  const formText = useTexts(formErrorsSv, formErrorsEn);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"LEADER" | "MEMBER">("LEADER");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const mailEnabled = view.mailEnabled ?? false;
  const leaders = view.members.filter(member => member.role === "LEADER" && !member.pending).length;

  /** ADR-0206: en eller flera adresser med samma roll, var sin inbjudan och var sitt mejl. */
  async function add(event: FormEvent) {
    event.preventDefault();
    const { addresses, invalid } = parseInvitationAddresses(email);
    setProblem(""); setNotice("");
    if (addresses.length === 0) { setProblem(invalid.length ? formText.email : invitationSv.bulk.none); return; }
    if (addresses.length > INVITATION_BULK_MAX) { setProblem(invitationSv.bulk.tooMany(INVITATION_BULK_MAX)); return; }
    const post = (address: string, id: string) => groupRequest(`/api/organizer/groups/${view.groupId}/members`, "POST", { formatVersion: 1,
      requestId: id, email: address, role });
    const mailOf = (json: unknown) => invitationMailOutcomeSchema.catch("off").parse((json as { mail?: unknown } | undefined)?.mail);
    setBusy(true);
    try {
      if (addresses.length === 1 && invalid.length === 0) {
        const result = await post(addresses[0]!, requestId);
        setRequestId(crypto.randomUUID());
        if (result.status === 409) { setProblem(text.personExists); return; }
        if (result.status !== 201 && result.status !== 200) { setProblem(groupFailure(result.status)); return; }
        setNotice(invitationMailNote[mailOf(result.json)]);
        setEmail(""); onChanged();
        return;
      }
      const { tally, fatal } = await inviteAll(addresses, invalid.length, async address => {
        const result = await post(address, crypto.randomUUID());
        if (result.status === 201 || result.status === 200) return mailOf(result.json);
        if (fatalStatus(result.status)) return { fatal: result.status };
        return result.status === 409 ? "existing" : "error";
      });
      if (fatal) { setProblem(groupFailure(fatal)); return; }
      if (tally.other || tally.invalid) setProblem(invitationSummary(tally)); else setNotice(invitationSummary(tally));
      setEmail(""); onChanged();
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
          ? [trainingGroupSv.myGroups.role[member.role], text.pending, invitationSentText(member.sentAt, mailEnabled)].filter(Boolean).join(" · ")
          : [member.email, trainingGroupSv.myGroups.role[member.role]].filter(Boolean).join(" · ")}</span></div>
        {(member.pending || member.role !== "LEADER" || leaders > 1) && <div className={styles.memberActions}>
          {member.pending && <InvitationActions name={member.displayName ?? member.email} fromClub={!member.email}
            mailEnabled={mailEnabled} disabled={busy} onSent={onChanged}
            endpoint={`/api/organizer/groups/${view.groupId}/invitations/${member.memberId}`} />}
          <Button variant="secondary" disabled={busy}
            aria-label={`${text.remove}: ${member.displayName ?? member.email}`} onClick={() => void remove(member.memberId)}>{text.remove}</Button>
        </div>}
      </li>)}
    </ul>
    <form className={styles.form} noValidate onSubmit={event => void add(event)}>
      <div className={styles.inline}>
        <Field label={text.email} help={invitationSv.bulk.help}><textarea rows={2} autoCapitalize="none" spellCheck={false} value={email}
          disabled={busy} onChange={event => { setEmail(event.target.value); setRequestId(crypto.randomUUID()); }} /></Field>
        <Field label={text.personRole}><select value={role} disabled={busy}
          onChange={event => { setRole(event.target.value as "LEADER" | "MEMBER"); setRequestId(crypto.randomUUID()); }}>
          <option value="LEADER">{trainingGroupSv.myGroups.role.LEADER}</option>
          <option value="MEMBER">{trainingGroupSv.myGroups.role.MEMBER}</option>
        </select></Field>
      </div>
      <Button type="submit" disabled={busy || !email.includes("@")}>{text.add}</Button>
      {problem && <Notice tone="error" role="alert">{problem}</Notice>}
      {notice && <Notice tone="ok" role="status">{notice}</Notice>}
    </form>
    {/* ADR-0209: "Från klubben" med rollen som är vald ovan. */}
    <FromClubPicker context={{ kind: "TRAINING_GROUP", id: view.groupId }} role={role} roleLabel={trainingGroupSv.myGroups.role[role]} disabled={busy}
      onInvited={onChanged} />
  </>;
}
