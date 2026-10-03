"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  readoutResultHistoryAdminLoginRequestSchema,
  readoutResultHistoryAdminLoginResponseSchema,
  entryReadoutHistoryResponseSchema,
  type ReadoutHistoryDetailResponse,
  type ReadoutHistoryListResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { consumeEntryNavigation } from "../lib/entry-navigation";
import {
  parseReadoutHistoryDetail,
  parseReadoutHistoryList,
  readReadoutResultHistoryAdminCsrf
} from "../lib/readout-result-history-admin-client";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; } catch { throw new Error(sv.readoutHistoryInvalidResponse); }
}
function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.readoutHistoryUnknownError;
}
function time(value: string): string { return new Date(value).toLocaleString("sv-SE"); }
function assessmentText(status: string | undefined, reason: string | undefined): string {
  if (!status || !reason) return sv.readoutHistoryAssessmentMissing;
  return `${status} · ${reason} – ${sv.readoutHistoryReason[reason as keyof typeof sv.readoutHistoryReason] ?? reason}`;
}
function causeText(cause: string): string {
  return sv.readoutHistoryCause[cause as keyof typeof sv.readoutHistoryCause] ?? cause;
}

export function ReadoutResultHistoryAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [list, setList] = useState<ReadoutHistoryListResponse>();
  const [hintEntryId, setHintEntryId] = useState<string>();
  const [scopedEntryId, setScopedEntryId] = useState<string>();
  const [entryIdentity, setEntryIdentity] = useState<{ id: string; displayName: string }>();
  const hintConsumed = useRef(false);
  const requestGeneration = useRef(0);
  useEffect(() => {
    if (hintConsumed.current) return;
    hintConsumed.current = true;
    setHintEntryId(consumeEntryNavigation(raceId, "history"));
  }, [raceId]);
  const [detailPages, setDetailPages] = useState<ReadoutHistoryDetailResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(sv.readoutHistoryCheckingSession);
  const [logoutUnconfirmed, setLogoutUnconfirmed] = useState(false);
  const sessionUrl = `/api/admin/races/${raceId}/readout-result-history-session`;
  const listUrl = `/api/admin/races/${raceId}/readouts`;

  const clearPrivateState = useCallback(() => {
    requestGeneration.current += 1;
    setScopedEntryId(undefined); setEntryIdentity(undefined);
    setList(undefined);
    setDetailPages([]);
    setAccessCredential("");
  }, []);

  const handlePrivateResponse = useCallback((response: Response): boolean => {
    if (response.status !== 401 && response.status !== 403) return false;
    requestGeneration.current += 1;
    setScopedEntryId(undefined); setEntryIdentity(undefined);
    setList(undefined);
    setDetailPages([]);
    setAuthenticated(false);
    setMessage(sv.readoutHistoryLoginRequired);
    return true;
  }, []);

  const loadList = useCallback(async (cursor?: string, append = false) => {
    const generation = ++requestGeneration.current;
    if (!append) { setScopedEntryId(undefined); setEntryIdentity(undefined); setList(undefined); setDetailPages([]); }
    const url = cursor ? `${listUrl}?cursor=${encodeURIComponent(cursor)}` : listUrl;
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (generation !== requestGeneration.current) return false;
    if (handlePrivateResponse(response)) return false;
    if (!response.ok) throw new Error(`${sv.readoutHistoryLoadFailed} (${response.status})`);
    const page = parseReadoutHistoryList(await responseJson(response), raceId);
    if (generation !== requestGeneration.current) return false;
    setList((current) => append && current ? {
      ...page,
      items: [...current.items, ...page.items]
    } : page);
    setAuthenticated(true);
    setMessage("");
    return true;
  }, [handlePrivateResponse, listUrl, raceId]);

  useEffect(() => { void loadList().catch((error: unknown) => setMessage(messageFrom(error))); }, [loadList]);

  async function loadEntryList(entryId: string, cursor?: string, append = false) {
    const generation = ++requestGeneration.current;
    setScopedEntryId(entryId);
    if (!append) { setList(undefined); setEntryIdentity(undefined); setDetailPages([]); }
    const url = `/api/admin/races/${raceId}/entries/${entryId}/readouts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (generation !== requestGeneration.current) return;
    if (handlePrivateResponse(response)) return;
    if (!response.ok) throw new Error(`${sv.readoutHistoryLoadFailed} (${response.status})`);
    const parsed = entryReadoutHistoryResponseSchema.safeParse(await responseJson(response));
    if (generation !== requestGeneration.current) return;
    if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.entry.id !== entryId) {
      setList(undefined); setEntryIdentity(undefined); setDetailPages([]);
      throw new Error(sv.readoutHistoryInvalidResponse);
    }
    if (append && (!list || scopedEntryId !== entryId || entryIdentity?.id !== entryId ||
      entryIdentity.displayName !== parsed.data.entry.displayName ||
      parsed.data.page.items.some((item) => list.items.some((previous) => previous.id === item.id)))) {
      setList(undefined); setEntryIdentity(undefined); setDetailPages([]);
      throw new Error(sv.readoutHistoryInvalidResponse);
    }
    setEntryIdentity(parsed.data.entry);
    setList((current) => append && current ? { ...parsed.data.page, items: [...current.items, ...parsed.data.page.items] } : parsed.data.page);
    setMessage("");
  }

  async function selectEntryScope() {
    if (busy || authenticated !== true || !hintEntryId) return;
    setBusy(true); setMessage(sv.readoutHistoryRefreshing);
    try { await loadEntryList(hintEntryId); } catch (error) { setMessage(messageFrom(error)); }
    finally { setBusy(false); }
  }

  async function showAllReadouts() {
    if (busy || authenticated !== true) return;
    setBusy(true); setMessage(sv.readoutHistoryRefreshing);
    try { await loadList(); } catch (error) { setMessage(messageFrom(error)); }
    finally { setBusy(false); }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(sv.readoutHistoryLoggingIn); setLogoutUnconfirmed(false);
    try {
      const parsed = readoutResultHistoryAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.readoutHistoryLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });
      if (!response.ok) throw new Error(response.status === 401
        ? sv.readoutHistoryLoginRejected : `${sv.readoutHistorySessionFailed} (${response.status})`);
      const session = readoutResultHistoryAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId ||
          session.data.capability !== "VIEW_READOUT_RESULT_HISTORY") throw new Error(sv.readoutHistoryInvalidResponse);
      await loadList();
    } catch (error) { setMessage(messageFrom(error)); } finally {
      setAccessCredential(""); setBusy(false);
    }
  }

  async function refresh() {
    if (busy || authenticated !== true) return;
    setBusy(true); setMessage(sv.readoutHistoryRefreshing);
    try { setDetailPages([]); if (scopedEntryId) await loadEntryList(scopedEntryId); else await loadList(); } catch (error) { setMessage(messageFrom(error)); }
    finally { setBusy(false); }
  }

  async function loadOlderReadouts() {
    if (busy || authenticated !== true || !list?.nextCursor) return;
    setBusy(true); setMessage(sv.readoutHistoryLoadingOlder);
    try { if (scopedEntryId) await loadEntryList(scopedEntryId, list.nextCursor, true); else await loadList(list.nextCursor, true); } catch (error) { setMessage(messageFrom(error)); }
    finally { setBusy(false); }
  }

  async function loadDetail(readoutId: string, cursor?: string) {
    if (busy || authenticated !== true || !list?.items.some((item) => item.id === readoutId)) return;
    const generation = ++requestGeneration.current;
    if (!cursor) setDetailPages([]);
    setBusy(true); setMessage(sv.readoutHistoryLoadingDetail);
    try {
      const url = `/api/admin/races/${raceId}/readouts/${readoutId}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      if (generation !== requestGeneration.current) return;
      if (handlePrivateResponse(response)) return;
      if (!response.ok) throw new Error(`${sv.readoutHistoryDetailFailed} (${response.status})`);
      const page = parseReadoutHistoryDetail(await responseJson(response), raceId, readoutId);
      if (generation !== requestGeneration.current) return;
      if (scopedEntryId && page.entry?.id !== scopedEntryId) {
        setDetailPages([]); throw new Error(sv.readoutHistoryInvalidResponse);
      }
      setDetailPages((current) => cursor && current[0]?.readout.id === readoutId ? [...current, page] : [page]);
      setMessage("");
    } catch (error) { setMessage(messageFrom(error)); } finally { setBusy(false); }
  }

  async function requestLogout() {
    clearPrivateState(); setBusy(true); setMessage(sv.readoutHistoryLoggingOut);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE", credentials: "same-origin",
        headers: { "x-otid-csrf": readReadoutResultHistoryAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) throw new Error(`${sv.readoutHistoryLogoutFailed} (${response.status})`);
      setAuthenticated(false); setLogoutUnconfirmed(false); setMessage(sv.readoutHistoryLoggedOut);
    } catch (error) {
      setAuthenticated(undefined); setLogoutUnconfirmed(true);
      setMessage(`${messageFrom(error)} ${sv.readoutHistoryLogoutUnknown}`);
    } finally { setBusy(false); }
  }

  const detail = detailPages[0];
  type HistoryRevision = ReadoutHistoryDetailResponse["history"]["items"][number];
  const revisions = detailPages.reduce<HistoryRevision[]>(
    (items, page) => [...items, ...(page.history.items as HistoryRevision[])],
    []
  );
  const detailCursor = detailPages.at(-1)?.history.nextCursor ?? null;
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const selectedReadoutId = detail?.readout.id;
  useEffect(() => {
    if (!selectedReadoutId) return;
    detailHeadingRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    detailHeadingRef.current?.focus({ preventScroll: true });
  }, [selectedReadoutId]);

  return <div className="stack readout-history-admin">
    <section className="readout-history-security-note">
      <h1>{sv.readoutHistoryPageHeading}</h1>
      <p>{sv.readoutHistoryPageLead}</p><p className="muted">{sv.readoutHistoryRaceLabel}: {raceId}</p>
      <p className="readout-history-timezone-note">{sv.readoutHistoryDeviceTimezone}</p>
    </section>

    {logoutUnconfirmed && <section className="panel readout-history-logout-warning stack" role="alert">
      <h2>{sv.readoutHistoryLogoutUnconfirmedHeading}</h2><p>{sv.readoutHistoryLogoutUnknown}</p>
      <button type="button" disabled={busy} onClick={() => void requestLogout()}>{sv.readoutHistoryRetryLogout}</button>
    </section>}

    {authenticated !== true && !logoutUnconfirmed && <form className="panel stack readout-history-login" onSubmit={(event) => void login(event)}>
      <h2>{sv.readoutHistoryLoginHeading}</h2><p className="muted">{sv.readoutHistoryLoginHelp}</p>
      <label>{sv.readoutHistoryAccessCredential}<input type="password" autoComplete="off" spellCheck={false}
        value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>{sv.readoutHistoryLogin}</button>
    </form>}

    {authenticated === true && <>
      <section className="panel readout-history-heading">
        <div><h2>{sv.readoutHistoryListHeading}</h2><p className="muted">{sv.readoutHistoryListHelp}</p></div>
        <div className="pairing-actions"><button className="secondary" type="button" disabled={busy} onClick={() => void refresh()}>{sv.readoutHistoryRefresh}</button>
          <button className="secondary" type="button" disabled={busy} onClick={() => void requestLogout()}>{sv.readoutHistoryLogout}</button></div>
      </section>
      {hintEntryId && !scopedEntryId && <section className="panel stack readout-history-entry-scope">
        <p>{sv.readoutHistoryLinkedHelp}</p>
        <button type="button" disabled={busy} onClick={() => void selectEntryScope()}>{sv.readoutHistorySelectEntry}</button>
      </section>}
      {scopedEntryId && <section className="panel stack readout-history-entry-scope">
        {entryIdentity && <h2>{entryIdentity.displayName}</h2>}
        <p>{sv.readoutHistoryEntryScopeHelp}</p>
        <button type="button" className="secondary" disabled={busy} onClick={() => void showAllReadouts()}>{sv.readoutHistoryShowAll}</button>
      </section>}
      {list && <>
      <section className="readout-history-list">
        <div className="readout-history-list-head" aria-hidden="true"><span>{sv.readoutHistoryEntry}</span><span>{sv.readoutHistoryCard}</span><span>{sv.readoutHistoryReadAt}</span><span>{sv.readoutHistoryFirstAssessment}</span><span>{sv.readoutHistoryAction}</span></div>
        {list.items.map((item) => <article className="readout-history-row" key={item.id}>
          <p className={item.entry ? "readout-history-person" : "readout-history-person readout-history-missing"}><span className="readout-history-mobile-label">{sv.readoutHistoryEntry}: </span>{item.entry?.displayName ?? sv.readoutHistoryUnknownEntry}</p>
          <h3>{sv.readoutHistoryCard}: {item.cardNumber}</h3>
          <p className="readout-history-read-at"><span className="readout-history-mobile-label">{sv.readoutHistoryReadAt}: </span>{time(item.readAt)}</p>
          <p className="readout-history-assessment" data-status={item.firstServerAssessment?.status ?? "MISSING"}><span className="readout-history-mobile-label">{sv.readoutHistoryFirstAssessment}: </span><strong>{assessmentText(item.firstServerAssessment?.status, item.firstServerAssessment?.reason)}</strong></p>
          <button type="button" disabled={busy} onClick={() => void loadDetail(item.id)}>{sv.readoutHistoryShowDetail}</button>
        </article>)}
        {list.items.length === 0 && <p className="readout-history-empty">{scopedEntryId ? sv.readoutHistoryEntryEmpty : sv.readoutHistoryEmpty}</p>}
      </section>
      {list.nextCursor && <button type="button" disabled={busy} onClick={() => void loadOlderReadouts()}>{sv.readoutHistoryShowOlderReadouts}</button>}
      </>}
    </>}

    {detail && <section className="panel stack readout-history-detail" aria-label={sv.readoutHistoryDetailHeading}>
      <h2 ref={detailHeadingRef} tabIndex={-1}>{sv.readoutHistoryDetailHeading}</h2>
      <p className={detail.entry ? "readout-history-detail-person" : "readout-history-detail-person readout-history-missing"}>{sv.readoutHistoryEntry}: <strong>{detail.entry?.displayName ?? sv.readoutHistoryUnknownEntry}</strong></p>
      <p><strong>{sv.readoutHistoryCard}: {detail.readout.cardNumber}</strong> · {time(detail.readout.readAt)}</p>
      <dl className="readout-history-readout-facts">
        <div><dt>{sv.readoutHistoryStart}</dt><dd className={detail.readout.startPunchedAt ? undefined : "readout-history-missing"}>{detail.readout.startPunchedAt ? time(detail.readout.startPunchedAt) : sv.readoutHistoryStartMissing}</dd></div>
        <div><dt>{sv.readoutHistoryFinish}</dt><dd>{time(detail.readout.finishPunchedAt)}</dd></div>
      </dl>
      <p className="readout-history-assessment" data-status={detail.firstServerAssessment?.status ?? "MISSING"}>{sv.readoutHistoryFirstAssessment}: <strong>{assessmentText(detail.firstServerAssessment?.status, detail.firstServerAssessment?.reason)}</strong></p>
      <div className="readout-history-detail-columns">
      <section className="readout-history-punches" aria-labelledby="readout-history-punches-heading">
        <h3 id="readout-history-punches-heading">{sv.readoutHistoryPunches}</h3>
        <ol>{detail.readout.punches.map((punch, index) => <li key={`${punch.code}-${punch.punchedAt}-${index}`}>{punch.code} · {time(punch.punchedAt)}</li>)}</ol>
        {detail.readout.punches.length === 0 && <p className="readout-history-missing">{sv.readoutHistoryNoPunches}</p>}
      </section>
      <section className="readout-history-revisions" aria-labelledby="readout-history-revisions-heading">
      <h3 id="readout-history-revisions-heading">{sv.readoutHistoryRevisions}</h3>
      {revisions.map((revision) => <article className="readout-history-revision stack" key={revision.id}>
        <h4>{sv.revisions} {revision.revision} · {revision.cause} – {causeText(revision.cause)}</h4>
        <p className="readout-history-assessment" data-status={revision.status}><strong>{assessmentText(revision.status, revision.reason)}</strong></p>
        {"source" in revision && revision.source.kind === "START_CHECKIN_DID_NOT_START" &&
          revision.source.withdrawal !== null && <p>{sv.readoutHistoryCheckinDnsWithdrawn}</p>}
        <p>{sv.readoutHistoryCreatedAt}: {time(revision.createdAt)} · {revision.published ? sv.readoutHistoryPublished : sv.readoutHistoryUnpublished}</p>
        <p className="readout-history-revision-versions">{sv.readoutHistoryVersions}: {revision.engineVersion} · snapshot {revision.snapshotVersion} · course {revision.courseVersionId}</p>
        {revision.evaluation.status === "DNS" ? <p>{sv.didNotStartMark}</p> : "missingControls" in revision.evaluation ? <>
          <p className={revision.evaluation.missingControls.length > 0 ? "readout-history-missing" : undefined}>{sv.readoutHistoryMissing}: {revision.evaluation.missingControls.join(", ") || "–"}</p>
          <p>{sv.readoutHistoryExtra}: {revision.evaluation.extraPunches.join(", ") || "–"}</p>
          <details><summary>{sv.readoutHistorySplits}</summary><ol>{revision.evaluation.splits.map((split) =>
            <li key={`${split.controlCode}-${split.occurrence}`}>{split.controlCode} ({split.occurrence}) · {split.elapsedMs} ms · {split.legMs} ms</li>)}</ol></details>
        </> : <p>{sv.readoutHistoryAssessmentMissing}</p>}
      </article>)}
      {revisions.length === 0 && <p>{sv.readoutHistoryNoRevisions}</p>}
      {detailCursor && <button type="button" disabled={busy} onClick={() => void loadDetail(detail.readout.id, detailCursor)}>{sv.readoutHistoryShowOlderRevisions}</button>}
      </section>
      </div>
    </section>}

    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
