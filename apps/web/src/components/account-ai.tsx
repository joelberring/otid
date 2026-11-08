"use client";

import { useEffect, useState } from "react";
import { aiSv } from "../i18n/ai-sv";
import { accountRequest } from "../lib/account-client";
import { clubRequest } from "../lib/club-archive-client";
import { Button, Notice, Section } from "./ui";
import styles from "./account-pages.module.css";

const text = aiSv.connections;
interface Connection { grantId: string; clientName: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
const date = (value: string) => new Date(value).toLocaleDateString("sv-SE");

/** ADR-0219 (K2): kontots AI-kopplingar och adressen att lägga till i Claude. */
export function AccountAi() {
  const [connections, setConnections] = useState<Connection[]>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [busy, setBusy] = useState(false);
  const address = typeof window === "undefined" ? "" : `${window.location.origin}/api/mcp`;

  async function load() {
    const result = await accountRequest("/api/account/ai-connections").catch(() => ({ status: 0, json: undefined }));
    if (result.status === 200) setConnections((result.json as { connections: Connection[] }).connections);
    else setMessage({ tone: "error", text: text.failed });
  }
  useEffect(() => { void load(); }, []);

  async function revoke(grantId: string) {
    setBusy(true);
    try {
      const result = await clubRequest(`/api/account/ai-connections/${encodeURIComponent(grantId)}`, "DELETE");
      setMessage(result.status === 200 ? { tone: "ok", text: text.revokedDone } : { tone: "error", text: text.failed });
      await load();
    } finally { setBusy(false); }
  }

  return <Section id="konto-ai" title={text.title} help={text.help}>
    <p className={styles.muted}>{text.address}: <code data-testid="mcp-address">{address}</code></p>
    {connections && connections.length === 0 && <p className={styles.muted}>{text.none}</p>}
    {connections && connections.length > 0 && <ul className={styles.list} data-testid="ai-connections">
      {connections.map(connection => <li key={connection.grantId}>
        <strong>{connection.clientName}</strong> · {text.created(date(connection.createdAt))} · {connection.lastUsedAt
          ? text.used(date(connection.lastUsedAt)) : text.neverUsed}
        {connection.revokedAt ? ` · ${text.revoked}` : <> <Button variant="secondary" disabled={busy} onClick={() => void revoke(connection.grantId)}>
          {text.revoke}</Button></>}
      </li>)}
    </ul>}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </Section>;
}
