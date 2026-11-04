"use client";

import { useState } from "react";
import { invitationResendResponseSchema } from "@o-tid/contracts";
import { invitationSv } from "../i18n/invitation-sv";
import { accountRequest } from "../lib/account-client";
import { Button } from "./ui";
import styles from "./invitation-actions.module.css";

const text = invitationSv.list;
const time = (iso: string) => new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  timeZone: "Europe/Stockholm" }).format(new Date(iso));

/** När inbjudan senast mejlades ("skickad 3 nov. 14:02") eller "inte skickad"; inget utan e-post på servern. */
export function invitationSentText(sentAt: string | null | undefined, mailEnabled: boolean): string | undefined {
  if (!mailEnabled) return undefined;
  return sentAt ? text.sent(time(sentAt)) : text.notSent;
}

/**
 * ADR-0206: knappen vid en öppen inbjudan. Med e-post på servern "Skicka igen" (ny länk, de tidigare slutar gälla); utan den
 * "Kopiera länken" så att administratören kan skicka den själv. Länken visas också i ett fält om urklippet inte går att nå.
 * `name` är adressen eller, för en inbjudan "Från klubben" (ADR-0209), namnet; en sådan kan bara mejlas (länksidan visar adressen).
 */
export function InvitationActions({ name, fromClub, endpoint, mailEnabled, disabled, onSent }: { name: string; fromClub?: boolean;
  endpoint: string; mailEnabled: boolean; disabled?: boolean; onSent?: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [link, setLink] = useState<string>();

  async function run() {
    setBusy(true); setMessage(undefined); setLink(undefined);
    try {
      const response = await accountRequest(endpoint, { method: "POST", csrf: true, body: { formatVersion: 1, delivery: mailEnabled ? "MAIL" : "LINK" } });
      if (response.status === 503) { setMessage({ tone: "error", text: text.mailOff }); return; }
      const parsed = invitationResendResponseSchema.safeParse(response.json);
      if (response.status !== 200 || !parsed.success) { setMessage({ tone: "error", text: text.failed }); return; }
      const result = parsed.data;
      if (result.status === "sent") { setMessage({ tone: "ok", text: text.resent(name) }); await onSent?.(); return; }
      if (result.status !== "link") { setMessage({ tone: "error", text: result.status === "throttled" ? text.throttled : text.failed }); return; }
      const url = `${window.location.origin}/inbjudan#token=${result.token}`;
      setLink(url);
      try { await navigator.clipboard.writeText(url); setMessage({ tone: "ok", text: text.copied }); }
      catch { setMessage({ tone: "ok", text: text.copyManually }); }
    } catch { setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); }
  }

  if (!mailEnabled && fromClub) return null;
  return <span className={styles.actions}>
    <Button variant="secondary" disabled={busy || disabled} aria-label={mailEnabled ? text.resendLabel(name) : text.copyLabel(name)}
      onClick={() => void run()}>{mailEnabled ? text.resend : text.copy}</Button>
    {message && <span className={message.tone === "error" ? styles.error : styles.ok} role={message.tone === "error" ? "alert" : "status"}>
      {message.text}</span>}
    {link && <input className={styles.link} readOnly value={link} aria-label={text.linkField} onFocus={event => event.currentTarget.select()} />}
  </span>;
}
