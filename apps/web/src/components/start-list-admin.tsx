"use client";

import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { startListAdminListResponseSchema, startListAdminLoginRequestSchema,
  startListAdminLoginResponseSchema, type StartListAdminListResponse } from "@o-tid/contracts";
import { readStartListAdminCsrfCookie } from "../lib/start-list-admin-cookies";
import { formatStartListTime } from "../lib/start-list-time";
import { filterStartListClasses } from "../lib/start-list-filter";
import { startListSv as text } from "../i18n/start-list-sv";
import { checkinText } from "../checkin/text-sv";
import { offerEntryNavigation, type EntryNavigationDestination } from "../lib/entry-navigation";

export function StartListAdmin({ raceId }: { raceId: string }) {
  const router = useRouter();
  const [credential, setCredential] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<StartListAdminListResponse>();
  const [classId, setClassId] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState<string>(text.checking);
  const sessionUrl = `/api/admin/races/${raceId}/start-list-session`;
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/races/${raceId}/start-list`, {
        cache: "no-store", credentials: "same-origin", ...(signal ? { signal } : {}) });
      if (signal?.aborted) return;
      if (response.status === 401 || response.status === 403) {
        setQuery(""); setClassId("");
        setAuthenticated(false); setData(undefined); setStale(false); setMessage(text.denied); return;
      }
      if (!response.ok) throw new Error(text.loadError);
      const parsed = startListAdminListResponseSchema.parse(await response.json());
      if (parsed.raceId !== raceId) throw new Error(text.loadError);
      if (signal?.aborted) return;
      setData(parsed); setAuthenticated(true); setStale(false); setMessage("");
      setClassId((previous) => parsed.classes.some((row) => row.id === previous) ? previous : "");
    } catch {
      if (!signal?.aborted) { setStale(true); setMessage(text.loadError); }
    } finally { if (!signal?.aborted) setBusy(false); }
  }, [raceId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const body = startListAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential: credential });
      const response = await fetch(sessionUrl, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(text.denied);
      const value = startListAdminLoginResponseSchema.parse(await response.json());
      if (value.raceId !== raceId) throw new Error(text.denied);
      setAuthenticated(true); await load();
    } catch { setAuthenticated(false); setData(undefined); setQuery(""); setClassId(""); setMessage(text.denied); }
    finally { setCredential(""); setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    // Remove the private list even if the network cannot confirm revocation.
    setData(undefined); setStale(false); setQuery(""); setClassId("");
    try {
      const csrf = readStartListAdminCsrfCookie(document.cookie, new URL(window.location.href));
      if (!csrf) throw new Error(text.denied);
      const response = await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin", headers: { "x-otid-csrf": csrf } });
      if (!response.ok && response.status !== 401) throw new Error(text.logoutError);
      setAuthenticated(false); setMessage(text.denied);
    } catch { setMessage(text.logoutError); } finally { setBusy(false); }
  }
  const visible = filterStartListClasses(data?.classes ?? [], classId, query);
  const visibleCount = visible.reduce((total, row) => total + row.entries.length, 0);
  const totalCount = data?.classes.reduce((total, row) => total + row.entries.length, 0) ?? 0;
  function printSelection() {
    if (authenticated && data && visibleCount > 0 && !busy) window.print();
  }
  function openCorrection(entryId: string, destination: EntryNavigationDestination) {
    if (!authenticated || !data || busy || stale) return;
    const raceClass = data.classes.find((row) => row.entries.some((entry) => entry.id === entryId));
    if (!raceClass || (destination === "start-times" && raceClass.startRule !== "FIXED")) return;
    offerEntryNavigation({ raceId, entryId, destination });
    router.push(`/admin/${raceId}/${destination}`);
  }
  return <div className="stack start-list-admin">
    <p>{text.help}</p>
    {!authenticated && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <label>{text.credential}<input type="password" autoComplete="off" spellCheck={false} value={credential}
        onChange={(event) => setCredential(event.target.value)} required /></label>
      <button disabled={busy}>{text.login}</button>
    </form>}
    {authenticated && <section className="panel stack start-list-controls">
      <div className="start-list-toolbar">
      <a href={`/checkin/index.html#${raceId}`}>{checkinText.openMobile}</a>
      <button disabled={busy} onClick={() => void load()}>{text.refresh}</button>
      {data && visibleCount > 0 && <button type="button" className="secondary" disabled={busy}
        onClick={printSelection}>{text.print}</button>}
      <button className="secondary" disabled={busy} onClick={() => void logout()}>{text.logout}</button>
      </div>
      {data && <>
        <p className="start-list-print-notice">{text.printPrivacy}</p>
        <div className="start-list-metadata">
        <p>{text.version}: {data.snapshotVersion} · {text.timeZone}: {data.timeZone}</p>
        <p>{text.fetched}: {formatStartListTime(data.generatedAt, data.timeZone)}</p>
        </div>
        <div className="start-list-filters">
        <label>{text.search}<input type="search" value={query} autoComplete="off" spellCheck={false}
          onChange={(event) => setQuery(event.target.value)} /></label>
        <label>{text.raceClass}<select value={classId} disabled={busy} onChange={(event) => setClassId(event.target.value)}>
          <option value="">{text.allClasses}</option>{data.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <button type="button" className="secondary" disabled={!query && !classId}
          onClick={() => { setQuery(""); setClassId(""); }}>{text.clearFilters}</button>
        </div>
      </>}
    </section>}
    <p role="status" aria-live="polite">{message}</p>
    {data && stale && <p className="warning" role="alert">{text.stale}</p>}
    {data && <>
      <section className="start-list-print-context" aria-label={text.printHeading}>
        <h2>{text.printHeading}</h2>
        <p>{text.raceId}: {raceId}</p>
        <p>{text.version}: {data.snapshotVersion} · {text.timeZone}: {data.timeZone}</p>
        <p>{text.fetched}: {formatStartListTime(data.generatedAt, data.timeZone)}</p>
        <p>{text.raceClass}: {data.classes.find((row) => row.id === classId)?.name ?? text.allClasses}</p>
        <p>{text.searchFilter}: {query.trim() || text.noSearch}</p>
        <p>{text.shown} {visibleCount} {text.of} {totalCount} {text.count.toLocaleLowerCase("sv-SE")}</p>
        <p>{text.printPrivacy}</p>
      </section>
      <p className="start-list-count" aria-live="polite">{text.shown} {visibleCount} {text.of} {totalCount} {text.count.toLocaleLowerCase("sv-SE")}</p>
      {visibleCount === 0 ? <p>{text.empty}</p> : <table className="start-list-table">
        <caption>{text.listCaption}</caption>
        <thead><tr>
          <th scope="col">{text.raceClass}</th><th scope="col">{text.plannedStart}</th>
          <th scope="col">{text.nameAndOrganisation}</th><th scope="col">{text.card}</th>
        </tr></thead>
        <tbody>{visible.flatMap((raceClass) => raceClass.entries.map((entry) => <tr key={entry.id}>
          <td data-label={text.raceClass}>{raceClass.name}</td>
          <td data-label={text.plannedStart} className={raceClass.startRule === "FIXED" && !entry.fixedStartTime ? "start-list-data-warning" : undefined}>
            {raceClass.startRule === "PUNCH" ? text.punch : entry.fixedStartTime
              ? formatStartListTime(entry.fixedStartTime, data.timeZone) : text.missingTime}
          </td>
          <th scope="row" data-label={text.nameAndOrganisation}>
            <span className="start-list-name">{entry.displayName}</span>
            <span className="start-list-organisation">{entry.organisationName ?? text.noOrganisation}</span>
            {authenticated && !busy && !stale && <details className="start-list-corrections">
              <summary>{text.correct}</summary>
              <button type="button" className="secondary" onClick={() => openCorrection(entry.id, "entry-identity")}>{text.changeIdentity}</button>
              <div><button type="button" className="secondary" onClick={() => openCorrection(entry.id, "cards")}>{text.changeCard}</button>
              <button type="button" className="secondary" onClick={() => openCorrection(entry.id, "classes")}>{text.changeClass}</button>
              <button type="button" className="secondary" onClick={() => openCorrection(entry.id, "history")}>{text.readoutHistory}</button>
              {raceClass.startRule === "FIXED" && <button type="button" className="secondary"
                onClick={() => openCorrection(entry.id, "start-times")}>{text.changeStartTime}</button>}</div>
            </details>}
          </th>
          <td data-label={text.card} className={entry.multipleActiveAssignments || entry.cardNumber === null ? "start-list-data-warning" : undefined}>
            {entry.multipleActiveAssignments ? text.multipleCards : entry.cardNumber ?? text.noCard}
          </td>
        </tr>))}</tbody>
      </table>}
    </>}
  </div>;
}
