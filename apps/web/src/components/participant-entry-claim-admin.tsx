"use client";

import { useCallback, useEffect, useState } from "react";
import {
  participantClaimIssueRequestSchema, participantClaimIssueResponseSchema,
  participantClaimListResponseSchema, participantClaimRevokeRequestSchema,
  participantClaimRevokeResponseSchema, type ParticipantClaimListResponse
} from "@o-tid/contracts";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import { createParticipantClaimMaterial } from "../lib/participant-claim-code";
import { participantClaimSv as text } from "../i18n/participant-claim-sv";

type IssueAttempt = { request: ReturnType<typeof participantClaimIssueRequestSchema.parse>; code: string };
type RevokeAttempt = { request: ReturnType<typeof participantClaimRevokeRequestSchema.parse>; key: string };
async function responseJson(response: Response): Promise<unknown> { try { return await response.json(); } catch { return undefined; } }

export function ParticipantEntryClaimAdmin({ raceId, entryId, displayName, onPendingChange }: {
  raceId: string; entryId: string; displayName: string; onPendingChange?: (pending: boolean) => void;
}) {
  const url = `/api/admin/races/${raceId}/entries/${entryId}/participant-claims`;
  const [history, setHistory] = useState<ParticipantClaimListResponse>();
  const [attested, setAttested] = useState(false);
  const [attempt, setAttempt] = useState<IssueAttempt>();
  const [revocation, setRevocation] = useState<RevokeAttempt>();
  const [shownCode, setShownCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) throw new Error(text.unavailable);
    const parsed = participantClaimListResponseSchema.safeParse(await responseJson(response));
    if (!response.ok || !parsed.success || parsed.data.raceId !== raceId || parsed.data.entryId !== entryId) throw new Error(text.loadError);
    setHistory(parsed.data);
  }, [entryId, raceId, url]);
  useEffect(() => { void load().catch(error => setMessage(error instanceof Error ? error.message : text.loadError)); }, [load]);
  useEffect(() => { onPendingChange?.(busy || Boolean(attempt) || Boolean(revocation) || Boolean(shownCode)); },
    [attempt, busy, onPendingChange, revocation, shownCode]);

  function csrf(): string {
    const value = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
    if (!value) throw new Error(text.unavailable);
    return value;
  }
  async function issue(current: IssueAttempt) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: {
        "content-type": "application/json", "x-otid-csrf": csrf(),
        "idempotency-key": `participant-claim-issue:${current.request.requestId}`
      }, body: JSON.stringify(current.request) });
      if (response.status === 409) { setAttempt(undefined); setShownCode(""); setAttested(false); setMessage(text.conflict); await load(); return; }
      const parsed = participantClaimIssueResponseSchema.safeParse(await responseJson(response));
      if (!response.ok || !parsed.success || parsed.data.raceId !== raceId || parsed.data.entryId !== entryId || parsed.data.requestId !== current.request.requestId) {
        throw new Error(response.status === 401 || response.status === 403 ? text.unavailable : text.saveError);
      }
      setAttempt(undefined); setShownCode(current.code); setMessage(text.issued); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : text.saveError); }
    finally { setBusy(false); }
  }
  async function createIssue() {
    if (busy || !attested) return;
    try {
      const material = await createParticipantClaimMaterial();
      const requestId = crypto.randomUUID();
      const request = participantClaimIssueRequestSchema.parse({ formatVersion: 1, requestId, raceId, entryId,
        secretHash: material.secretHash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), attestation: "IDENTITY_CHECKED" });
      const current = { request, code: material.code };
      setAttempt(current); setShownCode(""); await issue(current);
    } catch { setMessage(text.saveError); }
  }
  async function revoke(current: RevokeAttempt) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${url}/${current.request.claimId}/revoke`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: {
        "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": current.key
      }, body: JSON.stringify(current.request) });
      const parsed = participantClaimRevokeResponseSchema.safeParse(await responseJson(response));
      if (!response.ok || !parsed.success || parsed.data.claimId !== current.request.claimId || parsed.data.requestId !== current.request.requestId) {
        throw new Error(response.status === 401 || response.status === 403 ? text.unavailable : text.saveError);
      }
      setRevocation(undefined); setMessage(text.revokedNotice); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : text.saveError); }
    finally { setBusy(false); }
  }
  function startRevoke(claimId: string) {
    const reason = window.prompt(text.revokePrompt)?.trim();
    if (!reason) return;
    const requestId = crypto.randomUUID();
    const request = participantClaimRevokeRequestSchema.parse({ formatVersion: 1, requestId, raceId, entryId, claimId, reason });
    const current = { request, key: `participant-claim-revoke:${requestId}` };
    setRevocation(current); void revoke(current);
  }
  const activeClaim = history?.claims.some(claim => !claim.revokedAt && (claim.redeemedAt !== null || Date.parse(claim.expiresAt) > Date.now()));
  return <section className="participant-claim-admin panel stack" aria-label={text.title}>
    <h3>{text.title}</h3><p>{text.help}</p><p>{displayName}</p>
    {!shownCode && <><label className="participant-claim-attestation"><input type="checkbox" checked={attested} disabled={busy || Boolean(attempt)} onChange={event => setAttested(event.target.checked)} />{text.attestation}</label>
      {activeClaim && <p className="warning">{text.conflict}</p>}
      <button type="button" disabled={busy || !attested || Boolean(activeClaim)} onClick={() => attempt ? void issue(attempt) : void createIssue()}>{attempt ? text.retry : busy ? text.issuing : text.issue}</button></>}
    {shownCode && <section className="panel stack" aria-live="polite"><h4>{text.codeTitle}</h4><p className="warning">{text.codeHelp}</p><output>{shownCode}</output>
      <div className="pairing-actions"><button type="button" onClick={() => { void navigator.clipboard.writeText(shownCode).then(() => setMessage(text.copied)).catch(() => setMessage(text.saveError)); }}>{text.copy}</button>
        <button type="button" className="secondary" onClick={() => setShownCode("")}>{text.clear}</button></div></section>}
    <div className="participant-claim-history"><h4>{text.history}</h4>{!history?.claims.length ? <p className="muted">{text.noClaims}</p> : history.claims.map(claim => {
      const active = !claim.revokedAt && !claim.redeemedAt && Date.parse(claim.expiresAt) > Date.now();
      const label = claim.revokedAt ? text.revoked : claim.redeemedAt ? text.redeemed : active ? text.active : text.expired;
      return <article key={claim.claimId}><div><strong>{label}</strong><span>{text.expires}: {new Date(claim.expiresAt).toLocaleString("sv-SE")}</span></div>
        {(active || claim.redeemedAt !== null && claim.revokedAt === null) && <button type="button" className="secondary danger"
          disabled={busy || Boolean(revocation && revocation.request.claimId !== claim.claimId)}
          onClick={() => revocation?.request.claimId === claim.claimId ? void revoke(revocation) : startRevoke(claim.claimId)}>{revocation?.request.claimId === claim.claimId ? text.revokeAgain : text.revoke}</button>}</article>;
    })}</div>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
