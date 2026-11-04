"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { racePeopleResponseSchema, racePersonGrantResponseSchema, racePersonRevokeResponseSchema,
  type RacePeopleResponse, type RacePerson, type RacePersonGrantRequest, type RacePersonInvitation } from "@o-tid/contracts";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { raceAdministratorSv } from "../../i18n/race-administrator-sv";
import { readAccountCsrfCookie } from "../../lib/organizer-account-cookies";
import { Button, Field, Notice, Section } from "../ui";
import styles from "./people-section.module.css";
import { formErrorsSv } from "../../i18n/form-errors-sv";
import { FromClubPicker } from "../club-affiliation/from-club-picker";

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

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setEmailError(formErrorsSv.email); return; }
    setEmailError("");
    const requestId = crypto.randomUUID();
    setBusy(true); onPendingChange(true); setMessage(undefined);
    try {
      const result = await send("POST", { formatVersion: 1, requestId, email, role }, `race-person-grant:${requestId}`);
      if (result.status !== 200) { setMessage({ tone: "error", text: failure(result.status) }); return; }
      const receipt = racePersonGrantResponseSchema.parse(result.value);
      setEmail(""); setRole("FUNCTIONARY");
      setMessage({ tone: "ok", text: text.invited(receipt.invitation.email, text.roles[receipt.invitation.role]) });
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
          {person.email && <span className={styles.email}>{person.email}</span>}
          {person.pendingVerification && <span className={styles.muted} data-testid="person-pending-verification">{text.pendingVerification}</span>}
        </span>
        <span className={styles.role} data-role={person.role}>{text.roles[person.role]}</span>
        <span className={styles.action}>{removable(person) &&
          <Button variant="secondary" disabled={locked} aria-label={text.removeLabel(person.displayName)}
            onClick={() => void remove(person)}>{text.remove}</Button>}</span>
      </li>)}
      {data.invitations.map(invitation => <li key={invitation.invitationId} data-testid="person-invitation">
        <span className={styles.who}>
          <strong>{invitation.displayName ?? invitation.email}</strong>
          <span className={styles.muted}>{text.waitingForLogin}</span>
        </span>
        <span className={styles.role} data-role={invitation.role}>{text.roles[invitation.role]}</span>
        <span className={styles.action}>{invitationRemovable(invitation) &&
          <Button variant="secondary" disabled={locked} aria-label={text.removeLabel(invitation.displayName ?? invitation.email)}
            onClick={() => void remove({ grantId: invitation.invitationId, displayName: invitation.displayName ?? invitation.email })}>{text.remove}</Button>}</span>
      </li>)}
    </ul>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    {data && <form className={styles.add} noValidate onSubmit={event => void add(event)} aria-label={text.addTitle}>
      <Field label={text.addEmail} help={text.addEmailHelp} error={emailError}>
        <input type="email" value={email} autoComplete="off" maxLength={320} disabled={locked}
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
    {/* ADR-0209: "Från klubben" med rollen som är vald ovan. */}
    {data && <FromClubPicker context={{ kind: "RACE", id: raceId }} role={role} roleLabel={text.roles[role]} disabled={locked} onInvited={load} />}
  </Section>;
}
