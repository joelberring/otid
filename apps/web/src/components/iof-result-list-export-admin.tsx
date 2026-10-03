"use client";

import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  iofResultListExportAdminLoginRequestSchema,
  iofResultListExportAdminLoginResponseSchema,
  type IofResultListExportMetadata,
  type RaceResultFinalizationMetadata
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  iofResultListExportFilename,
  parseFrozenRaceFinalizations,
  parseIofResultListExportMetadata,
  readIofResultListExportAdminCsrf,
  validateFrozenIofResultListResponse
} from "../lib/iof-result-list-export-admin-client";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; } catch { throw new Error(sv.resultListExportInvalidResponse); }
}
function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.resultListExportUnknownError;
}
function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function IofResultListExportAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [metadata, setMetadata] = useState<IofResultListExportMetadata>();
  const [finalizations, setFinalizations] = useState<readonly RaceResultFinalizationMetadata[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(sv.resultListExportCheckingSession);
  const [logoutUnconfirmed, setLogoutUnconfirmed] = useState(false);
  const sessionUrl = `/api/admin/races/${raceId}/iof-result-list-export-session`;
  const downloadUrl = `/api/admin/races/${raceId}/exports/result-list.xml`;
  const finalizationsUrl = `/api/admin/races/${raceId}/exports/final-result-lists`;

  const clearPrivateState = useCallback(() => {
    setAccessCredential("");
    setMetadata(undefined);
    setFinalizations([]);
  }, []);

  const handlePrivateResponse = useCallback((response: Response): boolean => {
    if (response.status !== 401 && response.status !== 403) return false;
    clearPrivateState();
    setAuthenticated(false);
    setMessage(sv.resultListExportLoginRequired);
    return true;
  }, [clearPrivateState]);

  const loadFinalizations = useCallback(async () => {
    const response = await fetch(finalizationsUrl, { credentials: "same-origin", cache: "no-store" });
    if (handlePrivateResponse(response)) return false;
    if (!response.ok) throw new Error(`${sv.resultListExportSessionFailed} (${response.status})`);
    const parsed = parseFrozenRaceFinalizations(await responseJson(response), raceId);
    setFinalizations(parsed.finalizations);
    return true;
  }, [finalizationsUrl, handlePrivateResponse, raceId]);

  const checkSession = useCallback(async () => {
    const response = await fetch(sessionUrl, { credentials: "same-origin", cache: "no-store" });
    if (handlePrivateResponse(response)) return;
    if (!response.ok) throw new Error(`${sv.resultListExportSessionFailed} (${response.status})`);
    const parsed = iofResultListExportAdminLoginResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.capability !== "EXPORT_IOF_RESULT_LIST") {
      throw new Error(sv.resultListExportInvalidResponse);
    }
    setAuthenticated(true);
    if (await loadFinalizations()) setMessage("");
  }, [handlePrivateResponse, loadFinalizations, raceId, sessionUrl]);

  useEffect(() => { void checkSession().catch((error: unknown) => setMessage(messageFrom(error))); }, [checkSession]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(sv.resultListExportLoggingIn); setLogoutUnconfirmed(false);
    try {
      const parsed = iofResultListExportAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.resultListExportLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });
      if (!response.ok) throw new Error(response.status === 401
        ? sv.resultListExportLoginRejected : `${sv.resultListExportSessionFailed} (${response.status})`);
      const session = iofResultListExportAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId ||
          session.data.capability !== "EXPORT_IOF_RESULT_LIST") throw new Error(sv.resultListExportInvalidResponse);
      setAuthenticated(true);
      if (await loadFinalizations()) setMessage("");
    } catch (error) { setMessage(messageFrom(error)); } finally {
      setAccessCredential(""); setBusy(false);
    }
  }

  async function download() {
    setBusy(true); setMessage(sv.resultListExportDownloading);
    try {
      const response = await fetch(downloadUrl, { credentials: "same-origin", cache: "no-store" });
      if (handlePrivateResponse(response)) return;
      if (!response.ok) throw new Error(`${sv.resultListExportDownloadFailed} (${response.status})`);
      if (response.headers.get("content-type") !== "application/xml; charset=utf-8") {
        throw new Error(sv.resultListExportInvalidResponse);
      }
      const nextMetadata = parseIofResultListExportMetadata(response, raceId);
      const filename = iofResultListExportFilename(response, raceId);
      const buffer = await response.arrayBuffer();
      const declaredLength = response.headers.get("content-length");
      if (!declaredLength || !/^\d+$/.test(declaredLength) || Number(declaredLength) !== buffer.byteLength) {
        throw new Error(sv.resultListExportInvalidResponse);
      }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
      if (bytesToHex(digest) !== nextMetadata.sha256) throw new Error(sv.resultListExportInvalidResponse);
      const objectUrl = URL.createObjectURL(new Blob([buffer], { type: "application/xml;charset=utf-8" }));
      try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl; anchor.download = filename; anchor.rel = "noopener";
        document.body.append(anchor); anchor.click(); anchor.remove();
      } finally { URL.revokeObjectURL(objectUrl); }
      setMetadata(nextMetadata); setMessage(sv.resultListExportDownloaded);
    } catch (error) { setMessage(messageFrom(error)); } finally { setBusy(false); }
  }

  async function downloadFinalization(finalization: RaceResultFinalizationMetadata) {
    setBusy(true); setMessage(sv.resultListExportDownloadingComplete);
    try {
      const response = await fetch(`${finalizationsUrl}/${finalization.id}`, {
        credentials: "same-origin", cache: "no-store"
      });
      if (handlePrivateResponse(response)) return;
      if (!response.ok) throw new Error(`${sv.resultListExportDownloadFailed} (${response.status})`);
      const filename = validateFrozenIofResultListResponse(response, finalization);
      const buffer = await response.arrayBuffer();
      const declaredLength = response.headers.get("content-length");
      if (!declaredLength || !/^\d+$/.test(declaredLength) || Number(declaredLength) !== buffer.byteLength) {
        throw new Error(sv.resultListExportInvalidResponse);
      }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
      if (bytesToHex(digest) !== finalization.completeXmlSha256) {
        throw new Error(sv.resultListExportInvalidResponse);
      }
      const objectUrl = URL.createObjectURL(new Blob([buffer], { type: "application/xml;charset=utf-8" }));
      try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl; anchor.download = filename; anchor.rel = "noopener";
        document.body.append(anchor); anchor.click(); anchor.remove();
      } finally { URL.revokeObjectURL(objectUrl); }
      setMessage(sv.resultListExportDownloadedComplete);
    } catch (error) { setMessage(messageFrom(error)); } finally { setBusy(false); }
  }

  async function requestLogout() {
    clearPrivateState(); setBusy(true); setMessage(sv.resultListExportLoggingOut);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE", credentials: "same-origin",
        headers: { "x-otid-csrf": readIofResultListExportAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) throw new Error(`${sv.resultListExportLogoutFailed} (${response.status})`);
      setAuthenticated(false); setLogoutUnconfirmed(false); setMessage(sv.resultListExportLoggedOut);
    } catch (error) {
      setAuthenticated(undefined); setLogoutUnconfirmed(true);
      setMessage(`${messageFrom(error)} ${sv.resultListExportLogoutUnknown}`);
    } finally { setBusy(false); }
  }

  return <div className="stack result-list-export-admin">
    <section className="panel result-list-export-security-note">
      <h1>{sv.resultListExportPageHeading}</h1><p>{sv.resultListExportPageLead}</p>
      <p className="muted">{sv.resultListExportRaceLabel}: {raceId}</p>
    </section>

    {logoutUnconfirmed && <section className="panel warning stack" role="alert">
      <h2>{sv.resultListExportLogoutUnconfirmedHeading}</h2><p>{sv.resultListExportLogoutUnknown}</p>
      <button type="button" disabled={busy} onClick={() => void requestLogout()}>{sv.resultListExportRetryLogout}</button>
    </section>}

    {authenticated !== true && !logoutUnconfirmed && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.resultListExportLoginHeading}</h2><p className="muted">{sv.resultListExportLoginHelp}</p>
      <label>{sv.resultListExportAccessCredential}<input type="password" autoComplete="off" spellCheck={false}
        value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>{sv.resultListExportLogin}</button>
    </form>}

    {authenticated === true && <section className="panel stack">
      <h2>{sv.resultListExportDownloadHeading}</h2><p><strong>{sv.resultListExportSnapshotHeading}</strong></p>
      <p>{sv.resultListExportDownloadHelp}</p>
      <div className="pairing-actions"><button type="button" disabled={busy} onClick={() => void download()}>{sv.resultListExportDownload}</button>
        <button className="secondary" type="button" disabled={busy} onClick={() => void requestLogout()}>{sv.resultListExportLogout}</button></div>
    </section>}

    {authenticated === true && <section className="panel stack">
      <h2>{sv.resultListExportCompleteHeading}</h2><p>{sv.resultListExportCompleteHelp}</p>
      {finalizations.length === 0 && <p className="muted">{sv.resultListExportNoComplete}</p>}
      <div className="result-finalization-list">
        {finalizations.map((finalization) => <article className="result-finalization-scope" key={finalization.id}>
          <div><h3>{sv.resultListExportCompleteRevision(finalization.scopeRevision)}</h3>
            <p>{new Date(finalization.finalizedAt).toLocaleString("sv-SE")} · {finalization.entryCount} {sv.resultListExportCompleteResults}</p>
            <p className="muted">SHA-256: <code>{finalization.completeXmlSha256}</code></p></div>
          <button type="button" disabled={busy} onClick={() => void downloadFinalization(finalization)}>
            {sv.resultListExportDownloadComplete}
          </button>
        </article>)}
      </div>
    </section>}

    {metadata && <section className="panel stack" aria-label={sv.resultListExportDownloadHeading}>
      <h2>{sv.resultListExportDownloaded}</h2>
      <dl className="race-overview-activity">
        <dt>{sv.resultListExportSnapshot}</dt><dd>{metadata.snapshotVersion}</dd>
        <dt>{sv.resultListExportClasses}</dt><dd>{metadata.classCount}</dd>
        <dt>{sv.resultListExportResults}</dt><dd>{metadata.resultCount}</dd>
        <dt>{sv.resultListExportStaleResults}</dt><dd>{metadata.staleResultCount}</dd>
        <dt>{sv.resultListExportOmittedEntries}</dt><dd>{metadata.omittedEntryCount}</dd>
        <dt>{sv.resultListExportSha256}</dt><dd><code>{metadata.sha256}</code></dd>
      </dl>
      {metadata.staleResultCount > 0 && <p className="warning" role="alert">{sv.resultListExportStaleWarning}</p>}
    </section>}

    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
