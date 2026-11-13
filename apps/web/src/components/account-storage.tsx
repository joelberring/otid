"use client";

import { useEffect, useState } from "react";
import { accountStorageSchema, geoJobPruneResponseSchema, SUPERADMIN_NEAR_LIMIT_SHARE, type AccountStorage } from "@o-tid/contracts";
import { accountStorageSv } from "../i18n/account-storage-sv";
import { accountStorageEn } from "../i18n/account-storage-en";
import { useLocale, useTexts } from "./language-provider";
import { accountRequest } from "../lib/account-client";
import { Button, EmptyState, Notice, numeric, Section, Table } from "./ui";
import styles from "./account-pages.module.css";

/**
 * PLAN.md steg L2–L3 (ägaren 2026-11-13): kontots kartlagring per kartprojekt och slag, störst först. På det egna kontot
 * (`canPrune`) går projektets äldre körningar att ta bort härifrån; superadmin ser samma uppdelning för ett annat konto.
 */
export function AccountStorageSection({ url, id, canPrune, title }: { url: string; id: string; canPrune: boolean; title?: string }) {
  const text = useTexts(accountStorageSv, accountStorageEn);
  const locale = useLocale();
  const [storage, setStorage] = useState<AccountStorage>();
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  async function load() {
    try {
      const response = await accountRequest(url);
      const parsed = accountStorageSchema.safeParse(response.json);
      if (response.status !== 200 || !parsed.success) { setFailed(true); return; }
      setFailed(false);
      setStorage(parsed.data);
    } catch { setFailed(true); }
  }
  useEffect(() => { setStorage(undefined); void load(); }, [url]);

  async function prune(projectId: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await accountRequest(`/api/organizer/map-projects/${projectId}/geo-jobs/prune`, { method: "POST", csrf: true });
      const parsed = geoJobPruneResponseSchema.safeParse(response.json);
      if (response.status !== 200 || !parsed.success) { setMessage({ tone: "error", text: text.pruneFailed }); return; }
      setMessage({ tone: "ok", text: text.pruned(parsed.data.removedRuns, parsed.data.removedLayers) });
      setConfirming(undefined);
      await load();
    } catch { setMessage({ tone: "error", text: text.pruneFailed }); }
    finally { setBusy(false); }
  }

  const mb = (bytes: number) => Math.round(bytes / 1048576);
  const share = storage && storage.limitBytes !== null ? (storage.limitBytes === 0 ? 1 : storage.usedBytes / storage.limitBytes) : 0;
  return <Section id={id} title={title ?? text.title} help={text.help}>
    {!storage && !failed && <p role="status">{text.loading}</p>}
    {failed && <Notice tone="error" role="alert">{text.failed}</Notice>}
    {storage && <>
      <p>{text.summary(mb(storage.usedBytes), storage.limitBytes === null ? null : mb(storage.limitBytes))}</p>
      {share >= 1 ? <Notice tone="attention">{text.overLimit}</Notice> : share >= SUPERADMIN_NEAR_LIMIT_SHARE ? <Notice tone="attention">{text.nearLimit}</Notice> : null}
      {message && <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice>}
      {storage.projects.length === 0 && storage.otherBytes === 0 ? <EmptyState title={text.empty} /> : <Table aria-label={title ?? text.title}>
        <thead><tr><th>{text.columns.project}</th><th>{text.columns.geo}</th><th>{text.columns.layers}</th><th>{text.columns.outputs}</th>
          <th>{text.columns.base}</th><th>{text.columns.total}</th><th>{text.columns.opened}</th>{canPrune && <th>{text.columns.actions}</th>}</tr></thead>
        <tbody>
          {storage.projects.map(project => <tr key={project.projectId}>
            <th scope="row">{project.name}</th>
            <td className={numeric}>{text.mb(project.geoBytes)}</td><td className={numeric}>{text.mb(project.layerBytes)}</td>
            <td className={numeric}>{text.mb(project.outputBytes)}</td><td className={numeric}>{text.mb(project.baseBytes)}</td>
            <td className={numeric}>{text.mb(project.totalBytes)}</td>
            <td className={styles.nowrap}>{project.lastOpenedAt ? new Date(project.lastOpenedAt).toLocaleDateString(locale) : text.neverOpened}</td>
            {canPrune && <td>{project.prunableRuns > 0 && (confirming === project.projectId
              ? <div className={styles.prose}><p>{text.pruneConfirm}</p><div className={styles.rowActions}>
                  <Button className={styles.danger} disabled={busy} onClick={() => void prune(project.projectId)}>{busy ? text.working : text.pruneYes}</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirming(undefined)}>{text.cancel}</Button></div></div>
              : <Button variant="secondary" disabled={busy} aria-label={`${text.prune(project.prunableRuns)} – ${project.name}`}
                  onClick={() => { setConfirming(project.projectId); setMessage(undefined); }}>{text.prune(project.prunableRuns)}</Button>)}</td>}
          </tr>)}
          {storage.otherBytes > 0 && <tr><th scope="row">{text.other}</th><td /><td /><td /><td />
            <td className={numeric}>{text.mb(storage.otherBytes)}</td><td />{canPrune && <td />}</tr>}
        </tbody>
      </Table>}
    </>}
  </Section>;
}
