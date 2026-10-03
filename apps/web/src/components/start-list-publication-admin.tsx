"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { startListPublicationAdminLoginRequestSchema, startListPublicationAdminLoginResponseSchema,
  startListPublicationPreviewResponseSchema, startListPublicationResponseSchema,
  type StartListPublicationPreviewResponse, type StartListPublicationRequest,
  type StartListPublicationContent } from "@o-tid/contracts";
import { readStartListPublicationAdminCsrfCookie } from "../lib/start-list-publication-admin-cookies";
import { startListPublicationSv as text } from "../i18n/start-list-publication-sv";
import { StartListContent } from "./start-list-content";

type Attempt = { id: string; request: StartListPublicationRequest; content: StartListPublicationContent | null };
function PublicationPreview({ content }: { content: StartListPublicationContent }) {
  return <div className="start-list-publication-preview">
    <p id="start-list-publication-preview-help" className="muted">{text.privatePreviewHelp}</p>
    <div className="start-list-publication-preview-list" role="region" aria-label={text.privatePreviewRegion} aria-describedby="start-list-publication-preview-help" tabIndex={0}>
      <StartListContent content={content} />
    </div>
  </div>;
}

export function StartListPublicationAdmin({ raceId }: { raceId: string }) {
  const attemptHeadingRef = useRef<HTMLHeadingElement>(null);
  const [credential, setCredential] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<StartListPublicationPreviewResponse>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(text.checking);
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/start-list-publication`;
  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401 || response.status === 403) {
      setData(undefined); setAuthenticated(false); setMessage(text.denied); return;
    }
    if (!response.ok) throw new Error(text.loadError);
    const result = startListPublicationPreviewResponseSchema.parse(await response.json());
    if (result.raceId !== raceId) throw new Error(text.loadError);
    setData(result); setAuthenticated(true); setMessage("");
  }, [base, raceId]);
  useEffect(() => { void load().catch(() => setMessage(text.loadError)); }, [load]);
  useEffect(() => {
    if (!attempt || busy) return;
    attemptHeadingRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    attemptHeadingRef.current?.focus({ preventScroll: true });
  }, [attempt, unknown, busy]);
  function csrf() {
    const value = readStartListPublicationAdminCsrfCookie(document.cookie, new URL(window.location.href));
    if (!value) throw new Error(text.denied);
    return value;
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const body = startListPublicationAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential: credential });
      const response = await fetch(`${base}-session`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(text.denied);
      const value = startListPublicationAdminLoginResponseSchema.parse(await response.json());
      if (value.raceId !== raceId) throw new Error(text.denied);
      await load();
    } catch { setMessage(text.denied); } finally { setCredential(""); setBusy(false); }
  }
  async function logout() {
    setBusy(true); setData(undefined);
    try {
      const response = await fetch(`${base}-session`, { method: "DELETE", credentials: "same-origin", headers: { "x-otid-csrf": csrf() } });
      if (!response.ok && response.status !== 401) throw new Error(text.error);
      setAuthenticated(false); setMessage(text.denied);
      if (!unknown) setAttempt(undefined);
    } catch { setMessage(text.error); } finally { setBusy(false); }
  }
  function prepare(action: "PUBLISH" | "WITHDRAW") {
    if (!data) return;
    if (action === "PUBLISH" && (!data.content || !data.sourceHash)) return;
    const expectedRevision = data.latestDecision?.revision ?? 0;
    const request: StartListPublicationRequest = action === "PUBLISH" && data.sourceHash
      ? { formatVersion: 1, action, expectedRevision, expectedSnapshotVersion: data.snapshotVersion, expectedSourceHash: data.sourceHash }
      : { formatVersion: 1, action: "WITHDRAW", expectedRevision };
    setAttempt({ id: crypto.randomUUID(), request, content: data.content }); setUnknown(false); setMessage("");
  }
  async function submit(current: Attempt) {
    setBusy(true);
    try {
      const response = await fetch(base, { method: "POST", credentials: "same-origin", headers: {
        "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `start-list-publication:${current.id}`
      }, body: JSON.stringify(current.request) });
      if ([400, 409].includes(response.status)) {
        if (unknown) { setMessage(text.unknown); return; }
        setAttempt(undefined); await load().catch(() => setData(undefined)); setMessage(text.conflict); return;
      }
      if (response.status === 401 || response.status === 403) {
        setAuthenticated(false); setData(undefined); setUnknown(true); setMessage(text.reauth); return;
      }
      if (!response.ok) throw new Error(text.unknown);
      const result = startListPublicationResponseSchema.parse(await response.json());
      if (result.requestId !== current.id || result.raceId !== raceId || result.action !== current.request.action ||
        result.revision !== current.request.expectedRevision + 1 || (current.request.action === "PUBLISH" &&
          (result.sourceHash !== current.request.expectedSourceHash || result.sourceSnapshotVersion !== current.request.expectedSnapshotVersion))) {
        throw new Error(text.unknown);
      }
      setAttempt(undefined); setUnknown(false); await load().catch(() => setData(undefined)); setMessage(text.saved);
    } catch { setUnknown(true); setMessage(text.unknown); } finally { setBusy(false); }
  }
  return <div className="stack start-list-publication-admin">
    <div className="start-list-publication-intro"><p>{text.privateIntro}</p><p className="muted">{text.privatePrivacy}</p></div>
    {!authenticated && <form className="panel stack start-list-publication-login" onSubmit={(event) => void login(event)}>
      <label>{text.credential}<input type="password" value={credential} onChange={(event) => setCredential(event.target.value)} autoComplete="off" spellCheck={false} required /></label>
      <button disabled={busy}>{text.login}</button>
    </form>}
    {authenticated && <section className="panel start-list-publication-tools" aria-label={text.privateToolsHeading}>
      <div className="start-list-publication-toolbar">
        <button className="secondary" disabled={busy} onClick={() => void logout()}>{text.logout}</button>
        <button className="secondary" disabled={busy || !!attempt} onClick={() => { setBusy(true); void load().catch(() => { setData(undefined); setMessage(text.loadError); }).finally(() => setBusy(false)); }}>{text.refresh}</button>
        <Link href={`/starts/${encodeURIComponent(raceId)}`}>{text.publicLink}</Link>
      </div>
      {data && <>
        <div className="start-list-publication-decision-strip">
          <span><strong>{text.snapshot}:</strong> {data.snapshotVersion}</span>
          <span>{data.latestDecision ? <><strong>{text.currentRevision}:</strong> {data.latestDecision.revision} · {data.latestDecision.action === "PUBLISH" ? text.published : text.withdrawn}</> : text.noPublication}</span>
        </div>
        {data.latestDecision?.action === "PUBLISH" && data.latestDecision.sourceHash !== data.sourceHash && <p className="start-list-publication-signal">△ {text.changed}</p>}
        {!data.content && <p className="start-list-publication-signal">△ {text.invalidContent}</p>}
        <div className="start-list-publication-actions">
          {data.content && (data.content.classes.some((row) => row.entries.length > 0)
            ? <button disabled={busy || !!attempt} onClick={() => prepare("PUBLISH")}>{text.inspectPublish}</button> : <p className="muted">{text.empty}</p>)}
          {data.latestDecision?.action === "PUBLISH" && <button className="secondary" disabled={busy || !!attempt} onClick={() => prepare("WITHDRAW")}>{text.inspectWithdraw}</button>}
        </div>
      </>}
    </section>}
    {attempt && <section className={`panel stack start-list-publication-attempt${unknown ? " is-unknown" : ""}`} role="alert">
      <h2 ref={attemptHeadingRef} tabIndex={-1}>{unknown ? text.unknown : attempt.request.action === "PUBLISH" ? text.pendingPublish : text.pendingWithdraw}</h2>
      <dl className="start-list-publication-attempt-facts">
        <dt>{text.privateAction}</dt><dd>{attempt.request.action === "PUBLISH" ? text.privatePublishAction : text.privateWithdrawAction}</dd>
        <dt>{text.currentRevision}</dt><dd>{attempt.request.expectedRevision}</dd>
        {attempt.request.action === "PUBLISH" && <>
          <dt>{text.snapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd>
          <dt>{text.privateSourceHash}</dt><dd className="start-list-publication-hash">{attempt.request.expectedSourceHash}</dd>
        </>}
        {unknown && <><dt>{text.privateRequestId}</dt><dd className="start-list-publication-hash">{attempt.id}</dd></>}
      </dl>
      <p>{attempt.request.action === "PUBLISH" ? text.privateFields : text.privateWithdrawHelp}</p>
      {attempt.request.action === "PUBLISH" && <p className="muted">{text.privatePublishConsequence}</p>}
      <div className="start-list-publication-actions">
        {authenticated && <button disabled={busy} onClick={() => void submit(attempt)}>{unknown ? text.retry : attempt.request.action === "PUBLISH" ? text.confirmPublish : text.confirmWithdraw}</button>}
        {!unknown && <button className="secondary" disabled={busy} onClick={() => setAttempt(undefined)}>{text.cancel}</button>}
      </div>
      {authenticated && attempt.request.action === "PUBLISH" && attempt.content && <PublicationPreview key={attempt.id} content={attempt.content} />}
    </section>}
    {authenticated && data?.content && !attempt && <section className="start-list-publication-current-preview stack"><h2>{text.preview}</h2><p>{text.privateFields}</p><PublicationPreview key={data.sourceHash} content={data.content} /></section>}
    <p className="start-list-publication-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
