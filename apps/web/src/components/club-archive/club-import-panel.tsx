"use client";

import { useEffect, useState } from "react";
import type { ClubView } from "@o-tid/contracts";
import { clubArchiveSv } from "../../i18n/club-archive-sv";
import { clubBase, clubFailure, clubRequest } from "../../lib/club-archive-client";
import { Button, Notice } from "../ui";
import styles from "./club-archive.module.css";

const text = clubArchiveSv.importer;
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

/**
 * ADR-0194 beslut 6–8: importen från ägarens dator. Visar arkivets storlek och kvoten, kommandona med den här serverns adress
 * (klubben följer av nyckeln), och importnyckeln (visas en gång, 12 timmar, går att återkalla). Filerna går aldrig via webbläsaren.
 */
export function ClubImportPanel({ club, onChanged }: { club: ClubView; onChanged: () => Promise<void> }) {
  const [token, setToken] = useState<string>();
  const [origin, setOrigin] = useState("https://din-server");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [copied, setCopied] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const admin = club.viewer.role !== "READER";

  async function create() {
    setBusy(true); setMessage(undefined); setCopied(false);
    try {
      const result = await clubRequest(`${clubBase(club.clubId)}/import-tokens`, "POST");
      if (result.status !== 201) { setMessage({ tone: "error", text: clubFailure(result.status) }); return; }
      setToken((result.json as { token: string }).token);
      await onChanged();
    } finally { setBusy(false); }
  }

  async function revoke(tokenId: string) {
    setBusy(true); setMessage(undefined);
    try {
      const result = await clubRequest(`${clubBase(club.clubId)}/import-tokens/${tokenId}`, "DELETE");
      if (result.status !== 200) setMessage({ tone: "error", text: clubFailure(result.status) });
      await onChanged();
    } finally { setBusy(false); }
  }

  const usage = club.usage;
  const folder = "~/Downloads/Klubbträningar";
  return <section className={styles.cards} aria-labelledby="club-import">
    <div className={styles.card}>
      <h2 id="club-import">{text.usageTitle}</h2>
      <p>{clubArchiveSv.usage(usage.mapBytes + usage.courseFileBytes, usage.maps, usage.versions, usage.entries)}</p>
      <p className={styles.small}>{text.quota(club.quota.accountUsedBytes, club.quota.accountLimitBytes)}</p>
    </div>
    <div className={styles.card}>
      <h2>{text.title}</h2>
      <p>{text.help}</p>
      {!admin ? <p className={styles.muted}>{text.adminOnly}</p> : <>
        <p>{text.step1}</p>
        <p>{text.step2}</p>
        <code className={styles.code}>{`pnpm archive-import ${folder} --dry-run`}</code>
        <p>{text.step3}</p>
        {/* Klubben följer av importnyckeln: inget id och inga platshållare i kommandot (det klistras in som det står). */}
        <code className={styles.code} data-testid="import-command">{`pnpm archive-import ${folder} --server ${origin}`}</code>
        <p className={styles.small}>{text.tokenPrompt}</p>
        <p className={styles.small}>{text.leaders} <code>{text.leadersFlag}</code></p>
        <p>{text.step4}</p>
        <div className={styles.actions}><Button disabled={busy} onClick={() => void create()}>{text.createToken}</Button></div>
        {token && <div>
          <p><strong>{text.tokenShown}</strong></p>
          <code className={styles.token} data-testid="import-token">{token}</code>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(token).then(() => setCopied(true))}>{text.copy}</Button>
            {copied && <span role="status">{text.copied}</span>}
          </div>
        </div>}
        {club.tokens.length > 0 && <>
          <h3>{text.tokens}</h3>
          <ul className={styles.list}>
            {club.tokens.map(row => <li key={row.tokenId}>
              <div><strong>{row.createdByName}</strong>
                <span>{text.tokenState(when(row.createdAt), when(row.expiresAt), row.revokedAt !== null, row.lastUsedAt ? when(row.lastUsedAt) : null)}</span></div>
              {row.revokedAt === null && Date.parse(row.expiresAt) > Date.now() &&
                <Button variant="secondary" disabled={busy} onClick={() => void revoke(row.tokenId)}>{text.revoke}</Button>}
            </li>)}
          </ul>
        </>}
      </>}
      {message && <Notice tone={message.tone} role="alert">{message.text}</Notice>}
    </div>
  </section>;
}
