"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { relayEn } from "../i18n/workspace-relay-en";
import { courseVariantsEn } from "../i18n/workspace-tools-en";
import { useTexts } from "./language-provider";
import Link from "next/link";
import { IOF_IMPORT_CONFIRM_HEADER, IOF_IMPORT_CONTENT_TYPE, iofImportErrorResponseSchema, raceSessionStatusSchema,
  type IofEntryListChange } from "@o-tid/contracts";
import { importIssues } from "../lib/import-issues";
import { importSv } from "../i18n/import-admin-sv";
import { importEn } from "../i18n/import-admin-en";
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

type ImportText = Texts<typeof importSv>;

async function responseJson(response: Response, text: ImportText): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(text.invalidResponse);
  }
}

function messageFrom(error: unknown, text: ImportText): string {
  return error instanceof Error ? error.message : text.unknownError;
}

function reportSummary(result: IofImportResponse, text: ImportText, variantText: Texts<typeof courseVariantsSv>, relayText: Texts<typeof relaySv>): string {
  if (result.report.kind === "CourseData") {
    const { courses, classes, variants, personAssignments, teamAssignments } = result.report.imported;
    // Gafflingar (ADR-0169 beslut 2–3): varianter, löpare och stafettsträckor som fått sin variant ur filen.
    return [text.courseDataSummary(courses, classes),
      ...(variants !== undefined || personAssignments !== undefined ? [variantText.importVariants(variants ?? 0, personAssignments)] : []),
      ...(teamAssignments !== undefined ? [relayText.importTeams(teamAssignments)] : [])].join(", ");
  }
  if (result.report.kind === "EntryList") {
    return text.entryListSummary(result.report.imported.entries);
  }
  return text.startListSummary(
    result.report.imported.classes,
    result.report.imported.entries,
    result.report.changed.classes,
    result.report.changed.entries,
    result.report.resultsRequiringRecalculation,
    result.report.snapshotChanged
  );
}

export function ImportAdmin({ raceId }: { raceId: string }) {
  const text = useTexts(importSv, importEn);
  const variantText = useTexts(courseVariantsSv, courseVariantsEn);
  const relayText = useTexts(relaySv, relayEn);
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [attempt, setAttempt] = useState<IofImportAttempt>();
  const [attemptUncertain, setAttemptUncertain] = useState(false);
  const [lastResult, setLastResult] = useState<IofImportResponse>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(text.checkingSession);
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
      setMessage(text.loginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${text.sessionFailed} (${response.status})`);
    const parsed = raceSessionStatusSchema.safeParse(await responseJson(response, text));
    if (!parsed.success || parsed.data.raceId !== raceId) {
      throw new Error(text.invalidResponse);
    }
    if ("authenticated" in parsed.data) {
      setAuthenticated(false);
      setMessage(text.loginRequired);
      return false;
    }
    // Funktionären har ingen import (ADR-0172 beslut 3); servern nekar den också.
    if (parsed.data.role !== "ADMIN") {
      setAuthenticated(false);
      setMessage(text.adminOnly);
      return false;
    }
    setAuthenticated(true);
    setMessage("");
    return true;
  }, [raceId, sessionUrl]);

  useEffect(() => {
    void checkSession().catch((error: unknown) => {
      setAuthenticated(false);
      setMessage(messageFrom(error, text));
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
    setMessage(text.uploading);
    let commitMayBeUnknown = false;
    try {
      const csrf = readImportAdminCsrf(document.cookie, new URL(window.location.href), text);
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
        if (response.status === 422) throw new Error(`${text.rejected} ${await importIssues(response, text.invalidXml)}`);
        if (response.status === 409) {
          const refusal = iofImportErrorResponseSchema.safeParse(await response.json().catch(() => undefined));
          if (refusal.success && refusal.data.changes?.length) {
            setChanges({ blocking: refusal.data.error !== "CHANGES_REQUIRE_CONFIRMATION", rows: refusal.data.changes });
            setMessage(refusal.data.error === "CHANGES_REQUIRE_CONFIRMATION" ? text.changesConfirm : text.changesBlocked);
            return;
          }
          if (refusal.success && refusal.data.error === "COURSE_FILE_SYNC_REQUIRED") {
            setCourseFileIssues(refusal.data.issues ?? []);
            setMessage(text.courseFileSync);
            return;
          }
          throw new Error(`${text.failed} (409). ${refusal.success && refusal.data.issues?.length ? refusal.data.issues.join(" · ") : text.conflictHelp}`);
        }
        const suffix = response.status === 401 || response.status === 403
          ? text.loginAgain
          : text.retrySameHelp;
        throw new Error(`${text.failed} (${response.status}). ${suffix}`);
      }
      const result = parseIofImportResponse(await responseJson(response, text), current, raceId, text);
      setLastResult(result);
      clearAttempt();
      setMessage(result.status === "stored"
        ? `${text.stored}: ${reportSummary(result, text, variantText, relayText)}.`
        : `${text.duplicate}: ${reportSummary(result, text, variantText, relayText)}.`);
    } catch (error) {
      setAttemptUncertain(commitMayBeUnknown);
      setMessage(`${messageFrom(error, text)} ${text.attemptRetained}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setMessage(text.chooseFile);
      return;
    }
    setLastResult(undefined);
    setBusy(true);
    setMessage(text.preparing);
    try {
      const created = await createIofImportAttempt(file, globalThis.crypto, text);
      setAttempt(created);
      await submitAttempt(created);
    } catch (error) {
      setMessage(messageFrom(error, text));
      setBusy(false);
    }
  }

  return <div className="stack import-admin">
    <section className="panel import-security-note" aria-labelledby="import-security-heading">
      <h2 id="import-security-heading">{text.securityHeading}</h2>
      <p>{text.securityBoundary}</p>
    </section>

    {authenticated === false && <section className="panel stack">
      <h2>{text.loginHeading}</h2>
      <p className="muted">{text.loginViaAdministrator}</p>
      <p><Link href={`/admin/${raceId}/manage`}>{text.openAdministrator}</Link></p>
    </section>}

    {authenticated === true && <section className="panel stack" aria-labelledby="import-file-heading">
      <div className="import-heading-actions"><div><h2 id="import-file-heading">{text.fileHeading}</h2>
        <p className="muted">{text.fileHelp}</p></div></div>
      <form className="stack" noValidate onSubmit={(event) => void importFile(event)}>
        <label>{text.fileLabel}
          <input ref={fileInput} type="file" accept=".xml,application/xml" disabled={busy || attempt !== undefined} />
        </label>
        <button type="submit" disabled={busy || attempt !== undefined} aria-busy={busy}>{text.button}</button>
      </form>
    </section>}

    {attempt !== undefined && <section className="panel import-retry stack" role="alert" aria-labelledby="import-retry-heading">
      <h2 id="import-retry-heading">{busy ? "…" : attemptUncertain ? "△" : "↻"} {busy ? text.uploading : attemptUncertain ? text.unknownCommit : text.attemptReady}</h2>
      <p>{busy ? text.inFlightHelp : attemptUncertain ? text.retrySameHelp : text.retryKnownHelp}</p>
      <dl><dt>{text.pendingFile}</dt><dd>{attempt.file.name} · {text.byteCount(attempt.file.size)}</dd></dl>
      <div className="pairing-actions">
        {authenticated === true && <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{text.retrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy} onClick={clearAttempt}>{text.clearAttempt}</button>
      </div>
    </section>}

    {changes !== undefined && attempt !== undefined && <section className="panel stack" role="alert" aria-labelledby="import-changes-heading"
      data-testid="import-changes">
      <h2 id="import-changes-heading">{changes.blocking ? text.changesBlockedHeading : text.changesHeading}</h2>
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr><th>{text.changeRunner}</th><th>{text.changeClass}</th><th>{text.changeWhat}</th>
          <th>{text.changeFrom}</th><th>{text.changeTo}</th><th>{text.changeNote}</th></tr></thead>
        <tbody>{changes.rows.map((row, index) => <tr key={`${row.name}-${row.field}-${index}`} data-blocking={row.blocking}>
          <td>{row.name}</td><td>{row.className}</td><td>{text.changeField[row.field]}{row.readOut ? ` · ${text.changeReadOut}` : ""}</td>
          <td>{row.from ?? "–"}</td><td><strong>{row.to ?? "–"}</strong></td><td>{row.blocking ? "△ " : ""}{row.note ?? ""}</td>
        </tr>)}</tbody>
      </table></div>
      {!changes.blocking && <div className="pairing-actions">
        <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt, true)}>{text.changesApply}</button>
      </div>}
    </section>}

    {courseFileIssues !== undefined && <section className="panel stack" role="alert" aria-labelledby="import-course-file-heading"
      data-testid="import-course-file-sync">
      <h2 id="import-course-file-heading">{text.courseFileSyncHeading}</h2>
      <ul>{courseFileIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      <p><Link href={`/admin/${raceId}/manage`}>{text.openAdministrator}</Link></p>
    </section>}

    {lastResult !== undefined && <section className="panel import-result" aria-labelledby="import-result-heading">
      <h2 id="import-result-heading">✓ {text.confirmed}</h2>
      <p>{lastResult.status === "stored" ? text.stored : text.duplicate}</p>
      <p>{reportSummary(lastResult, text, variantText, relayText)} · {text.byteCount(lastResult.byteCount)}</p>
      {lastResult.report.warnings.length > 0 && <ul>{lastResult.report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    </section>}

    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
