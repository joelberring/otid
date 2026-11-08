"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { MapSourceCredentialView } from "@o-tid/contracts";
import { mapSourcesSv } from "../i18n/map-sources-sv";
import { accountRequest } from "../lib/account-client";
import { clubRequest } from "../lib/club-archive-client";
import { Button, Field, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

const text = mapSourcesSv.account;
const PATH = "/api/account/map-sources/lantmateriet";

/** ADR-0219 (K4c): kontots egna uppgifter till Lantmäteriet. Uppgifterna skickas en gång och visas aldrig igen. */
export function AccountMapSources() {
  const [state, setState] = useState<MapSourceCredentialView>();
  const [method, setMethod] = useState<"BASIC" | "OAUTH2">("BASIC");
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  useEffect(() => {
    void accountRequest(PATH).then(result => { if (result.status === 200) setState(result.json as MapSourceCredentialView); }, () => undefined);
  }, []);

  async function run(change: () => Promise<{ status: number; json: unknown }>, done: string) {
    setBusy(true); setMessage(undefined);
    try {
      const result = await change().catch(() => ({ status: 0, json: undefined }));
      const error = (result.json as { error?: string } | undefined)?.error;
      if (result.status === 200) { setState(result.json as MapSourceCredentialView); setMessage({ tone: "ok", text: done }); setId(""); setSecret(""); }
      else setMessage({ tone: "error", text: error === "SOURCE_NOT_CONFIGURED" ? text.notConfigured : text.failed });
    } finally { setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void run(() => clubRequest(PATH, "PUT", { formatVersion: 1, method, id: id.trim(), secret }), text.savedDone);
  }

  const saved = state?.saved;
  return <Section id="konto-lantmateriet" title={text.title} help={text.help}>
    <p className={styles.muted} data-testid="map-source-state">{saved
      ? <>{text.saved(saved.method, saved.hint, new Date(saved.updatedAt).toLocaleDateString("sv-SE"))}{!saved.readable && ` ${text.unreadable}`}</>
      : text.none}</p>
    {state && !state.available && <Notice tone="error" role="alert">{text.notConfigured}</Notice>}
    <form className={styles.form} onSubmit={save} noValidate>
      <Field label={text.method}>
        <select value={method} disabled={busy} onChange={event => setMethod(event.target.value === "OAUTH2" ? "OAUTH2" : "BASIC")}>
          <option value="BASIC">{text.basic}</option>
          <option value="OAUTH2">{text.oauth}</option>
        </select>
      </Field>
      <Field label={text.id(method)}>
        <input autoComplete="off" maxLength={200} value={id} disabled={busy} onChange={event => setId(event.target.value)} />
      </Field>
      <Field label={text.secret(method)}>
        <input type="password" autoComplete="new-password" maxLength={500} value={secret} disabled={busy} onChange={event => setSecret(event.target.value)} />
      </Field>
      <span>
        <Button type="submit" variant="secondary" disabled={busy || !id.trim() || !secret || state?.available === false}>{text.save}</Button>
        {saved && <> <Button variant="quiet" disabled={busy} onClick={() => void run(() => clubRequest(PATH, "DELETE"), text.removedDone)}>{text.remove}</Button></>}
      </span>
    </form>
    <p className={styles.muted}>{text.trial}</p>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </Section>;
}
