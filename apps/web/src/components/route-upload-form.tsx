"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import {
  routeUploadReservationResponseSchema,
  routeUploadStatusResponseSchema,
  routeUploadStorageReceiptSchema,
  routePublicationConsentResponseSchema,
  routePublicationConsentStateResponseSchema,
  type RoutePublicationConsentStateResponse,
  type RouteUploadStoredStatusReceipt
} from "@o-tid/contracts";
import { readRouteUploadCsrfCookie } from "../lib/route-upload-cookies";
import { routeUploadSv as text } from "../i18n/route-upload-sv";

const maxBytes = 8 * 1024 * 1024;
type PendingReservation = { file: File; sha256: string; idempotencyKey: string };
type PendingUpload = { file: File; uploadId: string };
type Phase = "idle" | "hashing" | "reserving" | "transferring";
type Availability = "checking" | "ready" | "unavailable";
type PendingConsent = { decision: "GRANT" | "WITHDRAW"; idempotencyKey: string };

function isGpx(file: File): boolean {
  return file.size >= 1 && file.size <= maxBytes && file.name.toLocaleLowerCase("sv-SE").endsWith(".gpx");
}

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

function csrf(): string | undefined {
  if (typeof document === "undefined" || typeof window === "undefined") return undefined;
  return readRouteUploadCsrfCookie(document.cookie, new URL(window.location.href));
}

function failureMessage(status: number): string {
  return status === 401 || status === 403 ? text.unavailable : text.failed;
}

function timestamp(value: string): string {
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function RouteUploadForm() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [reservation, setReservation] = useState<PendingReservation>();
  const [pending, setPending] = useState<PendingUpload>();
  const [receipt, setReceipt] = useState<RouteUploadStoredStatusReceipt>();
  const [consent, setConsent] = useState<RoutePublicationConsentStateResponse>();
  const [pendingConsent, setPendingConsent] = useState<PendingConsent>();
  const [availability, setAvailability] = useState<Availability>("checking");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const busy = phase !== "idle";

  async function loadConsent(): Promise<void> {
    const response = await fetch("/api/route-upload/publication-consent", { cache: "no-store" });
    const parsed = routePublicationConsentStateResponseSchema.safeParse(await responseJson(response));
    if (!response.ok || !parsed.success) throw new Error("ROUTE_PUBLICATION_CONSENT_UNAVAILABLE");
    setConsent(parsed.data);
  }

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const response = await fetch("/api/route-upload/status", { cache: "no-store" });
        const parsed = routeUploadStatusResponseSchema.safeParse(await responseJson(response));
        if (!response.ok || !parsed.success) throw new Error("ROUTE_UPLOAD_STATUS_UNAVAILABLE");
        if (!current) return;
        if (parsed.data.status === "stored") { setReceipt(parsed.data.receipt); await loadConsent(); }
        setAvailability("ready");
      } catch {
        if (!current) return;
        setAvailability("unavailable");
        setMessage(text.unavailable);
      }
    })();
    return () => { current = false; };
  }, []);

  async function transfer(upload: PendingUpload, csrfToken: string) {
    setPhase("transferring");
    const response = await fetch(`/api/route-upload/reservations/${upload.uploadId}`, {
      method: "PUT", cache: "no-store",
      headers: { "content-type": "application/gpx+xml", "x-otid-csrf": csrfToken }, body: upload.file
    });
    const parsed = routeUploadStorageReceiptSchema.safeParse(await responseJson(response));
    if (!response.ok || !parsed.success || parsed.data.uploadId !== upload.uploadId) throw new Error(failureMessage(response.status));
    setReceipt({
      storedAt: parsed.data.storedAt,
      pointCount: parsed.data.pointCount,
      segmentCount: parsed.data.segmentCount,
      firstRecordedAt: parsed.data.firstRecordedAt,
      lastRecordedAt: parsed.data.lastRecordedAt
    }); setReservation(undefined); setPending(undefined); setFile(undefined);
    await loadConsent();
    if (input.current) input.current.value = "";
  }

  async function decideConsent(decision: "GRANT" | "WITHDRAW") {
    if (busy) return;
    const csrfToken = csrf(); if (!csrfToken) { setMessage(text.unavailable); return; }
    const pending = pendingConsent?.decision === decision ? pendingConsent : { decision, idempotencyKey: `route-publication-consent:${crypto.randomUUID()}` };
    setPendingConsent(pending); setMessage("");
    try {
      const response = await fetch("/api/route-upload/publication-consent", { method: "POST", cache: "no-store", headers: {
        "content-type": "application/json", "x-otid-csrf": csrfToken, "idempotency-key": pending.idempotencyKey
      }, body: JSON.stringify({ formatVersion: 1, decision }) });
      const parsed = routePublicationConsentResponseSchema.safeParse(await responseJson(response));
      if (!response.ok || !parsed.success) throw new Error("ROUTE_PUBLICATION_CONSENT_FAILED");
      setConsent({ formatVersion: 1, status: "stored", consent: parsed.data.consent, revision: parsed.data.revision, decidedAt: parsed.data.decidedAt });
      setPendingConsent(undefined); setMessage(text.consentSaved);
    } catch { setMessage(text.consentFailed); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (availability !== "ready" || receipt || busy) return;
    const selected = file;
    if (!selected) { setMessage(text.missingFile); return; }
    if (!isGpx(selected)) { setMessage(text.invalidFile); return; }
    const csrfToken = csrf();
    if (!csrfToken) { setMessage(text.unavailable); return; }
    setMessage("");
    try {
      if (pending?.file === selected) { await transfer(pending, csrfToken); }
      else {
        let attempt = reservation?.file === selected ? reservation : undefined;
        if (!attempt) {
          setPhase("hashing");
          attempt = { file: selected, sha256: await sha256(selected), idempotencyKey: `route-upload:${crypto.randomUUID()}` };
          setReservation(attempt);
        }
        setPhase("reserving");
        const response = await fetch("/api/route-upload/reservations", {
          method: "POST", cache: "no-store",
          headers: { "content-type": "application/json", "x-otid-csrf": csrfToken, "idempotency-key": attempt.idempotencyKey },
          body: JSON.stringify({ formatVersion: 1, fileName: selected.name.normalize("NFC"), mediaType: "application/gpx+xml", byteLength: selected.size, sha256: attempt.sha256 })
        });
        const parsed = routeUploadReservationResponseSchema.safeParse(await responseJson(response));
        if (!response.ok || !parsed.success) throw new Error(failureMessage(response.status));
        const reserved = { file: selected, uploadId: parsed.data.uploadId };
        setReservation(undefined);
        setPending(reserved);
        await transfer(reserved, csrfToken);
      }
    } catch (error) {
      setMessage(error instanceof Error && (error.message === text.unavailable || error.message === text.failed) ? error.message : text.failed);
    } finally { setPhase("idle"); }
  }

  const action = phase === "hashing" ? text.hashing : phase === "reserving" ? text.reserving : phase === "transferring" ? text.transferring : pending || reservation ? text.retry : text.upload;
  return <section className="route-upload-form panel stack" aria-label="Privat ruttuppladdning">
    <p>{text.intro}</p>
    {availability === "checking" ? <p role="status">{text.checking}</p>
      : receipt ? <><div className="route-upload-saved" role="status"><strong>{text.saved}</strong><p>{text.points(receipt.pointCount)} · {text.segments(receipt.segmentCount)}</p><p>{text.savedAt}: <time dateTime={receipt.storedAt}>{timestamp(receipt.storedAt)}</time></p>{receipt.firstRecordedAt === null ? <p>{text.noTime}</p> : <><p>{text.firstRecordedAt}: <time dateTime={receipt.firstRecordedAt}>{timestamp(receipt.firstRecordedAt)}</time></p><p>{text.lastRecordedAt}: <time dateTime={receipt.lastRecordedAt!}>{timestamp(receipt.lastRecordedAt!)}</time></p><p>{text.timed}</p></>}</div>{consent?.status === "stored" && <section className="route-publication-consent stack"><h2>{text.consentTitle}</h2><p>{consent.consent === "PRIVATE" ? text.consentPrivate : text.consentReady}</p><button type="button" disabled={Boolean(pendingConsent)} onClick={() => void decideConsent(consent.consent === "PRIVATE" ? "GRANT" : "WITHDRAW")}>{consent.consent === "PRIVATE" ? text.consentGrant : text.consentWithdraw}</button></section>}</>
      : availability === "ready" ? <form className="stack" onSubmit={(event) => void submit(event)}>
        <label>{text.file}<input ref={input} type="file" accept=".gpx,application/gpx+xml" required disabled={busy || Boolean(pending) || Boolean(reservation)}
          onChange={event => { setFile(event.target.files?.[0]); setReservation(undefined); setPending(undefined); setMessage(""); }} /></label>
        <p className="muted">{text.help}</p>
        <button disabled={busy}>{action}</button>
      </form> : null}
    {message && <p className="warning" role="alert">{message}</p>}
  </section>;
}
