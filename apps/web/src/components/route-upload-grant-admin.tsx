"use client";

import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  entryClassAdminListResponseSchema, routeUploadGrantIssueResponseSchema,
  routeUploadGrantListResponseSchema, routeUploadGrantRevokeResponseSchema,
  type EntryClassAdminListResponse, type RouteUploadGrantMetadata
} from "@o-tid/contracts";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import {
  clearRouteUploadGrantMaterial, createRouteUploadGrantMaterial, routeUploadGrantLifetimes,
  routeUploadGrantLink, type RouteUploadGrantLifetimeDays, type RouteUploadGrantMaterial
} from "../lib/route-upload-grant-client";
import { routeUploadGrantSv as text } from "../i18n/route-upload-grant-sv";

type PendingRevocation = { grant: RouteUploadGrantMetadata; reason: string; idempotencyKey: string };

function csrf(): string | undefined {
  return typeof document === "undefined" || typeof window === "undefined" ? undefined : readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
}
async function responseJson(response: Response): Promise<unknown> { try { return await response.json(); } catch { return undefined; } }
function messageFor(response: Response): string { return response.status === 401 || response.status === 403 ? text.unavailable : text.issueError; }

export function RouteUploadGrantAdmin({ raceId }: { raceId: string }) {
  const base = `/api/admin/races/${raceId}/route-upload/grants`;
  const participantsUrl = `/api/admin/races/${raceId}/administrator/participants`;
  const [participants, setParticipants] = useState<EntryClassAdminListResponse>();
  const [grants, setGrants] = useState<RouteUploadGrantMetadata[]>([]);
  const [entryId, setEntryId] = useState("");
  const [lifetime, setLifetime] = useState<RouteUploadGrantLifetimeDays>(7);
  const [pendingIssue, setPendingIssue] = useState<RouteUploadGrantMaterial>();
  const [pendingRevocation, setPendingRevocation] = useState<PendingRevocation>();
  const [issuedLink, setIssuedLink] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [participantResponse, grantResponse] = await Promise.all([fetch(participantsUrl, { credentials: "same-origin", cache: "no-store" }), fetch(base, { credentials: "same-origin", cache: "no-store" })]);
    if (participantResponse.status === 401 || participantResponse.status === 403 || grantResponse.status === 401 || grantResponse.status === 403) throw new Error(text.unavailable);
    const participantList = entryClassAdminListResponseSchema.safeParse(await responseJson(participantResponse));
    const grantList = routeUploadGrantListResponseSchema.safeParse(await responseJson(grantResponse));
    if (!participantResponse.ok || !grantResponse.ok || !participantList.success || !grantList.success || participantList.data.raceId !== raceId || grantList.data.raceId !== raceId) throw new Error(text.loadError);
    setParticipants(participantList.data); setGrants(grantList.data.grants);
    setEntryId(current => current && participantList.data.entries.some(entry => entry.id === current) ? current : (participantList.data.entries[0]?.id ?? ""));
  }, [base, participantsUrl, raceId]);

  useEffect(() => { void load().catch(error => setMessage(error instanceof Error ? error.message : text.loadError)); }, [load]);

  async function issue(material: RouteUploadGrantMaterial) {
    const csrfToken = csrf(); if (!csrfToken) { setMessage(text.unavailable); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(base, { method: "POST", credentials: "same-origin", cache: "no-store", headers: {
        "content-type": "application/json", "x-otid-csrf": csrfToken, "idempotency-key": `route-upload-grant:${material.grantId}`
      }, body: JSON.stringify({ formatVersion: 1, grantId: material.grantId, entryId: material.entryId, secretHash: material.secretHash, expiresAt: material.expiresAt }) });
      if (response.status === 409) { clearRouteUploadGrantMaterial(material); setPendingIssue(undefined); setMessage(text.conflict); await load(); return; }
      const parsed = routeUploadGrantIssueResponseSchema.safeParse(await responseJson(response));
      if (!response.ok || !parsed.success || parsed.data.raceId !== raceId || parsed.data.grantId !== material.grantId) throw new Error(messageFor(response));
      const link = routeUploadGrantLink(material, window.location.origin);
      clearRouteUploadGrantMaterial(material); setPendingIssue(undefined); setIssuedLink(link); setMessage(text.issued); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : text.issueError); } finally { setBusy(false); }
  }

  async function submitIssue(event: FormEvent) {
    event.preventDefault(); if (!entryId || busy) return;
    setIssuedLink(undefined);
    try { const material = pendingIssue ?? await createRouteUploadGrantMaterial(entryId, lifetime); setPendingIssue(material); await issue(material); }
    catch { setMessage(text.issueError); }
  }

  async function revoke(attempt: PendingRevocation) {
    const csrfToken = csrf(); if (!csrfToken) { setMessage(text.unavailable); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${base}/${attempt.grant.grantId}/revoke`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: {
        "content-type": "application/json", "x-otid-csrf": csrfToken, "idempotency-key": attempt.idempotencyKey
      }, body: JSON.stringify({ formatVersion: 1, grantId: attempt.grant.grantId, reason: attempt.reason }) });
      const parsed = routeUploadGrantRevokeResponseSchema.safeParse(await responseJson(response));
      if (!response.ok || !parsed.success || parsed.data.grantId !== attempt.grant.grantId) throw new Error(response.status === 401 || response.status === 403 ? text.unavailable : text.revokeError);
      setPendingRevocation(undefined); setMessage(text.revokedMessage); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : text.revokeError); } finally { setBusy(false); }
  }

  function startRevoke(grant: RouteUploadGrantMetadata) {
    const reason = window.prompt(text.revokePrompt)?.trim();
    if (!reason) return;
    const attempt = { grant, reason, idempotencyKey: `route-upload-grant-revoke:${crypto.randomUUID()}` };
    setPendingRevocation(attempt); void revoke(attempt);
  }

  async function copyLink() { if (!issuedLink) return; try { await navigator.clipboard.writeText(issuedLink); setMessage(text.copied); } catch { setMessage(text.issueError); } }
  function clearLink() { setIssuedLink(undefined); setMessage(text.cleared); }
  const names = new Map(participants?.entries.map(entry => [entry.id, entry]));
  const now = Date.now();

  return <section className="route-upload-grant-admin stack">
    <p>{text.intro}</p><p role="status" aria-live="polite">{message}</p>
    <form className="panel stack" onSubmit={(event) => void submitIssue(event)}>
      <label>{text.entry}<select value={entryId} disabled={busy || Boolean(pendingIssue)} onChange={event => setEntryId(event.target.value)} required>
        {participants?.entries.length ? participants.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.displayName} · {entry.organisationName ?? "–"}</option>) : <option value="">{text.chooseEntry}</option>}
      </select></label>
      <label>{text.lifetime}<select value={lifetime} disabled={busy || Boolean(pendingIssue)} onChange={event => setLifetime(Number(event.target.value) as RouteUploadGrantLifetimeDays)}>
        {routeUploadGrantLifetimes.map(days => <option key={days} value={days}>{days === 1 ? text.day : days === 7 ? text.week : text.month}</option>)}
      </select></label>
      <button disabled={busy || !entryId} aria-busy={busy}>{pendingIssue ? text.retryIssue : text.issue}</button>
    </form>
    {issuedLink && <section className="panel route-upload-grant-link stack"><h2>{text.linkTitle}</h2><p className="warning">{text.linkWarning}</p><output>{issuedLink}</output><div className="pairing-actions"><button type="button" onClick={() => void copyLink()}>{text.copy}</button><button type="button" className="secondary" onClick={clearLink}>{text.clear}</button></div></section>}
    <section className="panel stack"><div className="pairing-list-heading"><h2>{text.grants}</h2><button type="button" className="secondary" disabled={busy} onClick={() => void load().catch(() => setMessage(text.loadError))}>{text.refresh}</button></div>
      {grants.length === 0 && <p className="muted">{text.none}</p>}
      <div className="pairing-grant-list">{grants.map(grant => {
        const person = names.get(grant.entryId); const active = grant.revokedAt === null && Date.parse(grant.expiresAt) > now;
        return <article key={grant.grantId} className="pairing-grant"><div><strong className={active ? "pairing-active" : grant.revokedAt ? "pairing-revoked" : "pairing-expired"}>{active ? text.active : grant.revokedAt ? text.revoked : text.expired}</strong>
          <span>{person?.displayName ?? text.chooseEntry}</span><span>{text.expires}: {new Date(grant.expiresAt).toLocaleString("sv-SE")}</span></div>
          {active && <button type="button" className="secondary danger" disabled={busy} onClick={() => pendingRevocation?.grant.grantId === grant.grantId ? void revoke(pendingRevocation) : startRevoke(grant)}>{pendingRevocation?.grant.grantId === grant.grantId ? text.retryRevoke : text.revoke}</button>}
        </article>;
      })}</div>
    </section>
  </section>;
}
