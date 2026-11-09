"use client";

import { invitationMailNoteEn, invitationSummaryEn } from "../../i18n/workspace-last-en";
import { useClubFailure } from "./use-club-failure";
import { useState, type FormEvent } from "react";
import { clubArchiveEn } from "../../i18n/club-archive-en";
import { formErrorsEn } from "../../i18n/workspace-small-en";
import { useTexts } from "../language-provider";
import { INVITATION_BULK_MAX, invitationMailOutcomeSchema, type ClubRole, type ClubView } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { formErrorsSv } from "../../i18n/form-errors-sv";
import { invitationMailNote, invitationSummary, invitationSv } from "../../i18n/invitation-sv";
import { fatalStatus, inviteAll, parseInvitationAddresses } from "../../lib/invitation-bulk";
import { InvitationActions, invitationSentText } from "../invitation-actions";
import { clubBase, clubRequest } from "../../lib/club-archive-client";
import { Button, Field, Notice, Select } from "../ui";
import styles from "./club-archive.module.css";
import { FromClubPicker } from "../club-affiliation/from-club-picker";

const ROLES: readonly ClubRole[] = ["READER", "LEADER", "ADMIN", "OWNER"];

/**
 * ADR-0194 beslut 1: klubbens medlemmar och inbjudningar. Bjud in med e-postadressen (samma svar med och utan konto); listan
 * visar adressen som "väntar på inloggning" tills personen loggat in med den. Medlemmar och ledare ser bara sin egen rad (ADR-0209).
 */
export function ClubMembersPanel({ club, onChanged }: { club: ClubView; onChanged: () => Promise<void> }) {
  const failure = useClubFailure();
  const clubArchiveText = useTexts(clubArchiveSv, clubArchiveEn);
  const text = useTexts(clubArchiveSv.members, clubArchiveEn.members);
  const formText = useTexts(formErrorsSv, formErrorsEn);
  const mailNoteText = useTexts(invitationMailNote, invitationMailNoteEn);
  const summaryText = useTexts(invitationSummary, invitationSummaryEn);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ClubRole>("READER");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const admin = club.viewer.role === "OWNER" || club.viewer.role === "ADMIN";
  const owner = club.viewer.role === "OWNER";
  const mailEnabled = club.mailEnabled ?? false;

  async function run(action: () => Promise<{ status: number }>, ok: string, conflict?: string) {
    setBusy(true); setMessage(undefined);
    try {
      const result = await action();
      if (result.status >= 200 && result.status < 300) { setMessage({ tone: "ok", text: ok }); await onChanged(); return true; }
      setMessage({ tone: "error", text: result.status === 409 && conflict ? conflict : failure(result.status) });
      return false;
    } finally { setBusy(false); }
  }

  /** ADR-0206: en eller flera adresser, var sin inbjudan och var sitt mejl. */
  async function invite(event: FormEvent) {
    event.preventDefault();
    const { addresses, invalid } = parseInvitationAddresses(email);
    if (addresses.length === 0) { setMessage({ tone: "error", text: invalid.length ? formText.email : invitationSv.bulk.none }); return; }
    if (addresses.length > INVITATION_BULK_MAX) { setMessage({ tone: "error", text: invitationSv.bulk.tooMany(INVITATION_BULK_MAX) }); return; }
    const post = (address: string, id: string) => clubRequest(`${clubBase(club.clubId)}/members`, "POST", { formatVersion: 1, requestId: id,
      email: address, role });
    setBusy(true); setMessage(undefined);
    try {
      if (addresses.length === 1 && invalid.length === 0) {
        const result = await post(addresses[0]!, requestId);
        setRequestId(crypto.randomUUID());
        if (result.status === 200 || result.status === 201) {
          const mail = invitationMailOutcomeSchema.catch("off").parse((result.json as { mail?: unknown } | undefined)?.mail);
          setMessage({ tone: "ok", text: `${text.invited} ${mailNoteText[mail]}` });
          setEmail(""); await onChanged();
        } else setMessage({ tone: "error", text: result.status === 409 ? text.exists : failure(result.status) });
        return;
      }
      const { tally, fatal } = await inviteAll(addresses, invalid.length, async address => {
        const result = await post(address, crypto.randomUUID());
        if (result.status === 200 || result.status === 201) {
          return invitationMailOutcomeSchema.catch("off").parse((result.json as { mail?: unknown } | undefined)?.mail);
        }
        if (fatalStatus(result.status)) return { fatal: result.status };
        return result.status === 409 ? "existing" : "error";
      });
      setMessage(fatal ? { tone: "error", text: failure(fatal) } : { tone: tally.other || tally.invalid ? "error" : "ok", text: summaryText(tally) });
      if (!fatal) setEmail("");
      await onChanged();
    } finally { setBusy(false); }
  }

  const remove = (who: string, body: { memberId: string | null; invitationId: string | null }) => {
    if (!window.confirm(text.removeConfirm(who))) return;
    void run(() => clubRequest(`${clubBase(club.clubId)}/members`, "DELETE", { formatVersion: 1, ...body }), clubArchiveText.entry.saved, text.lastOwner);
  };

  return <section className={styles.cards} aria-labelledby="club-members">
    <div>
      <h2 id="club-members">{text.title}</h2>
      <p className={styles.muted}>{admin ? text.help : text.readerHelp}</p>
    </div>
    <ul className={styles.list} data-testid="club-members">
      {club.members.map(member => <li key={member.memberId}>
        <div><strong>{member.displayName}{member.you ? ` (${text.you})` : ""}</strong>
          <span>{clubArchiveText.roles[member.role]}{member.email ? ` · ${member.email}` : ""}</span></div>
        {admin && !member.you && (owner || member.role !== "OWNER") && <div className={styles.actions}>
          <select aria-label={`${text.changeRole}: ${member.displayName}`} value={member.role} disabled={busy}
            onChange={event => void run(() => clubRequest(`${clubBase(club.clubId)}/members`, "PUT", { formatVersion: 1, memberId: member.memberId,
              role: event.target.value }), clubArchiveText.entry.saved, text.lastOwner)}>
            {ROLES.filter(value => owner || value !== "OWNER").map(value => <option key={value} value={value}>{clubArchiveText.roles[value]}</option>)}
          </select>
          <Button variant="secondary" disabled={busy} onClick={() => remove(member.displayName, { memberId: member.memberId, invitationId: null })}>
            {text.remove}</Button>
        </div>}
      </li>)}
      {club.invitations.map(invitation => <li key={invitation.invitationId} data-testid="club-invitation">
        <div><strong>{invitation.displayName ?? invitation.email}</strong><span>{[clubArchiveText.roles[invitation.role], text.pending,
          invitationSentText(invitation.sentAt, mailEnabled)].filter(Boolean).join(" · ")}</span></div>
        {(owner || invitation.role !== "OWNER") && <div className={styles.actions}>
          <InvitationActions name={invitation.displayName ?? invitation.email} fromClub={invitation.displayName !== undefined}
            mailEnabled={mailEnabled} disabled={busy} onSent={onChanged}
            endpoint={`${clubBase(club.clubId)}/invitations/${invitation.invitationId}`} />
          <Button variant="secondary" disabled={busy}
            onClick={() => remove(invitation.displayName ?? invitation.email, { memberId: null, invitationId: invitation.invitationId })}>
            {text.remove}</Button>
        </div>}
      </li>)}
    </ul>
    {admin && <form className={styles.form} onSubmit={event => void invite(event)} aria-label={text.invite}>
      <div className={styles.inline}>
        <Field label={text.email} help={invitationSv.bulk.help}><textarea rows={2} autoComplete="off" autoCapitalize="none" spellCheck={false}
          value={email} onChange={event => setEmail(event.target.value)} required /></Field>
        <Select label={text.role} value={role} onChange={event => setRole(event.target.value as ClubRole)}
          help={clubArchiveText.roleHelp[role]}>
          {ROLES.filter(value => owner || value !== "OWNER").map(value => <option key={value} value={value}>{clubArchiveText.roles[value]}</option>)}
        </Select>
      </div>
      <Button type="submit" disabled={busy || !email.trim()}>{text.inviteButton}</Button>
    </form>}
    {/* ADR-0209: "Från klubben" med rollen som är vald ovan. */}
    {admin && <FromClubPicker context={{ kind: "CLUB", id: club.clubId }} role={role} roleLabel={clubArchiveText.roles[role]} disabled={busy}
      onInvited={onChanged} />}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </section>;
}
