"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { IOF_IMPORT_CONTENT_TYPE, raceAdministratorLoginResponseSchema } from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createIofImportAttempt,
  parseIofImportResponse,
  readImportAdminCsrf,
  type IofImportAttempt,
  type IofImportResponse
} from "../lib/import-admin-client";

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(sv.importInvalidResponse);
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.importUnknownError;
}

function reportSummary(result: IofImportResponse): string {
  if (result.report.kind === "CourseData") {
    return sv.importCourseDataSummary(result.report.imported.courses, result.report.imported.classes);
  }
  if (result.report.kind === "EntryList") {
    return sv.importEntryListSummary(result.report.imported.entries);
  }
  return sv.importStartListSummary(
    result.report.imported.classes,
    result.report.imported.entries,
    result.report.changed.classes,
    result.report.changed.entries,
    result.report.resultsRequiringRecalculation,
    result.report.snapshotChanged
  );
}

export function ImportAdmin({ raceId }: { raceId: string }) {
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [attempt, setAttempt] = useState<IofImportAttempt>();
  const [attemptUncertain, setAttemptUncertain] = useState(false);
  const [lastResult, setLastResult] = useState<IofImportResponse>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(sv.importCheckingSession);
  const fileInput = useRef<HTMLInputElement>(null);
  // ADR-0168: importen använder samma administratörsinloggning som /manage.
  const sessionUrl = `/api/admin/races/${raceId}/administrator/session`;
  const importsUrl = `/api/races/${raceId}/imports`;

  const checkSession = useCallback(async () => {
    const response = await fetch(sessionUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false);
      setMessage(sv.importLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.importSessionFailed} (${response.status})`);
    const parsed = raceAdministratorLoginResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success || parsed.data.raceId !== raceId) {
      throw new Error(sv.importInvalidResponse);
    }
    setAuthenticated(true);
    setMessage("");
    return true;
  }, [raceId, sessionUrl]);

  useEffect(() => {
    void checkSession().catch((error: unknown) => {
      setAuthenticated(false);
      setMessage(messageFrom(error));
    });
  }, [checkSession]);

  function clearAttempt() {
    setAttempt(undefined);
    setAttemptUncertain(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submitAttempt(current: IofImportAttempt) {
    setBusy(true);
    setAttemptUncertain(false);
    setMessage(sv.importUploading);
    let commitMayBeUnknown = false;
    try {
      const csrf = readImportAdminCsrf(document.cookie, new URL(window.location.href));
      commitMayBeUnknown = true;
      const response = await fetch(importsUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": IOF_IMPORT_CONTENT_TYPE,
          "idempotency-key": `iof-import:${current.requestId}`,
          "x-otid-csrf": csrf
        },
        body: current.file
      });
      if (!response.ok) {
        commitMayBeUnknown = false;
        if (response.status === 401 || response.status === 403) setAuthenticated(false);
        const suffix = response.status === 401 || response.status === 403
          ? sv.importLoginAgain
          : sv.importRetrySameHelp;
        throw new Error(`${sv.importFailed} (${response.status}). ${suffix}`);
      }
      const result = parseIofImportResponse(await responseJson(response), current, raceId);
      setLastResult(result);
      clearAttempt();
      setMessage(result.status === "stored"
        ? `${sv.importStored}: ${reportSummary(result)}.`
        : `${sv.importDuplicate}: ${reportSummary(result)}.`);
    } catch (error) {
      setAttemptUncertain(commitMayBeUnknown);
      setMessage(`${messageFrom(error)} ${sv.importAttemptRetained}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setMessage(sv.importChooseFile);
      return;
    }
    setLastResult(undefined);
    setBusy(true);
    setMessage(sv.importPreparing);
    try {
      const created = await createIofImportAttempt(file);
      setAttempt(created);
      await submitAttempt(created);
    } catch (error) {
      setMessage(messageFrom(error));
      setBusy(false);
    }
  }

  return <div className="stack import-admin">
    <section className="panel import-security-note" aria-labelledby="import-security-heading">
      <h2 id="import-security-heading">{sv.importSecurityHeading}</h2>
      <p>{sv.importSecurityBoundary}</p>
    </section>

    {authenticated === false && <section className="panel stack">
      <h2>{sv.importLoginHeading}</h2>
      <p className="muted">{sv.importLoginViaAdministrator}</p>
      <p><Link href={`/admin/${raceId}/manage`}>{sv.importOpenAdministrator}</Link></p>
    </section>}

    {authenticated === true && <section className="panel stack" aria-labelledby="import-file-heading">
      <div className="import-heading-actions"><div><h2 id="import-file-heading">{sv.importFileHeading}</h2>
        <p className="muted">{sv.importFileHelp}</p></div></div>
      <form className="stack" onSubmit={(event) => void importFile(event)}>
        <label>{sv.importFileLabel}
          <input ref={fileInput} type="file" accept=".xml,application/xml" required disabled={busy || attempt !== undefined} />
        </label>
        <button type="submit" disabled={busy || attempt !== undefined} aria-busy={busy}>{sv.importButton}</button>
      </form>
    </section>}

    {attempt !== undefined && <section className="panel import-retry stack" role="alert" aria-labelledby="import-retry-heading">
      <h2 id="import-retry-heading">{busy ? "…" : attemptUncertain ? "△" : "↻"} {busy ? sv.importUploading : attemptUncertain ? sv.importUnknownCommit : sv.importAttemptReady}</h2>
      <p>{busy ? sv.importInFlightHelp : attemptUncertain ? sv.importRetrySameHelp : sv.importRetryKnownHelp}</p>
      <dl><dt>{sv.importPendingFile}</dt><dd>{attempt.file.name} · {sv.importByteCount(attempt.file.size)}</dd>
        <dt>{sv.importPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd>
        <dt>{sv.importPendingHash}</dt><dd className="pairing-grant-id">{attempt.contentHash}</dd></dl>
      <div className="pairing-actions">
        {authenticated === true && <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.importRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy} onClick={clearAttempt}>{sv.importClearAttempt}</button>
      </div>
    </section>}

    {lastResult !== undefined && <section className="panel import-result" aria-labelledby="import-result-heading">
      <h2 id="import-result-heading">✓ {sv.importConfirmed}</h2>
      <p>{lastResult.status === "stored" ? sv.importStored : sv.importDuplicate}</p>
      <p>{reportSummary(lastResult)} · {sv.importByteCount(lastResult.byteCount)}</p>
    </section>}

    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
