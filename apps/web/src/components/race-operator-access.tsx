"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  raceOperatorAccessIssueResponseSchema, raceOperatorAccessListResponseSchema,
  raceOperatorAccessRevokeResponseSchema, type RaceOperatorAccessMetadata
} from "@o-tid/contracts";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import { raceOperatorAccessSv as text } from "../i18n/race-operator-access-sv";
import styles from "./race-operator-access.module.css";

function localExpiry(): string {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function label(capability: RaceOperatorAccessMetadata["capability"]): string {
  return capability === "MANAGE_RACE" ? text.administrator : capability === "START_CHECKIN" ? text.start : text.finish;
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function RaceOperatorAccess({ raceId, onPendingChange }: {
  raceId: string;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [accesses, setAccesses] = useState<RaceOperatorAccessMetadata[]>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [secret, setSecret] = useState("");
  const [uncertainIssue, setUncertainIssue] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const actionable = busy || !!secret || uncertainIssue;
  const endpoint = `/api/admin/races/${raceId}/administrator/operator-access`;
  useEffect(() => { onPendingChange?.(actionable); }, [actionable, onPendingChange]);
  useEffect(() => {
    if (!onPendingChange) return;
    return () => onPendingChange(false);
  }, [onPendingChange]);
  function csrf(): string | undefined {
    return readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
  }
  async function load() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) { setMessage(text.loginRequired); return; }
      if (!response.ok) throw new Error("Load failed");
      setAccesses(raceOperatorAccessListResponseSchema.parse(await response.json()).accesses);
      setUncertainIssue(false);
    } catch { setMessage(text.error); } finally { setBusy(false); }
  }
  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const token = csrf();
    if (!token || busy) { setMessage(text.loginRequired); return; }
    if (uncertainIssue) return;
    const form = new FormData(formElement), expires = formText(form, "expiresAt");
    const date = new Date(expires);
    if (!Number.isFinite(date.getTime())) { setMessage(text.error); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", credentials: "same-origin", headers: {
        "content-type": "application/json", "x-otid-csrf": token
      }, body: JSON.stringify({ formatVersion: 1, capability: formText(form, "capability"), label: formText(form, "label").trim(), expiresAt: date.toISOString() }) });
      if (!response.ok) throw new Error("Issue failed");
      const issued = raceOperatorAccessIssueResponseSchema.parse(await response.json());
      setSecret(issued.accessCredential); setAccesses((current) => [...(current ?? []), issued.access]);
      setUncertainIssue(false); formElement.reset(); setMessage(text.issued);
    } catch { setUncertainIssue(true); setMessage(text.unknown); } finally { setBusy(false); }
  }
  async function revoke(access: RaceOperatorAccessMetadata) {
    const token = csrf();
    if (!token || busy) { setMessage(text.loginRequired); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "DELETE", cache: "no-store", credentials: "same-origin", headers: {
        "content-type": "application/json", "x-otid-csrf": token
      }, body: JSON.stringify({ formatVersion: 1, credentialId: access.credentialId }) });
      if (!response.ok) throw new Error("Revoke failed");
      const revoked = raceOperatorAccessRevokeResponseSchema.parse(await response.json()).access;
      setAccesses((current) => current?.map((row) => row.credentialId === revoked.credentialId ? revoked : row));
    } catch { setMessage(text.error); } finally { setBusy(false); }
  }
  return <details className={styles.access} open={isOpen || actionable}
    onToggle={(event) => {
      if (actionable && !event.currentTarget.open) event.currentTarget.open = true;
      else setIsOpen(event.currentTarget.open);
    }}>
    <summary>{text.title}</summary><p>{text.help}</p>
    <div className={styles.handoff}>
      <p>{text.handoffHelp}</p>
      <div className={styles.handoffLinks}>
        <a href={`/checkin/index.html#${raceId}`} target="_blank" rel="noreferrer">{text.openCheckin}</a>
        <a href={`/admin/${raceId}/manage`} target="_blank" rel="noreferrer">{text.openAdministration}</a>
      </div>
    </div>
    {secret && <section className="stack" role="alert"><h2>{text.secretTitle}</h2><p>{text.secretHelp}</p><output className="pairing-grant-id">{secret}</output><button type="button" onClick={() => setSecret("")}>{text.closeSecret}</button></section>}
    <form className="stack" onSubmit={(event) => void issue(event)}><label>{text.capability}<select name="capability" defaultValue="START_CHECKIN" disabled={busy || uncertainIssue}>
      <option value="START_CHECKIN">{text.start}</option><option value="FINISH_FOREST_WATCH">{text.finish}</option><option value="MANAGE_RACE">{text.administrator}</option>
    </select></label><label>{text.label}<input name="label" maxLength={120} required disabled={busy || uncertainIssue} /></label><label>{text.expiresAt}<input name="expiresAt" type="datetime-local" defaultValue={localExpiry()} required disabled={busy || uncertainIssue} /></label>
      <button disabled={busy || uncertainIssue}>{busy ? text.issuing : text.issue}</button></form>
    <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>{busy ? text.loading : text.load}</button>
    {accesses && (accesses.length === 0 ? <p>{text.noAccess}</p> : <div className="pairing-grant-list">{accesses.map((access) => <article className="pairing-grant" key={access.credentialId}><div><strong>{label(access.capability)} · {access.label}</strong><span>{new Date(access.expiresAt).toLocaleString("sv-SE")} · {access.revokedAt ? text.revoked : text.active}</span></div>{!access.revokedAt && <button type="button" className="secondary danger" disabled={busy || uncertainIssue} onClick={() => void revoke(access)}>{busy ? text.revoking : text.revoke}</button>}</article>)}</div>)}
    <p>{text.revokeHelp}</p>{message && <p role="status">{message}</p>}
  </details>;
}
