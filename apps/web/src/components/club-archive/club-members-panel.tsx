"use client";

import { useState, type FormEvent } from "react";
import type { ClubRole, ClubView } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubBase, clubFailure, clubRequest } from "../../lib/club-archive-client";
import { Button, Field, Notice, Select } from "../ui";
import styles from "./club-archive.module.css";

const text = clubArchiveSv.members;
const ROLES: readonly ClubRole[] = ["READER", "LEADER", "ADMIN", "OWNER"];

/**
 * ADR-0194 beslut 1: klubbens medlemmar och inbjudningar. Bjud in med e-postadressen (samma svar med och utan konto); listan
 * visar adressen som "väntar på inloggning" tills personen loggat in med den. Läsare ser bara namnen.
 */
export function ClubMembersPanel({ club, onChanged }: { club: ClubView; onChanged: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ClubRole>("READER");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const admin = club.viewer.role === "OWNER" || club.viewer.role === "ADMIN";
  const owner = club.viewer.role === "OWNER";

  async function run(action: () => Promise<{ status: number }>, ok: string, conflict?: string) {
    setBusy(true); setMessage(undefined);
    try {
      const result = await action();
      if (result.status >= 200 && result.status < 300) { setMessage({ tone: "ok", text: ok }); await onChanged(); return true; }
      setMessage({ tone: "error", text: result.status === 409 && conflict ? conflict : clubFailure(result.status) });
      return false;
    } finally { setBusy(false); }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    const done = await run(() => clubRequest(`${clubBase(club.clubId)}/members`, "POST", { formatVersion: 1, requestId, email: email.trim(), role }),
      text.invited, text.exists);
    setRequestId(crypto.randomUUID());
    if (done) setEmail("");
  }

  const remove = (who: string, body: { memberId: string | null; invitationId: string | null }) => {
    if (!window.confirm(text.removeConfirm(who))) return;
    void run(() => clubRequest(`${clubBase(club.clubId)}/members`, "DELETE", { formatVersion: 1, ...body }), clubArchiveSv.entry.saved, text.lastOwner);
  };

  return <section className={styles.cards} aria-labelledby="club-members">
    <div>
      <h2 id="club-members">{text.title}</h2>
      {admin && <p className={styles.muted}>{text.help}</p>}
    </div>
    <ul className={styles.list} data-testid="club-members">
      {club.members.map(member => <li key={member.memberId}>
        <div><strong>{member.displayName}{member.accountId === club.viewer.accountId ? ` (${text.you})` : ""}</strong>
          <span>{clubArchiveSv.roles[member.role]}{member.email ? ` · ${member.email}` : ""}</span></div>
        {admin && member.accountId !== club.viewer.accountId && (owner || member.role !== "OWNER") && <div className={styles.actions}>
          <select aria-label={`${text.changeRole}: ${member.displayName}`} value={member.role} disabled={busy}
            onChange={event => void run(() => clubRequest(`${clubBase(club.clubId)}/members`, "PUT", { formatVersion: 1, memberId: member.memberId,
              role: event.target.value }), clubArchiveSv.entry.saved, text.lastOwner)}>
            {ROLES.filter(value => owner || value !== "OWNER").map(value => <option key={value} value={value}>{clubArchiveSv.roles[value]}</option>)}
          </select>
          <Button variant="secondary" disabled={busy} onClick={() => remove(member.displayName, { memberId: member.memberId, invitationId: null })}>
            {text.remove}</Button>
        </div>}
      </li>)}
      {club.invitations.map(invitation => <li key={invitation.invitationId}>
        <div><strong>{invitation.email}</strong><span>{clubArchiveSv.roles[invitation.role]} · {text.pending}</span></div>
        {(owner || invitation.role !== "OWNER") && <Button variant="secondary" disabled={busy}
          onClick={() => remove(invitation.email, { memberId: null, invitationId: invitation.invitationId })}>{text.remove}</Button>}
      </li>)}
    </ul>
    {admin && <form className={styles.form} onSubmit={event => void invite(event)} aria-label={text.invite}>
      <div className={styles.inline}>
        <Field label={text.email}><input type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} required /></Field>
        <Select label={text.role} value={role} onChange={event => setRole(event.target.value as ClubRole)}
          help={clubArchiveSv.roleHelp[role]}>
          {ROLES.filter(value => owner || value !== "OWNER").map(value => <option key={value} value={value}>{clubArchiveSv.roles[value]}</option>)}
        </Select>
      </div>
      <Button type="submit" disabled={busy || !email.trim()}>{text.inviteButton}</Button>
    </form>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </section>;
}
