"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  entryRegistrationClassesResponseSchema, entryRegistrationAdminLoginRequestSchema,
  entryRegistrationAdminLoginResponseSchema, entryRegistrationRequestSchema,
  entryRegistrationResponseSchema, entryRegistrationStartSlotCandidatesSchema, type EntryRegistrationClassesResponse,
  type EntryRegistrationStartSlotCandidates,
  type EntryRegistrationRequest
} from "@o-tid/contracts";
import { readEntryRegistrationAdminCsrfCookie } from "../lib/entry-registration-admin-cookies";
import { formatStartListTime } from "../lib/start-list-time";
import { registrationSv as text } from "../i18n/entry-registration-sv";

type Attempt = { id: string; className: string; timeZone: string; request: EntryRegistrationRequest };

export function EntryRegistrationAdmin({ raceId }: { raceId: string }) {
  const [credential, setCredential] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<EntryRegistrationClassesResponse>();
  const [classId, setClassId] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [newCard, setNewCard] = useState("");
  const [fixedStartTime, setFixedStartTime] = useState("");
  const [startSlots, setStartSlots] = useState<EntryRegistrationStartSlotCandidates>();
  const [slotLoadFailed, setSlotLoadFailed] = useState(false);
  const [selectedStartSlot, setSelectedStartSlot] = useState("");
  const [useLottedStartSlot, setUseLottedStartSlot] = useState(false);
  const slotLoadGeneration = useRef(0);
  const [attempt, setAttempt] = useState<Attempt>();
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(text.checking);
  const [saved, setSaved] = useState(false);
  const selected = data?.classes.find((row) => row.id === classId);
  const verifiedStartSlots = data && selected && startSlots?.raceId === raceId &&
    startSlots.targetClassId === selected.id && startSlots.snapshotVersion === data.snapshotVersion &&
    startSlots.targetCourseVersionId === selected.courseVersionId && startSlots.timeZone === data.timeZone
    ? startSlots : undefined;
  const sessionUrl = `/api/admin/races/${raceId}/entry-registration-session`;
  const load = useCallback(async () => {
    slotLoadGeneration.current++;
    setStartSlots(undefined); setSelectedStartSlot(""); setUseLottedStartSlot(false); setSlotLoadFailed(false);
    const response = await fetch(`/api/admin/races/${raceId}/entry-registration-classes`, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false); setData(undefined); setMessage(text.denied); return;
    }
    if (!response.ok) throw new Error(text.loadError);
    const parsed = entryRegistrationClassesResponseSchema.parse(await response.json());
    if (parsed.raceId !== raceId) throw new Error(text.loadError);
    setData(parsed); setAuthenticated(true); setMessage("");
  }, [raceId]);
  useEffect(() => { void load().catch(() => setMessage(text.loadError)); }, [load]);
  async function loadStartSlots(targetClassId: string) {
    const generation = ++slotLoadGeneration.current;
    setStartSlots(undefined); setSelectedStartSlot(""); setUseLottedStartSlot(false); setSlotLoadFailed(false);
    const raceClass = data?.classes.find((row) => row.id === targetClassId);
    if (!raceClass || raceClass.startRule !== "FIXED") return;
    try {
      const response = await fetch(`/api/admin/races/${raceId}/entry-registration-start-slot-candidates/${targetClassId}`, {
        cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("slot read");
      const value = entryRegistrationStartSlotCandidatesSchema.parse(await response.json());
      if (value.raceId !== raceId || value.targetClassId !== targetClassId || value.snapshotVersion !== data?.snapshotVersion ||
        value.targetCourseVersionId !== raceClass.courseVersionId || value.timeZone !== data.timeZone) throw new Error("slot scope");
      if (generation === slotLoadGeneration.current) setStartSlots(value);
    } catch { if (generation === slotLoadGeneration.current) { setStartSlots(undefined); setSlotLoadFailed(true); } }
  }
  function csrf() {
    const token = readEntryRegistrationAdminCsrfCookie(document.cookie, new URL(window.location.href));
    if (!token) throw new Error(text.denied);
    return token;
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const body = entryRegistrationAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential: credential });
      const response = await fetch(sessionUrl, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(text.denied);
      const value = entryRegistrationAdminLoginResponseSchema.parse(await response.json());
      if (value.raceId !== raceId) throw new Error(text.denied);
      await load();
    } catch { setMessage(text.denied); } finally { setCredential(""); setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin", headers: { "x-otid-csrf": csrf() } });
      if (!response.ok && response.status !== 401) throw new Error(text.error);
      setAuthenticated(false); setData(undefined); setSaved(false); setMessage(text.denied);
      if (!attempt) { setGivenName(""); setFamilyName(""); setOrganisationName(""); setNewCard(""); setFixedStartTime(""); }
    } catch { setMessage(text.error); } finally { setBusy(false); }
  }
  function prepare(event: FormEvent) {
    event.preventDefault();
    const raceClass = selected;
    if (!data || !raceClass) return;
    if (useLottedStartSlot && (verifiedStartSlots?.plan.status !== "AVAILABLE" ||
      !verifiedStartSlots.plan.slots.some((slot) => slot.fixedStartTime === selectedStartSlot))) {
      setSlotLoadFailed(true); return;
    }
    const parsed = entryRegistrationRequestSchema.safeParse({ formatVersion: 1, classId,
      expectedCourseVersionId: raceClass.courseVersionId, expectedStartRule: raceClass.startRule,
      expectedSnapshotVersion: data.snapshotVersion, givenName, familyName,
      organisationName: organisationName.trim() || null, cardNumber: newCard.trim() || null,
      fixedStartTime: raceClass.startRule === "FIXED" ? useLottedStartSlot ? selectedStartSlot : fixedStartTime : null,
      expectedTargetCapacityVersion: useLottedStartSlot ? verifiedStartSlots?.targetCapacityVersion : undefined,
      assignedStartSlot: useLottedStartSlot && verifiedStartSlots?.plan.status === "AVAILABLE" ? {
        drawRequestId: verifiedStartSlots.plan.drawRequestId, sourceHash: verifiedStartSlots.plan.sourceHash, fixedStartTime: selectedStartSlot
      } : null });
    if (!parsed.success) { setMessage(text.invalid); return; }
    setAttempt({ id: crypto.randomUUID(), className: raceClass.name, timeZone: data.timeZone, request: parsed.data });
    setUnknown(false); setMessage("");
  }
  async function submit(current: Attempt) {
    setBusy(true);
    try {
      const response = await fetch(`/api/races/${raceId}/entries`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": `entry-registration:${current.id}`,
          "x-otid-csrf": csrf() }, body: JSON.stringify(current.request) });
      if ([400, 409].includes(response.status)) {
        // An earlier unknown response may already have committed under another actor.
        if (unknown) { setMessage(text.unknown); return; }
        setAttempt(undefined); await load().catch(() => setData(undefined));
        setMessage(response.status === 409 ? text.conflict : text.error); return;
      }
      if (response.status === 401 || response.status === 403) {
        setAuthenticated(false); setData(undefined); setUnknown(true); setMessage(text.reauth); return;
      }
      if (!response.ok) throw new Error(text.unknown);
      const result = entryRegistrationResponseSchema.parse(await response.json());
      const intent = current.request;
      if (result.requestId !== current.id || result.raceId !== raceId || result.classId !== intent.classId ||
        result.givenName !== intent.givenName || result.familyName !== intent.familyName ||
        result.organisationName !== intent.organisationName || result.cardNumber !== intent.cardNumber ||
        result.fixedStartTime !== intent.fixedStartTime || result.snapshotVersionBefore !== intent.expectedSnapshotVersion) {
        throw new Error(text.unknown);
      }
      setAttempt(undefined); setSaved(true); setUnknown(false); setMessage(text.saved);
      await load().catch(() => setData(undefined)); setMessage(text.saved);
    } catch { setUnknown(true); setMessage(text.unknown); } finally { setBusy(false); }
  }
  const disabled = busy || !!attempt;
  const messageTone = message === text.unknown ? "unknown" :
    ([text.error, text.invalid, text.conflict, text.loadError, text.reauth, text.denied] as string[]).includes(message) ? "error" : "neutral";
  return <div className="stack entry-registration-admin">
    <div className="entry-registration-intro"><p>{text.help}</p><p className="entry-registration-guidance">{text.warning}</p></div>
    {!authenticated && <form className="panel stack entry-registration-login" onSubmit={(event) => void login(event)}>
      <label>{text.credential}<input type="password" autoComplete="off" spellCheck={false}
        value={credential} onChange={(event) => setCredential(event.target.value)} required /></label>
      <button disabled={busy}>{text.login}</button>
    </form>}
    {authenticated && <section className="panel stack entry-registration-workspace">
      <div className="entry-registration-toolbar">
        <button className="secondary" disabled={disabled} onClick={() => void load().catch(() => setMessage(text.loadError))}>{text.refresh}</button>
        <button className="secondary" disabled={busy} onClick={() => void logout()}>{text.logout}</button>
      </div>
      {data && !saved && !attempt && <form className="stack entry-registration-form" onSubmit={prepare}>
        <p className="entry-registration-version">{text.version}: <strong>{data.snapshotVersion}</strong></p>
        <label>{text.raceClass}<select value={classId} disabled={disabled} required onChange={(event) => { const value = event.target.value; setClassId(value); setFixedStartTime(""); void loadStartSlots(value); }}>
          <option value="">{text.choose}</option>{data.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        {selected && <p className="entry-registration-rule">{selected.startRule === "FIXED" ? text.fixedRule : text.punchRule}</p>}
        {data.classes.length === 0 && <p>{text.empty}</p>}
        <div className="entry-registration-fields">
          <label>{text.givenName}<input value={givenName} maxLength={160} autoComplete="off" disabled={disabled} required onChange={(event) => setGivenName(event.target.value)} /></label>
          <label>{text.familyName}<input value={familyName} maxLength={160} autoComplete="off" disabled={disabled} required onChange={(event) => setFamilyName(event.target.value)} /></label>
          <label>{text.organisation}<input value={organisationName} maxLength={200} autoComplete="off" disabled={disabled} onChange={(event) => setOrganisationName(event.target.value)} /></label>
          <label>{text.card}<input value={newCard} inputMode="numeric" maxLength={32} autoComplete="off" disabled={disabled} onChange={(event) => setNewCard(event.target.value)} /></label>
        </div>
        {selected?.startRule === "FIXED" && <div className="entry-registration-start stack">
          {verifiedStartSlots?.plan.status === "AVAILABLE" && <label><input type="checkbox" checked={useLottedStartSlot} disabled={disabled}
            onChange={(event) => setUseLottedStartSlot(event.target.checked)} /> {text.useLottedSlot}</label>}
          {useLottedStartSlot && verifiedStartSlots?.plan.status === "AVAILABLE" ? <label>{text.lottedSlot}<select value={selectedStartSlot} required disabled={disabled}
            onChange={(event) => setSelectedStartSlot(event.target.value)}><option value="">{text.choose}</option>{verifiedStartSlots.plan.slots.map((slot) => <option key={slot.fixedStartTime} value={slot.fixedStartTime}>{formatStartListTime(slot.fixedStartTime, data.timeZone)}</option>)}</select></label> :
            <label>{text.startTime}<input value={fixedStartTime} placeholder={text.timeExample} autoComplete="off" disabled={disabled} required onChange={(event) => setFixedStartTime(event.target.value)} /></label>}
          {verifiedStartSlots?.plan.status === "UNAVAILABLE" && <p>{text.noLottedSlot}</p>}
          {slotLoadFailed && <p className="entry-registration-slot-warning" role="alert">{text.slotReadError}</p>}
        </div>}
        <button disabled={disabled || !selected}>{text.inspect}</button>
      </form>}
    </section>}
    {attempt && <section className="panel stack entry-registration-review" data-tone={unknown ? "unknown" : "neutral"} role="alert"><h2>{unknown ? text.unknown : text.pending}</h2>
      <p className="entry-registration-review-person">{attempt.request.givenName} {attempt.request.familyName} · {attempt.className}</p>
      <dl className="entry-registration-review-details">
        <div><dt>{text.organisation}</dt><dd>{attempt.request.organisationName ?? text.none}</dd></div>
        <div><dt>{text.card}</dt><dd>{attempt.request.cardNumber ?? text.none}</dd></div>
        {attempt.request.fixedStartTime && <div><dt>{attempt.request.assignedStartSlot ? text.lottedSlot : text.startTime}</dt><dd>{formatStartListTime(attempt.request.fixedStartTime, attempt.timeZone)}</dd></div>}
      </dl>
      <div className="entry-registration-actions">
        {authenticated && <button disabled={busy} onClick={() => void submit(attempt)}>{unknown ? text.retry : text.confirm}</button>}
        {!unknown && <button className="secondary" disabled={busy} onClick={() => setAttempt(undefined)}>{text.cancel}</button>}
      </div>
    </section>}
    {saved && <section className="panel stack entry-registration-saved"><p>✓ {text.saved}</p>
      <Link href={`/admin/${raceId}/recalculation`}>{text.recalculate}</Link>
      <button disabled={busy} onClick={() => { setSaved(false); setGivenName(""); setFamilyName(""); setOrganisationName(""); setNewCard(""); setFixedStartTime(""); setMessage(""); }}>{text.newEntry}</button>
    </section>}
    <p className="entry-registration-status" data-tone={messageTone} role="status" aria-live="polite">{unknown && attempt && message === text.unknown ? "" : message}</p>
  </div>;
}
