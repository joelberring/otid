"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { relayEn } from "../i18n/workspace-relay-en";
import { courseVariantsEn } from "../i18n/workspace-tools-en";
import { useTexts } from "./language-provider";
import Link from "next/link";
import { IOF_IMPORT_CONFIRM_HEADER, IOF_IMPORT_CONTENT_TYPE, iofImportErrorResponseSchema, raceSessionStatusSchema,
  type IofEntryListChange } from "@o-tid/contracts";
import { importIssues } from "../lib/import-issues";
import { sv } from "../i18n/sv";
import type { Texts } from "../lib/language";
import { courseVariantsSv } from "../i18n/course-variants-sv";
import { relaySv } from "../i18n/relay-sv";
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

function reportSummary(result: IofImportResponse, variantText: Texts<typeof courseVariantsSv>, relayText: Texts<typeof relaySv>): string {
  if (result.report.kind === "CourseData") {
    const { courses, classes, variants, personAssignments, teamAssignments } = result.report.imported;
    // Gafflingar (ADR-0169 beslut 2–3): varianter, löpare och stafettsträckor som fått sin variant ur filen.
    return [sv.importCourseDataSummary(courses, classes),
      ...(variants !== undefined || personAssignments !== undefined ? [variantText.importVariants(variants ?? 0, personAssignments)] : []),
      ...(teamAssignments !== undefined ? [relayText.importTeams(teamAssignments)] : [])].join(", ");
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
  const variantText = useTexts(courseVariantsSv, courseVariantsEn);
  const relayText = useTexts(relaySv, relayEn);
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [attempt, setAttempt] = useState<IofImportAttempt>();
  const [attemptUncertain, setAttemptUncertain] = useState(false);
  const [lastResult, setLastResult] = useState<IofImportResponse>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(sv.importCheckingSession);
  // Översynen 2026-11-02: anmälningslistans skillnader mot de anmälda (vem och vad), före sparandet.
  const [changes, setChanges] = useState<{ blocking: boolean; rows: readonly IofEntryListChange[] }>();
  const [courseFileIssues, setCourseFileIssues] = useState<readonly string[]>();
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
    const parsed = raceSessionStatusSchema.safeParse(await responseJson(response));
    if (!parsed.success || parsed.data.raceId !== raceId) {
      throw new Error(sv.importInvalidResponse);
    }
    if ("authenticated" in parsed.data) {
      setAuthenticated(false);
      setMessage(sv.importLoginRequired);
      return false;
    }
    // Funktionären har ingen import (ADR-0172 beslut 3); servern nekar den också.
    if (parsed.data.role !== "ADMIN") {
      setAuthenticated(false);
      setMessage(sv.importAdminOnly);
      return false;
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
    setChanges(undefined);
    setCourseFileIssues(undefined);
    setAttemptUncertain(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submitAttempt(current: IofImportAttempt, confirmChanges = false) {
    setBusy(true);
    setChanges(undefined);
    setCourseFileIssues(undefined);
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
          "x-otid-csrf": csrf,
          ...(confirmChanges ? { [IOF_IMPORT_CONFIRM_HEADER]: "1" } : {})
        },
        body: current.file
      });
      if (!response.ok) {
        commitMayBeUnknown = false;
        if (response.status === 401 || response.status === 403) setAuthenticated(false);
        if (response.status === 422) throw new Error(`${sv.importRejected} ${await importIssues(response, sv.importInvalidXml)}`);
        if (response.status === 409) {
          const refusal = iofImportErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
          if (refusal.success && refusal.data.changes?.length) {
            setChanges({ blocking: refusal.data.error !== "CHANGES_REQUIRE_CONFIRMATION", rows: refusal.data.changes });
            setMessage(refusal.data.error === "CHANGES_REQUIRE_CONFIRMATION" ? sv.importChangesConfirm : sv.importChangesBlocked);
            return;
          }
          if (refusal.success && refusal.data.error === "COURSE_FILE_SYNC_REQUIRED") {
            setCourseFileIssues(refusal.data.issues ?? []);
            setMessage(sv.importCourseFileSync);
            return;
          }
          throw new Error(`${sv.importFailed} (409). ${refusal.success && refusal.data.issues?.length ? refusal.data.issues.join(" · ") : sv.importConflictHelp}`);
        }
        const suffix = response.status === 401 || response.status === 403
          ? sv.importLoginAgain
          : sv.importRetrySameHelp;
        throw new Error(`${sv.importFailed} (${response.status}). ${suffix}`);
      }
      const result = parseIofImportResponse(await responseJson(response), current, raceId);
      setLastResult(result);
      clearAttempt();
      setMessage(result.status === "stored"
        ? `${sv.importStored}: ${reportSummary(result, variantText, relayText)}.`
        : `${sv.importDuplicate}: ${reportSummary(result, variantText, relayText)}.`);
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
      <form className="stack" noValidate onSubmit={(event) => void importFile(event)}>
        <label>{sv.importFileLabel}
          <input ref={fileInput} type="file" accept=".xml,application/xml" disabled={busy || attempt !== undefined} />
        </label>
        <button type="submit" disabled={busy || attempt !== undefined} aria-busy={busy}>{sv.importButton}</button>
      </form>
    </section>}

    {attempt !== undefined && <section className="panel import-retry stack" role="alert" aria-labelledby="import-retry-heading">
      <h2 id="import-retry-heading">{busy ? "…" : attemptUncertain ? "△" : "↻"} {busy ? sv.importUploading : attemptUncertain ? sv.importUnknownCommit : sv.importAttemptReady}</h2>
      <p>{busy ? sv.importInFlightHelp : attemptUncertain ? sv.importRetrySameHelp : sv.importRetryKnownHelp}</p>
      <dl><dt>{sv.importPendingFile}</dt><dd>{attempt.file.name} · {sv.importByteCount(attempt.file.size)}</dd></dl>
      <div className="pairing-actions">
        {authenticated === true && <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.importRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy} onClick={clearAttempt}>{sv.importClearAttempt}</button>
      </div>
    </section>}

    {changes !== undefined && attempt !== undefined && <section className="panel stack" role="alert" aria-labelledby="import-changes-heading"
      data-testid="import-changes">
      <h2 id="import-changes-heading">{changes.blocking ? sv.importChangesBlockedHeading : sv.importChangesHeading}</h2>
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr><th>{sv.importChangeRunner}</th><th>{sv.importChangeClass}</th><th>{sv.importChangeWhat}</th>
          <th>{sv.importChangeFrom}</th><th>{sv.importChangeTo}</th><th>{sv.importChangeNote}</th></tr></thead>
        <tbody>{changes.rows.map((row, index) => <tr key={`${row.name}-${row.field}-${index}`} data-blocking={row.blocking}>
          <td>{row.name}</td><td>{row.className}</td><td>{sv.importChangeField[row.field]}{row.readOut ? ` · ${sv.importChangeReadOut}` : ""}</td>
          <td>{row.from ?? "–"}</td><td><strong>{row.to ?? "–"}</strong></td><td>{row.blocking ? "△ " : ""}{row.note ?? ""}</td>
        </tr>)}</tbody>
      </table></div>
      {!changes.blocking && <div className="pairing-actions">
        <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt, true)}>{sv.importChangesApply}</button>
      </div>}
    </section>}

    {courseFileIssues !== undefined && <section className="panel stack" role="alert" aria-labelledby="import-course-file-heading"
      data-testid="import-course-file-sync">
      <h2 id="import-course-file-heading">{sv.importCourseFileSyncHeading}</h2>
      <ul>{courseFileIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      <p><Link href={`/admin/${raceId}/manage`}>{sv.importOpenAdministrator}</Link></p>
    </section>}

    {lastResult !== undefined && <section className="panel import-result" aria-labelledby="import-result-heading">
      <h2 id="import-result-heading">✓ {sv.importConfirmed}</h2>
      <p>{lastResult.status === "stored" ? sv.importStored : sv.importDuplicate}</p>
      <p>{reportSummary(lastResult, variantText, relayText)} · {sv.importByteCount(lastResult.byteCount)}</p>
      {lastResult.report.warnings.length > 0 && <ul>{lastResult.report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    </section>}

    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
