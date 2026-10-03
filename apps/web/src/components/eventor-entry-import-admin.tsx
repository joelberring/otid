"use client";

import React, { useState, type FormEvent } from "react";
import {
  eventorEntryImportCommitRequestSchema,
  eventorEntryImportIdempotencyKeySchema,
  eventorEntryImportPreviewResponseSchema,
  eventorEntryImportResponseSchema,
  type EventorEntryImportPreviewResponse,
  type EventorEntryImportResponse,
} from "@o-tid/contracts";
import { readImportAdminCsrfCookie } from "../lib/import-admin-cookies";
import { eventorEntryImportSv as text } from "../i18n/eventor-entry-import-sv";
import { eventorProfileLabel } from "../i18n/eventor-sv";

type Attempt = { key: string; request: ReturnType<typeof eventorEntryImportCommitRequestSchema.parse> };

export function createEventorEntryImportAttempt(
  preview: EventorEntryImportPreviewResponse,
  mapping: Record<string, string>,
  requestId: string
): Attempt | undefined {
  const mappings = preview.sourceClasses.map(({ externalClassId }) => ({ externalClassId, classId: mapping[externalClassId] ?? "" }));
  const parsed = eventorEntryImportCommitRequestSchema.safeParse({ formatVersion: 1, grantId: preview.grantId,
    eventClassesSourceHash: preview.eventClassesSourceHash, entriesSourceHash: preview.entriesSourceHash, mappings });
  const key = `eventor-entry-import:${requestId}`;
  if (!parsed.success || !eventorEntryImportIdempotencyKeySchema.safeParse(key).success) return undefined;
  return { key, request: parsed.data };
}

function csrf(): string {
  return readImportAdminCsrfCookie(document.cookie, new URL(window.location.href)) ?? "";
}

async function readResponse(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

export function EventorEntryImportAdmin({ raceId }: { raceId: string }) {
  const [grantId, setGrantId] = useState("");
  const [preview, setPreview] = useState<EventorEntryImportPreviewResponse>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState<Attempt>();
  const [result, setResult] = useState<EventorEntryImportResponse>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function getPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setPreview(undefined); setResult(undefined); setMapping({});
    try {
      const response = await fetch(`/api/admin/races/${raceId}/eventor-entry-import/preview`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
        body: JSON.stringify({ formatVersion: 1, grantId }),
      });
      if (!response.ok) throw new Error(text.failed);
      const parsed = eventorEntryImportPreviewResponseSchema.safeParse(await readResponse(response));
      if (!parsed.success || parsed.data.grantId !== grantId) throw new Error(text.invalid);
      setPreview(parsed.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : text.failed); }
    finally { setBusy(false); }
  }

  function changeMapping(externalClassId: string, classId: string) {
    setMapping((current) => ({ ...current, [externalClassId]: classId }));
  }

  async function submit(current: Attempt) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/races/${raceId}/eventor-entry-import`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": current.key },
        body: JSON.stringify(current.request),
      });
      if (response.status === 409) throw new Error(text.conflict);
      if (!response.ok) throw new Error(text.failed);
      const parsed = eventorEntryImportResponseSchema.safeParse(await readResponse(response));
      if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.requestId !== current.key.slice(-36)) throw new Error(text.invalid);
      setResult(parsed.data); setAttempt(undefined); setMessage(text.success);
    } catch (error) {
      if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
        setMessage(text.unknown);
      } else setMessage(error instanceof Error ? error.message : text.failed);
    } finally { setBusy(false); }
  }

  function commit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!preview || attempt) return;
    const next = createEventorEntryImportAttempt(preview, mapping, crypto.randomUUID());
    if (!next) { setMessage(text.invalid); return; }
    setAttempt(next); void submit(next);
  }

  return <section className="panel stack eventor-entry-import" aria-labelledby="eventor-entry-import-heading">
    <h2 id="eventor-entry-import-heading">{text.heading}</h2><p>{text.help}</p>
    <form className="stack" onSubmit={(event) => void getPreview(event)}>
      <label>{text.grant}<input value={grantId} required maxLength={36} disabled={busy || !!attempt}
        onChange={(event) => setGrantId(event.target.value)} /></label>
      <button disabled={busy || !!attempt}>{busy ? text.busy : text.preview}</button>
    </form>
    {preview && <p className="eventor-entry-import-profile">{text.source}: <strong>{eventorProfileLabel(preview.environment)}</strong></p>}
    {preview && !result && <form className="stack" onSubmit={commit}>
      <h3>{text.mapping}</h3><p>{text.mappingHelp}</p>
      {preview.sourceClasses.map((source) => <label key={source.externalClassId}>
        {source.name} ({source.entryCount})
        <select required value={mapping[source.externalClassId] ?? ""} disabled={busy || !!attempt}
          onChange={(event) => changeMapping(source.externalClassId, event.target.value)}>
          <option value="">{text.choose}</option>
          {preview.targetClasses.map((target) => <option key={target.classId} value={target.classId}>{target.name}</option>)}
        </select>
      </label>)}
      <button disabled={busy || !!attempt}>{text.commit}</button>
    </form>}
    {attempt && <div className="eventor-entry-import-uncertain" role="alert"><p>{message || text.unknown}</p><button disabled={busy} onClick={() => void submit(attempt)}>{text.retry}</button></div>}
    {result && <p role="status">{text.success} {result.entriesCreated} {text.created}, {result.entriesUnchanged} {text.unchanged}.</p>}
    {!attempt && !result && message && <p className="eventor-entry-import-error" role="alert">{message}</p>}
  </section>;
}
