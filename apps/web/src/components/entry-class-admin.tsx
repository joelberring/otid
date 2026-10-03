"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  entryClassAdminLoginRequestSchema,
  entryClassAdminLoginResponseSchema,
  type EntryClassChangeResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { consumeEntryNavigation } from "../lib/entry-navigation";
import {
  createEntryClassChangeAttempt,
  entryClassChangeBody,
  isDefinitiveEntryClassRejection,
  parseEntryClassAdminData,
  parseEntryClassChangeResponse,
  readEntryClassAdminCsrf,
  type EntryClassAdminData,
  type EntryClassChangeAttempt
} from "../lib/entry-class-admin-client";

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(sv.entryClassInvalidResponse);
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.entryClassUnknownError;
}

export function EntryClassAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [data, setData] = useState<EntryClassAdminData>();
  const [selectedClasses, setSelectedClasses] = useState<Record<string, string>>({});
  const [linkedEntryId, setLinkedEntryId] = useState<string>();
  const [focusedEntryId, setFocusedEntryId] = useState<string>();
  const hintConsumed = useRef(false);
  useEffect(() => {
    if (hintConsumed.current) return;
    hintConsumed.current = true;
    setLinkedEntryId(consumeEntryNavigation(raceId, "classes"));
  }, [raceId]);
  const [attempt, setAttempt] = useState<EntryClassChangeAttempt>();
  const [lastResult, setLastResult] = useState<EntryClassChangeResponse>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(sv.entryClassCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/entry-class-session`;
  const dataUrl = `/api/admin/races/${raceId}/entry-classes`;

  const loadData = useCallback(async () => {
    const response = await fetch(dataUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false);
      setData(undefined);
      setMessage(sv.entryClassLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.entryClassSessionFailed} (${response.status})`);
    const parsed = parseEntryClassAdminData(await responseJson(response), raceId);
    setData(parsed);
    setSelectedClasses(Object.fromEntries(parsed.entries.map((entry) => [entry.id, entry.classId])));
    setAuthenticated(true);
    setMessage("");
    return true;
  }, [dataUrl, raceId]);

  useEffect(() => {
    void loadData().catch((error: unknown) => {
      setAuthenticated(false);
      setData(undefined);
      setMessage(messageFrom(error));
    });
  }, [loadData]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(sv.entryClassLoggingIn);
    try {
      const parsed = entryClassAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.entryClassLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });
      if (!response.ok) {
        throw new Error(response.status === 401 ? sv.entryClassLoginRejected : `${sv.entryClassSessionFailed} (${response.status})`);
      }
      const loginResponse = entryClassAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!loginResponse.success || loginResponse.data.raceId !== raceId || loginResponse.data.capability !== "CHANGE_ENTRY_CLASS") {
        throw new Error(sv.entryClassInvalidResponse);
      }
      const loaded = await loadData();
      if (loaded && attempt !== undefined) setMessage(sv.entryClassAttemptRetained);
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  async function submitAttempt(current: EntryClassChangeAttempt) {
    setBusy(true);
    setMessage(sv.entryClassChanging);
    try {
      const response = await fetch(`/api/races/${raceId}/entries/${current.entryId}/class`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `entry-class-change:${current.requestId}`,
          "x-otid-csrf": readEntryClassAdminCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(entryClassChangeBody(current))
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAuthenticated(false);
          setData(undefined);
        }
        if (isDefinitiveEntryClassRejection(response.status)) {
          setAttempt(undefined);
          if (response.status === 409) {
            try {
              await loadData();
            } catch {
              setAuthenticated(false);
              setData(undefined);
            }
          }
          setMessage(response.status === 409
            ? sv.entryClassConflict
            : `${sv.entryClassFailed} (${response.status}).`);
          return;
        }
        const detail = response.status === 401 || response.status === 403
          ? sv.entryClassLoginAgain
          : sv.entryClassUnknownCommitHelp;
        throw new Error(`${sv.entryClassFailed} (${response.status}). ${detail}`);
      }
      const result = parseEntryClassChangeResponse(await responseJson(response), current, raceId);
      setLastResult(result);
      setAttempt(undefined);
      setMessage(result.replayed ? sv.entryClassReplayRecovered : sv.entryClassChanged);
      try {
        await loadData();
        setMessage(result.replayed ? sv.entryClassReplayRecovered : sv.entryClassChanged);
      } catch {
        setMessage(`${result.replayed ? sv.entryClassReplayRecovered : sv.entryClassChanged} ${sv.entryClassSessionFailed}.`);
      }
    } catch (error) {
      setMessage(`${messageFrom(error)} ${sv.entryClassAttemptRetained}`);
    } finally {
      setBusy(false);
    }
  }

  async function beginChange(entryId: string) {
    if (!data) return;
    const entry = data.entries.find((candidate) => candidate.id === entryId);
    const classId = selectedClasses[entryId];
    if (!entry || !classId) return;
    setLastResult(undefined);
    try {
      const created = createEntryClassChangeAttempt({
        entryId,
        displayName: entry.displayName,
        previousClassId: entry.classId,
        classId,
        expectedEntryVersion: entry.version
      });
      setAttempt(created);
      await submitAttempt(created);
    } catch (error) {
      setMessage(messageFrom(error));
    }
  }

  function clearAttempt() {
    setAttempt(undefined);
    setMessage("");
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-otid-csrf": readEntryClassAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) throw new Error(`${sv.entryClassLogoutFailed} (${response.status})`);
      setAuthenticated(false);
      setData(undefined);
      setLastResult(undefined);
      setMessage(attempt === undefined ? sv.entryClassLoggedOut : `${sv.entryClassLoggedOut} ${sv.entryClassAttemptRetained}`);
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  const linkedEntry = data?.entries.find((entry) => entry.id === linkedEntryId);
  const linkedClass = data?.classes.find((raceClass) => raceClass.id === linkedEntry?.classId);
  function selectLinkedEntry() {
    if (authenticated !== true || !linkedEntry || busy || attempt) return;
    setFocusedEntryId(linkedEntry.id);
    setSelectedClasses((current) => ({ ...current, [linkedEntry.id]: linkedEntry.classId }));
    setLinkedEntryId(undefined);
  }
  function showAllEntries() {
    if (busy || attempt) return;
    setFocusedEntryId(undefined);
  }

  return <div className="stack entry-class-admin">
    <section className="panel entry-class-security-note" aria-labelledby="entry-class-security-heading">
      <h2 id="entry-class-security-heading">{sv.entryClassSecurityHeading}</h2>
      <p>{sv.entryClassSecurityBoundary}</p>
    </section>

    {authenticated !== true && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.entryClassLoginHeading}</h2>
      <p className="muted">{sv.entryClassLoginHelp}</p>
      <label>{sv.entryClassAccessCredential}
        <input type="password" autoComplete="off" spellCheck={false} value={accessCredential}
          onChange={(event) => setAccessCredential(event.target.value)} required />
      </label>
      <button type="submit" disabled={busy || accessCredential.length === 0} aria-busy={busy}>{sv.entryClassLogin}</button>
    </form>}

    {authenticated === true && data !== undefined && <section className="panel stack" aria-labelledby="entry-class-data-heading">
      <div className="entry-class-heading"><div><h2 id="entry-class-data-heading">{sv.entryClassDataHeading}</h2>
        <p className="muted">{sv.entryClassDataHelp}</p>
        <p><strong>{sv.entryClassSnapshotVersion}: {data.snapshotVersion}</strong></p></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>{sv.entryClassLogout}</button></div>
      {linkedEntry && <div className="entry-class-linked">
        <p>{sv.entryClassLinkedHelp}</p><p><strong>{linkedEntry.displayName} · {linkedClass?.name}</strong></p>
        <button type="button" className="secondary" disabled={busy || !!attempt} onClick={selectLinkedEntry}>{sv.entryClassSelectLinked}</button>
      </div>}
      {focusedEntryId && <div className="entry-class-focus">
        <p>{sv.entryClassFocused}</p>
        <button type="button" className="secondary" disabled={busy || !!attempt} onClick={showAllEntries}>{sv.entryClassShowAll}</button>
      </div>}
      <div className="entry-class-list">
        {data.entries.filter((entry) => !focusedEntryId || entry.id === focusedEntryId).map((entry) => {
          const currentClass = data.classes.find((raceClass) => raceClass.id === entry.classId);
          const selectedClass = selectedClasses[entry.id] ?? entry.classId;
          return <article className="entry-class-entry" key={`${entry.id}:${entry.version}`}>
            <div><h3>{entry.displayName}</h3><p>{entry.organisationName ?? "–"}</p>
              <p>{sv.entryClassCurrentClass}: <strong>{currentClass?.name}</strong> · {sv.entryClassVersion}: {entry.version}</p></div>
            <label>{sv.entryClassNewClass}
              <select value={selectedClass} disabled={busy || attempt !== undefined}
                onChange={(event) => setSelectedClasses((current) => ({ ...current, [entry.id]: event.target.value }))}>
                {data.classes.map((raceClass) => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy || attempt !== undefined || selectedClass === entry.classId}
              onClick={() => void beginChange(entry.id)}>{sv.entryClassChangeButton}</button>
          </article>;
        })}
        {data.entries.length === 0 && <p className="muted">{sv.entryClassNoEntries}</p>}
        {focusedEntryId && !data.entries.some((entry) => entry.id === focusedEntryId) && <p>{sv.entryClassFocusedMissing}</p>}
      </div>
    </section>}

    {attempt !== undefined && <section className="panel entry-class-retry stack" role="alert" aria-labelledby="entry-class-retry-heading">
      <h2 id="entry-class-retry-heading">△ {sv.entryClassUnknownCommit}</h2>
      <p>{sv.entryClassUnknownCommitHelp}</p>
      <dl><dt>{sv.entryClassPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.entryClassPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd>
        <dt>{sv.entryClassPendingVersion}</dt><dd>{attempt.expectedEntryVersion}</dd></dl>
      <div className="pairing-actions">
        {authenticated === true && <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.entryClassRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy} onClick={clearAttempt}>{sv.entryClassClearAttempt}</button>
      </div>
    </section>}

    {lastResult !== undefined && <section className="panel entry-class-result" aria-label={sv.entryClassChanged}>
      <p><strong>✓ {lastResult.replayed ? sv.entryClassReplayRecovered : sv.entryClassChanged}</strong></p>
    </section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
