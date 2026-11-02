"use client";

import { useCallback, useEffect, useState } from "react";
import { raceBackupStatusSchema } from "@o-tid/contracts";
import { raceBackupSv as text } from "../../i18n/race-backup-sv";
import { saveVerifiedDownload } from "../../lib/verified-download";
import { Button, Notice, Section } from "../ui";
import type { Workspace } from "./workspace-state";

/** Filnamnet ur svarets `content-disposition` (servern bildar det av tävlingens namn, datum och tid). */
function fileName(response: Response): string {
  const match = /filename="([a-z0-9.-]{1,160})"/.exec(response.headers.get("content-disposition") ?? "");
  return match?.[1] ?? "otid-sakerhetskopia.zip";
}

/**
 * Inställningar → "Säkerhetskopia" (ADR-0187): "Ladda ner säkerhetskopia" ger en zip med allt om tävlingen som kan återställas
 * som en ny tävling på samma eller en annan server. Säger när den bör tas (efter lottning, före start och efter sista målgång),
 * att filen innehåller personuppgifter och när den senast laddades ner. Bara administratören.
 */
export function RaceExportSection({ ws }: { ws: Workspace }) {
  const { assertCurrent, beginRequest, current, finish, pending, raceId, request, requireSession, saving, workflowLocked, writingRef } = ws;
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const [lastDownloadedAt, setLastDownloadedAt] = useState<string | null>();
  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/backup-status`,
        { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      const parsed = raceBackupStatusSchema.safeParse(await response.json());
      if (parsed.success) setLastDownloadedAt(parsed.data.lastDownloadedAt);
    } catch { /* Tiden är bara information; knappen fungerar ändå. */ }
  }, [raceId]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function download() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setMessage(undefined);
    try {
      const response = await request("/export", op);
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/zip")) throw new Error("Backup unavailable");
      await saveVerifiedDownload(response, fileName(response), undefined, () => assertCurrent(op), "application/zip");
      setMessage({ tone: "ok", text: text.downloaded });
      void loadStatus();
    } catch { if (current(op)) setMessage({ tone: "error", text: text.error }); }
    finally { finish(op); }
  }
  return <Section id={`settings-${raceId}-export`} title={text.title} help={text.help}>
    <ul>{text.when.map(line => <li key={line}>{line}</li>)}</ul>
    <Notice tone="info"><strong>{text.personalDataTitle}</strong> {text.personalData}</Notice>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
    <div><Button disabled={saving || workflowLocked} onClick={() => void download()}>{text.action}</Button></div>
    {lastDownloadedAt !== undefined && <p data-testid="backup-last">{lastDownloadedAt ? text.last(new Date(lastDownloadedAt)) : text.never}</p>}
    <p>{text.restoreHint}</p>
  </Section>;
}
