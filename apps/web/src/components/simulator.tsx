"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  isValidSimulatorIdentity,
  isDurablyAcknowledged,
  parseStoredBatch,
  parseStoredQueue,
  packageStatusNotice,
  storedQueueItemCount,
  validatedAcknowledgementForEvent,
  withoutAcknowledgedBatch,
  type PendingSimulatorBatch,
  type SimulatorPayload
} from "./simulator-queue";

async function sha256(payload: SimulatorPayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function storageKey(raceId: string, name: string) { return `otid:${raceId}:${name}`; }

export function Simulator({ raceId, packageVersion }: { raceId: string; packageVersion: number }) {
  const [deviceId, setDeviceId] = useState("");
  const [pending, setPending] = useState<PendingSimulatorBatch[]>([]);
  const pendingRef = useRef<PendingSimulatorBatch[]>([]);
  const [last, setLast] = useState<PendingSimulatorBatch>();
  const [ack, setAck] = useState("Ingen batch skickad");
  const [credential, setCredential] = useState("");
  const [online, setOnline] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);

  const persistQueue = useCallback((queue: PendingSimulatorBatch[]) => {
    pendingRef.current = queue;
    localStorage.setItem(storageKey(raceId, "queue"), JSON.stringify(queue));
    setPending(queue);
  }, [raceId]);

  const persistLast = useCallback((batch: PendingSimulatorBatch) => {
    localStorage.setItem(storageKey(raceId, "last-batch"), JSON.stringify(batch));
    setLast(batch);
  }, [raceId]);

  useEffect(() => {
    const deviceKey = storageKey(raceId, "device-id");
    const storedDeviceId = localStorage.getItem(deviceKey);
    const existing = isValidSimulatorIdentity(storedDeviceId) ? storedDeviceId : crypto.randomUUID();
    if (!isValidSimulatorIdentity(storedDeviceId)) {
      localStorage.setItem(storageKey(raceId, "next-sequence"), "1");
    }
    localStorage.setItem(deviceKey, existing);

    const queueKey = storageKey(raceId, "queue");
    const lastBatchKey = storageKey(raceId, "last-batch");
    const serializedQueue = localStorage.getItem(queueKey);
    const serializedLast = localStorage.getItem(lastBatchKey);
    const fallbackDeviceId = isValidSimulatorIdentity(storedDeviceId) ? storedDeviceId : "";
    let restoredQueue = parseStoredQueue(serializedQueue, packageVersion, fallbackDeviceId);
    let restoredLast = parseStoredBatch(serializedLast, packageVersion, fallbackDeviceId);
    const storedItemCount = storedQueueItemCount(serializedQueue);
    const queueNeedsQuarantine = storedItemCount === undefined || storedItemCount !== restoredQueue.length;
    const lastNeedsQuarantine = serializedLast !== null && restoredLast === undefined;
    if (queueNeedsQuarantine || lastNeedsQuarantine) {
      const quarantineSuffix = `quarantine-${Date.now()}`;
      if (serializedQueue !== null) {
        localStorage.setItem(storageKey(raceId, `queue-${quarantineSuffix}`), serializedQueue);
      }
      if (serializedLast !== null) {
        localStorage.setItem(storageKey(raceId, `last-batch-${quarantineSuffix}`), serializedLast);
      }
      restoredQueue = [];
      restoredLast = undefined;
      setAck("En äldre eller skadad lokal kö har bevarats i karantän och skickas inte automatiskt");
    }
    const effectiveLast = restoredLast
      ? restoredQueue.find((batch) => batch.queueId === restoredLast.queueId) ?? restoredLast
      : restoredQueue.at(-1);
    // Rewriting freezes the fallback version and device/session identity
    // assigned to legacy TASK 001 queue entries.
    localStorage.setItem(queueKey, JSON.stringify(restoredQueue));
    if (effectiveLast) localStorage.setItem(lastBatchKey, JSON.stringify(effectiveLast));
    else localStorage.removeItem(lastBatchKey);
    pendingRef.current = restoredQueue;
    setDeviceId(existing);
    setPending(restoredQueue);
    setLast(effectiveLast);
    setOnline(navigator.onLine);
    setInitialized(true);

    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [packageVersion, raceId]);

  const send = useCallback(async (batch: PendingSimulatorBatch): Promise<boolean> => {
    try {
      if (credential === "") {
        setAck(`Sekvens ${batch.event.localSequence} ligger kvar lokalt; stationscredential saknas`);
        return false;
      }
      const event = batch.event;
      const response = await fetch(`/api/races/${raceId}/device-batches`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
          "idempotency-key": `${batch.deviceId}:${event.localSequence}:${event.localSequence}`
        },
        body: JSON.stringify({
          deviceId: batch.deviceId,
          sessionId: batch.sessionId,
          packageVersion: batch.packageVersion,
          firstSequence: event.localSequence,
          lastSequence: event.localSequence,
          events: [event]
        })
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const error = typeof body === "object" && body !== null && "error" in body &&
          typeof body.error === "string" ? body.error : undefined;
        setAck(error ?? "Servern avvisade batchen");
        return false;
      }

      const validated = validatedAcknowledgementForEvent(body, batch);
      if (!validated) {
        setAck(`Sekvens ${event.localSequence}: ogiltig serverkvittens; posten ligger kvar lokalt`);
        return false;
      }
      const packageNotice = packageStatusNotice(validated.batch);
      const status = validated.event.status;
      setAck(`Sekvens ${event.localSequence}: ${status}.${packageNotice}`);
      if (isDurablyAcknowledged(validated.event)) {
        persistQueue(withoutAcknowledgedBatch(pendingRef.current, batch));
      }
      return true;
    } catch {
      setAck(`Sekvens ${batch.event.localSequence} kunde inte skickas; posten ligger kvar lokalt`);
      return false;
    }
  }, [credential, persistQueue, raceId]);

  const flushQueue = useCallback(async () => {
    if (flushingRef.current || !deviceId || !navigator.onLine) return;
    flushingRef.current = true;
    setFlushing(true);
    try {
      const snapshot = [...pendingRef.current];
      for (const batch of snapshot) {
        if (!await send(batch)) break;
      }
    } finally {
      flushingRef.current = false;
      setFlushing(false);
    }
  }, [deviceId, send]);

  useEffect(() => {
    if (initialized && online && pendingRef.current.length > 0) void flushQueue();
  }, [flushQueue, initialized, online]);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const now = Date.now();
    const codesValue = form.get("codes");
    const cardValue = form.get("cardNumber");
    if (typeof codesValue !== "string" || typeof cardValue !== "string") return;
    const codes = codesValue.split(",").map((value) => Number(value.trim())).filter(Number.isInteger);
    const payload: SimulatorPayload = {
      cardNumber: cardValue,
      startPunchedAt: new Date(now - 45 * 60_000).toISOString(),
      finishPunchedAt: new Date(now).toISOString(),
      punches: codes.map((code, index) => ({ code, punchedAt: new Date(now - (codes.length - index) * 8 * 60_000).toISOString() }))
    };
    const sequenceKey = storageKey(raceId, "next-sequence");
    const localSequence = Number(localStorage.getItem(sequenceKey) ?? "1");
    localStorage.setItem(sequenceKey, String(localSequence + 1));
    const batch: PendingSimulatorBatch = {
      queueId: crypto.randomUUID(),
      deviceId,
      sessionId: deviceId,
      packageVersion,
      event: {
        localSequence,
        stationReceivedAt: new Date().toISOString(),
        transport: "simulator",
        payload,
        contentHash: await sha256(payload)
      }
    };
    persistLast(batch);
    persistQueue([...pendingRef.current, batch]);
    if (navigator.onLine) await flushQueue();
    else setAck(`Sekvens ${localSequence} ligger kvar lokalt`);
  }

  return <section className="panel stack">
    <h2>Stationssimulator</h2>
    <div className="status-grid">
      <div className="status"><span>Hårdvara</span><strong>Simulator (inte USB)</strong></div>
      <div className="status"><span>Internet</span><strong>{online ? "Ansluten" : "Frånkopplad"}</strong></div>
      <div className="status"><span>Paketversion</span><strong>{packageVersion}</strong></div>
      <div className="status"><span>Lokal kö</span><strong>{pending.length}</strong></div>
    </div>
    <small>Enhet: {deviceId || "skapas …"}</small>
    <label>Stationscredential
      <input
        name="stationCredential"
        type="password"
        autoComplete="off"
        value={credential}
        onChange={(event) => setCredential(event.currentTarget.value)}
        placeholder="Utfärdas av betrodd server-CLI"
      />
    </label>
    <small>Credentialen hålls endast i minnet och måste vara utfärdad för denna enhet och detta lopp.</small>
    <form className="stack" onSubmit={submit}>
      <label>Bricknummer<input name="cardNumber" required /></label>
      <label>Kontrollkoder, kommaseparerade<input name="codes" defaultValue="31,32,33" required /></label>
      <button type="submit" disabled={!deviceId}>Simulera och skicka</button>
    </form>
    <button type="button" disabled={!online || !credential || pending.length === 0 || flushing} onClick={flushQueue}>
      {flushing ? "Skickar väntande poster …" : `Skicka väntande poster (${pending.length})`}
    </button>
    <button type="button" className="secondary" disabled={!last || !online || !credential} onClick={() => last && send(last)}>Skicka samma batch igen</button>
    <strong role="status">Serverkvittens: {ack}</strong>
  </section>;
}
