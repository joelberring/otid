"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { racePeopleResponseSchema, racePersonGrantResponseSchema, racePersonRevokeResponseSchema,
  type RacePeopleResponse, type RacePerson } from "@o-tid/contracts";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { raceAdministratorSv } from "../../i18n/race-administrator-sv";
import { readRaceAdministratorCsrfCookie } from "../../lib/race-administrator-cookies";
import { Button, Field, Notice, Section } from "../ui";
import styles from "./people-section.module.css";

const text = raceTypeSv.settings.people;
type Message = { tone: "ok" | "error"; text: string };

/**
 * Inställningar → Personer med behörighet (ADR-0172 beslut 3): ägaren, administratörer och funktionärer i en lista.
 * En administratör lägger till ett befintligt konto med e-post som funktionär; ägaren kan också lägga till och ta bort
 * administratörer. Servern kontrollerar allt; vyn visar bara det som den inloggade får göra.
 */
export function PeopleSection({ raceId, disabled, onPendingChange }: { raceId: string; disabled: boolean;
  onPendingChange: (pending: boolean) => void }) {
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator/people`;
  const [data, setData] = useState<RacePeopleResponse>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"FUNCTIONARY" | "ADMIN">("FUNCTIONARY");
  const [busy, setBusy] = useState(false);
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
    const csrf = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
    if (!csrf) return { status: 401, value: undefined as unknown };
    const response = await fetch(base, { method, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-otid-csrf": csrf, "idempotency-key": key } });
    return { status: response.status, value: response.ok ? await response.json() as unknown : undefined };
  }

  function failure(status: number): string {
    return status === 404 ? text.noAccount : status === 409 ? text.already : status === 403 ? text.ownerOnly
      : status === 401 ? text.sessionExpired : text.failed;
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const requestId = crypto.randomUUID();
    setBusy(true); onPendingChange(true); setMessage(undefined);
    try {
      const result = await send("POST", { formatVersion: 1, requestId, email, role }, `race-person-grant:${requestId}`);
      if (result.status !== 200) { setMessage({ tone: "error", text: failure(result.status) }); return; }
      const receipt = racePersonGrantResponseSchema.parse(result.value);
      setEmail(""); setRole("FUNCTIONARY");
      setMessage({ tone: "ok", text: text.added(receipt.person.displayName, text.roles[receipt.person.role]) });
      await load();
    } catch { setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); onPendingChange(false); }
  }

  async function remove(person: RacePerson) {
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
  const removable = (person: RacePerson) => person.accountId !== data?.viewer.accountId &&
    (person.role === "FUNCTIONARY" || (person.role === "ADMIN" && owner));
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
        </span>
        <span className={styles.role} data-role={person.role}>{text.roles[person.role]}</span>
        <span className={styles.action}>{removable(person) &&
          <Button variant="secondary" disabled={locked} aria-label={text.removeLabel(person.displayName)}
            onClick={() => void remove(person)}>{text.remove}</Button>}</span>
      </li>)}
    </ul>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    {data && <form className={styles.add} onSubmit={event => void add(event)} aria-label={text.addTitle}>
      <Field label={text.addEmail} help={text.addEmailHelp}>
        <input type="email" value={email} autoComplete="off" required maxLength={320} disabled={locked}
          onChange={event => setEmail(event.target.value)} />
      </Field>
      <Field label={text.addRole}>
        <select value={role} disabled={locked || !owner} onChange={event => setRole(event.target.value === "ADMIN" ? "ADMIN" : "FUNCTIONARY")}>
          <option value="FUNCTIONARY">{text.roles.FUNCTIONARY}</option>
          {owner && <option value="ADMIN">{text.roles.ADMIN}</option>}
        </select>
      </Field>
      <Button type="submit" disabled={locked || !email.trim()}>{text.add}</Button>
    </form>}
  </Section>;
}
