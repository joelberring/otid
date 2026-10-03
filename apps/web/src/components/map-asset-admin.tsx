"use client";

import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  adminMapAssetStateResponseSchema,
  mapAssetPublishResponseSchema,
  mapAssetReservationResponseSchema,
  mapAssetStorageReceiptSchema,
  mapAssetWithdrawResponseSchema,
  type AdminMapAssetStateResponse
} from "@o-tid/contracts";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import { mapAssetSv as text } from "../i18n/map-asset-sv";

const validTypes = new Set(["image/png", "image/jpeg"]);
type Preview = { raceId: string; uploadId: string; state: "loading" | "ready" | "error" };

function csrf(): string | undefined {
  return typeof document === "undefined" ? undefined : readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
}

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

export function MapAssetAdmin({ raceId }: { raceId: string }) {
  const [state, setState] = useState<AdminMapAssetStateResponse>();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File>();
  const [selectedUploadId, setSelectedUploadId] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const base = `/api/admin/races/${raceId}/map`;

  const load = useCallback(async (preserveMessage = false) => {
    if (!preserveMessage) setMessage("");
    setLoading(true);
    setState(undefined);
    setPreview(undefined);
    setPublishConfirmed(false);
    setWithdrawConfirmed(false);
    try {
      const response = await fetch(base, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) { setMessage(text.unavailable); return; }
      const parsed = adminMapAssetStateResponseSchema.safeParse(await responseJson(response));
      if (!response.ok || !parsed.success || parsed.data.raceId !== raceId) { setMessage(text.loadError); return; }
      setState(parsed.data);
      setSelectedUploadId((current) => current && parsed.data.storedCandidates.some(candidate => candidate.uploadId === current) ? current : (parsed.data.storedCandidates[0]?.uploadId ?? ""));
    } catch {
      setMessage(text.loadError);
    } finally {
      setLoading(false);
    }
  }, [base, raceId]);

  useEffect(() => { void load(); }, [load]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !validTypes.has(file.type) || file.size < 1 || file.size > 50 * 1024 * 1024 || !title.trim()) { setMessage(text.uploadError); return; }
    const csrfToken = csrf();
    if (!csrfToken) { setMessage(text.unavailable); return; }
    setBusy(true); setMessage("");
    try {
      const requestId = crypto.randomUUID();
      const metadata = { formatVersion: 1, title: title.trim().normalize("NFC"), mediaType: file.type, byteLength: file.size, sha256: await sha256(file) };
      const reserved = await fetch(`${base}/reservations`, { method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrfToken, "idempotency-key": `map-upload:${requestId}` }, body: JSON.stringify(metadata) });
      const reservation = mapAssetReservationResponseSchema.safeParse(await responseJson(reserved));
      if (!reserved.ok || !reservation.success || reservation.data.raceId !== raceId) throw new Error("reserve");
      const stored = await fetch(`${base}/uploads/${reservation.data.uploadId}`, { method: "PUT", headers: { "content-type": file.type, "x-otid-csrf": csrfToken }, body: file });
      const receipt = mapAssetStorageReceiptSchema.safeParse(await responseJson(stored));
      if (!stored.ok || !receipt.success || receipt.data.raceId !== raceId || receipt.data.uploadId !== reservation.data.uploadId) throw new Error("store");
      setSelectedUploadId(receipt.data.uploadId); setFile(undefined); setMessage(text.uploaded); await load(true);
    } catch { setMessage(text.uploadError); } finally { setBusy(false); }
  }

  async function publish() {
    if (!state || state.raceId !== raceId || !selectedUploadId || !publishConfirmed) return;
    const csrfToken = csrf(); if (!csrfToken) { setMessage(text.unavailable); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${base}/publications`, { method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrfToken, "idempotency-key": `map-publish:${crypto.randomUUID()}` }, body: JSON.stringify({ formatVersion: 1, uploadId: selectedUploadId, expectedPublicationRevision: state.latestPublicationRevision }) });
      const receipt = mapAssetPublishResponseSchema.safeParse(await responseJson(response));
      if (!response.ok || !receipt.success || receipt.data.raceId !== raceId) throw new Error("publish");
      setPublishConfirmed(false); setMessage(text.published); await load(true);
    } catch { setMessage(text.publishError); } finally { setBusy(false); }
  }

  async function withdraw() {
    const publication = state?.raceId === raceId ? state.activePublication : undefined;
    if (!publication || !withdrawConfirmed) return;
    const csrfToken = csrf(); if (!csrfToken) { setMessage(text.unavailable); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${base}/withdrawals`, { method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrfToken, "idempotency-key": `map-withdraw:${crypto.randomUUID()}` }, body: JSON.stringify({ formatVersion: 1, publicationId: publication.publicationId, expectedPublicationRevision: publication.revision }) });
      const receipt = mapAssetWithdrawResponseSchema.safeParse(await responseJson(response));
      if (!response.ok || !receipt.success || receipt.data.raceId !== raceId) throw new Error("withdraw");
      setWithdrawConfirmed(false); setMessage(text.withdrawn); await load(true);
    } catch { setMessage(text.withdrawError); } finally { setBusy(false); }
  }

  const selectedCandidate = state?.raceId === raceId
    ? state.storedCandidates.find(candidate => candidate.uploadId === selectedUploadId) : undefined;
  const activePreview = preview?.raceId === raceId && preview.uploadId === selectedCandidate?.uploadId ? preview : undefined;
  const previewUrl = activePreview ? `${base}/previews/${activePreview.uploadId}` : undefined;

  return <section className="map-asset-admin stack">
    <p>{text.intro}</p>{(message || loading) && <p role="status" aria-live="polite">{loading ? text.loading : message}</p>}
    <div className="panel map-asset-current"><h2>{text.active}</h2>{state?.activePublication ? <><p><strong>{state.activePublication.title}</strong> · {text.currentVersion(state.activePublication.revision)} · {text.bytes(state.activePublication.byteLength)}</p><div className="map-asset-action"><label><input type="checkbox" checked={withdrawConfirmed} onChange={event => setWithdrawConfirmed(event.target.checked)} disabled={busy} /> {text.withdrawCheck}</label><button type="button" className="danger" disabled={busy || !withdrawConfirmed} onClick={() => void withdraw()}>{text.withdrawButton}</button></div></> : state ? <p>{text.inactive}</p> : null}</div>
    <div className="map-asset-workflow">
      <form className="panel stack" onSubmit={upload}><h2>{text.upload}</h2><label>{text.titleLabel}<input value={title} maxLength={120} required disabled={busy} onChange={event => setTitle(event.target.value)} /></label><label>{text.fileLabel}<input type="file" accept="image/png,image/jpeg" required disabled={busy} onChange={event => { const next = event.target.files?.[0]; setFile(next); if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, "")); }} /></label><p className="muted">{text.uploadHelp}</p><button disabled={busy}>{text.uploadButton}</button></form>
      <div className="panel stack"><h2>{text.stored}</h2>{state?.storedCandidates.length ? <><label>{text.publish}<select value={selectedUploadId} onChange={event => { setSelectedUploadId(event.target.value); setPreview(undefined); setPublishConfirmed(false); }} disabled={busy}>{state.storedCandidates.map(candidate => <option key={candidate.uploadId} value={candidate.uploadId}>{candidate.title} · {candidate.mediaType} · {text.bytes(candidate.byteLength)}</option>)}</select></label>
        <div className="map-asset-preview-controls"><button type="button" className="secondary" disabled={busy || !selectedCandidate || activePreview?.state === "loading" || activePreview?.state === "ready"} onClick={() => { if (selectedCandidate) setPreview({ raceId, uploadId: selectedCandidate.uploadId, state: "loading" }); }}>{text.previewButton}</button>{activePreview?.state === "ready" && previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer">{text.previewOpen}</a>}</div>
        {activePreview && <div className="map-asset-preview"><p role={activePreview.state === "error" ? "alert" : "status"}>{activePreview.state === "error" ? text.previewError : activePreview.state === "ready" ? text.previewReady : text.previewLoading}</p>{activePreview.state !== "error" && previewUrl && <img src={previewUrl} alt={text.previewAlt(selectedCandidate?.title ?? "")} onLoad={() => setPreview(current => current?.raceId === raceId && current.uploadId === activePreview.uploadId ? { ...current, state: "ready" } : current)} onError={() => setPreview(current => current?.raceId === raceId && current.uploadId === activePreview.uploadId ? { ...current, state: "error" } : current)} />}</div>}
        <div className="map-asset-action"><label><input type="checkbox" checked={publishConfirmed} onChange={event => setPublishConfirmed(event.target.checked)} disabled={busy} /> {text.publishCheck}</label><button type="button" disabled={busy || !selectedUploadId || !publishConfirmed} onClick={() => void publish()}>{text.publishButton}</button></div></> : state ? <p>{text.noStored}</p> : null}</div>
    </div>
    <button type="button" className="secondary map-asset-refresh" disabled={busy || loading} onClick={() => void load()}>{text.refresh}</button>
  </section>;
}
