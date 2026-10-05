"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  organizerAccountLoginRequestSchema, organizerAccountLoginResponseSchema,
  organizerAccountSessionStatusSchema, participantClaimRedeemRequestSchema,
  participantClaimRedeemResponseSchema, participantOwnResultsResponseSchema,
  publicResultFollowIdempotencyKey, publicResultFollowListResponseSchema,
  publicResultFollowSetRequestSchema, publicResultFollowSetResponseSchema
} from "@o-tid/contracts";
import { readOrganizerCsrf } from "../lib/organizer-client";
import { participantClaimRedeemIdempotencyKeySchema } from "@o-tid/contracts";
import { participantMeSv as text } from "../i18n/participant-claim-sv";

type Session = { displayName: string };
async function json(response: Response): Promise<unknown> { try { return await response.json(); } catch { return undefined; } }
function errorText(error: unknown) { return error instanceof Error ? error.message : text.loadError; }

export function ParticipantMe() {
  const [session, setSession] = useState<Session>();
  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingRedeem, setPendingRedeem] = useState<{ requestId: string; code: string }>();
  const [data, setData] = useState<ReturnType<typeof participantOwnResultsResponseSchema.parse>>();
  const [follows, setFollows] = useState<ReturnType<typeof publicResultFollowListResponseSchema.parse>["items"]>([]);
  const [pendingUnfollow, setPendingUnfollow] = useState<{ request: ReturnType<typeof publicResultFollowSetRequestSchema.parse>; key: string }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadResults = useCallback(async () => {
    const response = await fetch("/api/participant/me/results", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) { setSession(undefined); setData(undefined); throw new Error(text.sessionError); }
    const parsed = participantOwnResultsResponseSchema.safeParse(await json(response));
    if (!response.ok || !parsed.success) throw new Error(text.loadError);
    setData(parsed.data);
  }, []);
  const loadFollows = useCallback(async () => {
    const response = await fetch("/api/participant/me/follows", { credentials: "same-origin", cache: "no-store" });
    const parsed = publicResultFollowListResponseSchema.safeParse(await json(response));
    if (!response.ok || !parsed.success) throw new Error(text.followsLoadError);
    setFollows(parsed.data.items);
  }, []);
  const checkSession = useCallback(async () => {
    setChecked(false);
    try {
      const response = await fetch("/api/organizer/session", { credentials: "same-origin", cache: "no-store" });
      const parsed = organizerAccountSessionStatusSchema.safeParse(await json(response));
      if (!response.ok || !parsed.success) { setSession(undefined); setData(undefined); return; }
      setSession({ displayName: parsed.data.displayName });
      await Promise.all([loadResults(), loadFollows()]);
    } catch (error) { setMessage(errorText(error)); }
    finally { setChecked(true); }
  }, [loadResults, loadFollows]);
  useEffect(() => { void checkSession(); }, [checkSession]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const request = organizerAccountLoginRequestSchema.parse({ formatVersion: 1, email, password });
      const response = await fetch("/api/organizer/login", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      const parsed = organizerAccountLoginResponseSchema.safeParse(await json(response));
      if (!response.ok || !parsed.success) throw new Error(text.sessionError);
      setPassword(""); setPendingRedeem(undefined); setSession({ displayName: parsed.data.displayName }); await Promise.all([loadResults(), loadFollows()]);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); setChecked(true); }
  }
  async function redeem(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage("");
    try {
      const enteredCode = code.trim();
      const requestId = pendingRedeem?.code === enteredCode ? pendingRedeem.requestId : crypto.randomUUID();
      const request = participantClaimRedeemRequestSchema.parse({ formatVersion: 1, requestId, code: enteredCode });
      setPendingRedeem({ requestId, code: enteredCode });
      const key = `participant-claim-redeem:${requestId}`;
      participantClaimRedeemIdempotencyKeySchema.parse(key);
      const response = await fetch("/api/participant/me/claims", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href)), "idempotency-key": key },
        body: JSON.stringify(request) });
      const parsed = participantClaimRedeemResponseSchema.safeParse(await json(response));
      if (!response.ok || !parsed.success || parsed.data.requestId !== requestId) {
        if (response.status === 401 || response.status === 403) { setSession(undefined); setData(undefined); throw new Error(text.sessionError); }
        throw new Error(text.invalidCode);
      }
      setPendingRedeem(undefined); setCode(""); setMessage(text.redeemed); await loadResults();
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setMessage(""); setData(undefined);
    try {
      const response = await fetch("/api/organizer/logout", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href)) } });
      if (!response.ok && response.status !== 401) throw new Error(text.logoutError);
      setSession(undefined); setPendingRedeem(undefined); setPendingUnfollow(undefined); setFollows([]); setCode(""); setEmail(""); setMessage("");
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }
  async function unfollow(attempt = pendingUnfollow) {
    if (!attempt || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/participant/me/follows", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href)), "idempotency-key": attempt.key },
        body: JSON.stringify(attempt.request) });
      const parsed = publicResultFollowSetResponseSchema.safeParse(await json(response));
      if (!response.ok || !parsed.success || parsed.data.requestId !== attempt.request.requestId ||
        parsed.data.raceId !== attempt.request.raceId || parsed.data.publicResultId !== attempt.request.publicResultId ||
        parsed.data.followed !== false) throw new Error(text.followSaveError);
      setFollows(current => current.filter(item => item.raceId !== attempt.request.raceId || item.publicResultId !== attempt.request.publicResultId));
      setPendingUnfollow(undefined);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }
  function beginUnfollow(raceId: string, publicResultId: string) {
    const request = publicResultFollowSetRequestSchema.parse({ formatVersion: 1, requestId: crypto.randomUUID(), raceId, publicResultId, followed: false });
    const attempt = { request, key: publicResultFollowIdempotencyKey(request.requestId) };
    setPendingUnfollow(attempt);
    void unfollow(attempt);
  }

  return <main className="participant-me" aria-labelledby="participant-me-title">
    <h1 id="participant-me-title">{text.title}</h1>
    {!checked && <p aria-live="polite">{text.loading}</p>}
    {checked && !session && <form className="panel stack" onSubmit={event => void login(event)}>
      <h2>{text.login}</h2>
      <label>{text.email}<input type="email" autoCapitalize="none" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} /></label>
      <label>{text.password}<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /></label>
      <button disabled={busy}>{busy ? text.loggingIn : text.loginAction}</button>
      <Link href="/recover">{text.forgotPassword}</Link>
      <p className="muted">{text.accountHelp}</p>
    </form>}
    {session && <>
      <p>{text.loggedInAs} <strong>{session.displayName}</strong></p>
      <button type="button" className="secondary" onClick={() => void logout()} disabled={busy}>{text.logout}</button>
      <form className="panel stack" onSubmit={event => void redeem(event)}>
        <label>{text.code}<input inputMode="text" autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} maxLength={22} value={code}
          onChange={event => setCode(event.target.value.replace(/\s/g, ""))} disabled={busy} required /></label>
        <button disabled={busy || code.length !== 22}>{busy ? text.redeeming : text.redeem}</button>
      </form>
      {data && data.items.length === 0 && <p className="muted">{text.empty}</p>}
      {data?.items.map((item, index) => <article key={`${item.raceId}:${index}`}>
        <h2>{item.eventName}</h2><p>{text.race}: {item.raceName}</p>
        {item.result === null ? <p className="warning">{text.waiting}</p> : <>
          <p><strong>{item.result.givenName} {item.result.familyName}</strong> · {item.result.className} · {item.result.status}</p>
          <Link className="public-result-route-summary-link" href={`/results/${item.raceId}/participants/${item.result.publicResultId}`}>{text.openResult}</Link>
        </>}
      </article>)}
      <section className="participant-followed-results" aria-labelledby="participant-followed-results-title">
        <h2 id="participant-followed-results-title">{text.followedTitle}</h2>
        {follows.length === 0 ? <p className="muted">{text.followedEmpty}</p> : follows.map(item => <article key={`${item.raceId}:${item.publicResultId}`}>
          <h3>{item.eventName}</h3><p>{text.race}: {item.raceName}</p>
          {item.result === null ? <p className="warning">{text.followedUnavailable}</p> : <p><strong>{item.result.givenName} {item.result.familyName}</strong> · {item.result.className} · {item.result.status}</p>}
          {item.result && <Link className="public-result-route-summary-link" href={`/results/${item.raceId}/participants/${item.publicResultId}`}>{text.openResult}</Link>}
          <button type="button" className="secondary" disabled={busy || pendingUnfollow !== undefined} onClick={() => void beginUnfollow(item.raceId, item.publicResultId)}>{text.unfollow}</button>
        </article>)}
        {pendingUnfollow && <button type="button" className="secondary" disabled={busy} onClick={() => void unfollow()}>{text.retryFollow}</button>}
      </section>
      <p className="muted">{text.contact}</p>
    </>}
    <p role="status" aria-live="polite">{message}</p>
  </main>;
}
