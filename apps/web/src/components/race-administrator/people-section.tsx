"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { INVITATION_BULK_MAX, racePeopleResponseSchema, racePersonGrantResponseSchema, racePersonRevokeResponseSchema,
  type RacePeopleResponse, type RacePerson, type RacePersonGrantRequest, type RacePersonInvitation } from "@o-tid/contracts";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { raceAdministratorSv } from "../../i18n/race-administrator-sv";
import { readAccountCsrfCookie } from "../../lib/organizer-account-cookies";
import { Button, Field, Notice, Section } from "../ui";
import styles from "./people-section.module.css";
import { formErrorsSv } from "../../i18n/form-errors-sv";
import { invitationMailNote, invitationSummary, invitationSv } from "../../i18n/invitation-sv";
import { inviteAll, parseInvitationAddresses } from "../../lib/invitation-bulk";
import { InvitationActions, invitationSentText } from "../invitation-actions";

const text = raceTypeSv.settings.people;
const GRANTABLE = ["ADMIN", "FUNCTIONARY", "COURSE_EDIT", "COURSE_SUGGEST", "COURSE_COMMENT", "COURSE_MAP"] as const;
type Message = { tone: "ok" | "error"; text: string };

/**
 * Inställningar → Personer med behörighet (ADR-0172 beslut 3): ägaren, administratörer och funktionärer i en lista.
 * En administratör lägger till en e-postadress som funktionär; ägaren kan också lägga till och ta bort administratörer.
 * ADR-0188 beslut 6: svaret är detsamma oavsett om adressen har ett konto; behörigheten väntar i listan tills personen
 * loggar in med adressen. Servern kontrollerar allt; vyn visar bara det som den inloggade får göra.
 */
export function PeopleSection({ raceId, disabled, onPendingChange }: { raceId: string; disabled: boolean;
  onPendingChange: (pending: boolean) => void }) {
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator/people`;
  const [data, setData] = useState<RacePeopleResponse>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RacePersonGrantRequest["role"]>("FUNCTIONARY");
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [message, setMessage] = useState<Message>();

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch(base, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`Listan svarade ${response.status}`);
      const value = racePeopleResponseSchema.parse(await response.json());
      if (value.raceId !== raceId) throw new Error("Listan gäller en annan tävling");
      setData(value);
    } catch { setLoadFailed(true); }
  }, [base, raceId]);
  useEffect(() => { void load(); }, [load]);

  async function send(method: "POST" | "DELETE", body: Record<string, unknown>, key: string) {
    const csrf = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
    if (!csrf) return { status: 401, value: undefined as unknown };
    const response = await fetch(base, { method, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-otid-csrf": csrf, "idempotency-key": key } });
    return { status: response.status, value: response.ok ? await response.json() as unknown : undefined };
  }

  function failure(status: number): string {
    return status === 409 ? text.already : status === 403 ? text.ownerOnly
      : status === 401 ? text.sessionExpired : text.failed;
  }

  /** ADR-0206: en eller flera adresser med samma roll, var sin inbjudan och var sitt mejl. */
  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const { addresses, invalid } = parseInvitationAddresses(email);
    if (addresses.length === 0) { setEmailError(invalid.length ? formErrorsSv.email : invitationSv.bulk.none); return; }
    if (addresses.length > INVITATION_BULK_MAX) { setEmailError(invitationSv.bulk.tooMany(INVITATION_BULK_MAX)); return; }
    setEmailError("");
    const grant = async (address: string) => {
      const requestId = crypto.randomUUID();
      const result = await send("POST", { formatVersion: 1, requestId, email: address, role }, `race-person-grant:${requestId}`);
      return { status: result.status, receipt: result.status === 200 ? racePersonGrantResponseSchema.parse(result.value) : undefined };
    };
    setBusy(true); onPendingChange(true); setMessage(undefined);
    try {
      if (addresses.length === 1 && invalid.length === 0) {
        const { status, receipt } = await grant(addresses[0]!);
        if (!receipt) { setMessage({ tone: "error", text: failure(status) }); return; }
        setEmail(""); setRole("FUNCTIONARY");
        setMessage({ tone: "ok", text: `${text.invited(receipt.invitation.email, text.roles[receipt.invitation.role])} ${invitationMailNote[receipt.mail ?? "off"]}` });
        await load();
        return;
      }
      const { tally, fatal } = await inviteAll(addresses, invalid.length, async address => {
        const { status, receipt } = await grant(address);
        if (receipt) return receipt.mail ?? "off";
        if (status === 401 || status === 403) return { fatal: status };
        return status === 409 ? "existing" : "error";
      });
      setMessage(fatal ? { tone: "error", text: failure(fatal) } : { tone: tally.other || tally.invalid ? "error" : "ok", text: invitationSummary(tally) });
      if (!fatal) setEmail("");
      await load();
    } catch { setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); onPendingChange(false); }
  }

  async function remove(person: Pick<RacePerson, "grantId" | "displayName">) {
    if (busy || !window.confirm(text.confirmRemove(person.displayName))) return;
    const requestId = crypto.randomUUID();
    setBusy(true); onPendingChange(true); setMessage(undefined);
    try {
      const result = await send("DELETE", { formatVersion: 1, requestId, grantId: person.grantId }, `race-person-revoke:${requestId}`);
      if (result.status !== 200) { setMessage({ tone: "error", text: failure(result.status) }); return; }
      racePersonRevokeResponseSchema.parse(result.value);
      setMessage({ tone: "ok", text: text.removed(person.displayName) });
      await load();
    } catch { setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); onPendingChange(false); }
  }

  const owner = data?.viewer.role === "OWNER";
  const mailEnabled = data?.mailEnabled ?? false;
  // Steg 66: banläggningens behörigheter tas bort av alla administratörer, som funktionärer.
  const removable = (person: RacePerson) => person.accountId !== data?.viewer.accountId &&
    (person.role === "FUNCTIONARY" || person.role.startsWith("COURSE_") || (person.role === "ADMIN" && owner));
  const invitationRemovable = (invitation: RacePersonInvitation) => invitation.role !== "ADMIN" || owner;
  const locked = busy || disabled;
  return <Section id={`settings-${raceId}-people`} title={text.title} help={text.help}>
    {!data && !loadFailed && <p className={styles.muted} role="status">{text.loading}</p>}
    {loadFailed && <Notice tone="error" role="alert">{text.loadError}{" "}
      <Button variant="quiet" onClick={() => void load()}>{raceAdministratorSv.retry}</Button></Notice>}
    {data && <ul className={styles.people} aria-label={text.title}>
      {data.people.map(person => <li key={person.grantId}>
        <span className={styles.who}>
          <strong>{person.displayName}{person.accountId === data.viewer.accountId && <span className={styles.muted}> ({text.you})</span>}</strong>
          <span className={styles.email}>{person.email}</span>
          {person.pendingVerification && <span className={styles.muted} data-testid="person-pending-verification">{text.pendingVerification}</span>}
        </span>
        <span className={styles.role} data-role={person.role}>{text.roles[person.role]}</span>
        <span className={styles.action}>{removable(person) &&
          <Button variant="secondary" disabled={locked} aria-label={text.removeLabel(person.displayName)}
            onClick={() => void remove(person)}>{text.remove}</Button>}</span>
      </li>)}
      {data.invitations.map(invitation => <li key={invitation.invitationId} data-testid="person-invitation">
        <span className={styles.who}>
          <strong>{invitation.email}</strong>
          <span className={styles.muted}>{[text.waitingForLogin, invitationSentText(invitation.sentAt, mailEnabled)].filter(Boolean).join(" · ")}</span>
        </span>
        <span className={styles.role} data-role={invitation.role}>{text.roles[invitation.role]}</span>
        <span className={styles.action}>{invitationRemovable(invitation) && <>
          <InvitationActions email={invitation.email} mailEnabled={mailEnabled} disabled={locked} onSent={load}
            endpoint={`${base}/invitations/${encodeURIComponent(invitation.invitationId)}`} />
          <Button variant="secondary" disabled={locked} aria-label={text.removeLabel(invitation.email)}
            onClick={() => void remove({ grantId: invitation.invitationId, displayName: invitation.email })}>{text.remove}</Button></>}</span>
      </li>)}
    </ul>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    {data && <form className={styles.add} noValidate onSubmit={event => void add(event)} aria-label={text.addTitle}>
      <Field label={text.addEmail} help={`${text.addEmailHelp} ${invitationSv.bulk.help}`} error={emailError}>
        <textarea rows={2} value={email} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={locked}
          onChange={event => { setEmail(event.target.value); setEmailError(""); }} />
      </Field>
      <Field label={text.addRole}>
        <select value={role} disabled={locked} onChange={event => setRole(GRANTABLE.find(value => value === event.target.value) ?? "FUNCTIONARY")}>
          <option value="FUNCTIONARY">{text.roles.FUNCTIONARY}</option>
          {owner && <option value="ADMIN">{text.roles.ADMIN}</option>}
          <option value="COURSE_EDIT">{text.roles.COURSE_EDIT}</option>
          <option value="COURSE_SUGGEST">{text.roles.COURSE_SUGGEST}</option>
          <option value="COURSE_COMMENT">{text.roles.COURSE_COMMENT}</option>
          <option value="COURSE_MAP">{text.roles.COURSE_MAP}</option>
        </select>
      </Field>
      <Button type="submit" disabled={locked || !email.trim()}>{text.add}</Button>
    </form>}
  </Section>;
}
