"use client";

import { useEffect, useRef, useState } from "react";
import { IOF_IMPORT_CONTENT_TYPE, IOF_IMPORT_MAX_BYTES, sourceSyncStatusSchema, syncPreviewResponseSchema, type SourceSyncStatus } from "@o-tid/contracts";
import { sourcesSv } from "../../i18n/sources-sv";
import { Button, Field, Notice, Section } from "../ui";
import styles from "./sources.module.css";
import { sourceTime } from "./eventor-section";
import { SourceReviewPanel } from "./source-review";
import { useSourceReview, type Message } from "./source-sync-actions";
import type { Workspace } from "./workspace-state";

const text = sourcesSv.courseFile;

/**
 * Banor → Banfil (ADR-0170 beslut 4): "Läs in banfil" från OCAD, Purple Pen eller Condes. En ny
 * banfil visar skillnaderna (nya banor, ändrade kontroller, klasser som byter bana) och samma
 * besked som "Redigera bana" innan något sparas. Alla tävlingstyper kan läsa banfil.
 */
export function CourseFileSection({ ws }: { ws: Workspace }) {
  const { authenticated, busy, busyRef, beginRequest, request, json, finish, current, csrf, requireSession, data, raceId } = ws;
  const [status, setStatus] = useState<SourceSyncStatus>();
  const [message, setMessage] = useState<Message>();
  const [loadFailed, setLoadFailed] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const review = useSourceReview(ws);
  const timeZone = data?.timeZone ?? "Europe/Stockholm";

  useEffect(() => {
    if (!authenticated || status || loadFailed || busy || busyRef.current) return;
    const op = beginRequest();
    void (async () => {
      try {
        const response = await request("/source-sync", op);
        if (!response.ok) throw new Error("Status unavailable");
        setStatus(sourceSyncStatusSchema.parse(await json(response, op)));
      } catch { if (current(op)) setLoadFailed(true); } finally { finish(op); }
    })();
  }, [authenticated, status, loadFailed, busy]);
  useEffect(() => { if (review.message?.tone === "ok") { setStatus(undefined); if (file.current) file.current.value = ""; } }, [review.message]);

  async function read() {
    const chosen = file.current?.files?.[0];
    if (!chosen) { setMessage({ tone: "error", text: text.chooseFile }); return; }
    if (chosen.size > IOF_IMPORT_MAX_BYTES) { setMessage({ tone: "error", text: text.tooLarge }); return; }
    if (busyRef.current || !requireSession()) return;
    setMessage(undefined); review.setMessage(undefined);
    const op = beginRequest();
    try {
      const response = await request("/course-file/preview", op, { method: "POST", headers: { "content-type": IOF_IMPORT_CONTENT_TYPE,
        "x-otid-csrf": csrf(), "x-otid-file-name": encodeURIComponent(chosen.name.slice(0, 200)) }, body: await chosen.arrayBuffer() });
      if (response.status === 422 || response.status === 400) { setMessage({ tone: "error", text: text.invalid }); return; }
      if (!response.ok) throw new Error("Preview failed");
      review.show(syncPreviewResponseSchema.parse(await json(response, op)));
    } catch { if (current(op)) setMessage({ tone: "error", text: text.failed }); }
    finally { finish(op); }
  }

  const last = status?.courseFile;
  const inputId = `course-file-${raceId}`;
  return <Section id={`course-file-section-${raceId}`} title={text.title} help={text.help}>
    <div className={styles.block}>
      {!review.preview && <form className={styles.inlineForm} onSubmit={event => { event.preventDefault(); void read(); }}>
        <Field label={text.fileLabel} help={last ? text.lastRead(last.fileName ?? "", sourceTime(last.appliedAt, timeZone)) : text.fileHelp}>
          <input id={inputId} ref={file} className={styles.fileInput} type="file" accept=".xml,application/xml,text/xml" disabled={busy} /></Field>
        <div className={styles.actions}><Button type="submit" variant={last ? "secondary" : "primary"} disabled={busy}>
          {last ? text.readAgain : text.read}</Button></div>
      </form>}
      {message && <Notice tone={message.tone} role="alert">{message.text}</Notice>}
      {review.message && <Notice tone={review.message.tone} role={review.message.tone === "ok" ? "status" : "alert"}>{review.message.text}</Notice>}
      <SourceReviewPanel review={review} busy={busy} sourceName={review.preview?.sourceName ?? text.title} />
    </div>
  </Section>;
}
