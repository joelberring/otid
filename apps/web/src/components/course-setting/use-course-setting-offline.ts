"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  CourseSettingInspection, CourseSettingInspectionRequest, CourseSettingNote, CourseSettingNoteCreate, CourseSettingState
} from "@o-tid/contracts";
import { offlineSv as text } from "../../i18n/course-setting-offline-sv";
import { createCourseSettingNote, setCourseSettingInspection } from "../../lib/course-setting-api";
import {
  drainQueue, memoryFieldStore, recordToKeep, type DrainResult, type FieldStore, type QueuedItem, type StoredMapInfo
} from "../../lib/course-setting-offline";
import { indexedDbFieldStore } from "../../lib/course-setting-offline-idb";
import { refreshShell, removeShell, saveShell, shellSupported } from "../../lib/course-setting-offline-shell";
import type { CourseSettingSync, EditorStore, SyncStatus } from "../../lib/course-setting-sync";
import { fetchMapSource } from "../../lib/route-choice-api";

/**
 * Steg 67 (ADR-0181 beslut 7): editorn utan täckning. Håller editorns väntande åtgärder i telefonen (`FieldRecord`, skrivs
 * strax efter varje ändring och när en ny version läses), skickar kön med notiser och bockar när nätet finns (vid start,
 * när nätet kommer tillbaka, när sidan visas igen och var 15:e sekund medan något väntar), och "Spara för offline"
 * (kartfilen i IndexedDB och sidskalet i service workern). Säger vad som hände när kön skickades.
 */
let shared: FieldStore | undefined;
export function fieldStore(): FieldStore {
  shared ??= indexedDbFieldStore() ?? memoryFieldStore();
  return shared;
}

/**
 * Kartfilen: från telefonen när den sparade är samma fil som på servern (ingen ny hämtning av 5–60 MB), annars från
 * servern; utan nät den sparade även om den är äldre (`onOlder` säger det).
 */
export async function loadMapFile(raceId: string, sha256: string, storage: FieldStore, signal: AbortSignal, onOlder: () => void)
  : Promise<{ bytes: ArrayBuffer; fileName: string }> {
  const stored = await storage.mapInfo(raceId).catch(() => undefined);
  const fromPhone = async () => {
    const map = await storage.readMap(raceId);
    return map ? { bytes: map.data, fileName: map.fileName } : undefined;
  };
  if (stored?.sha256 === sha256) {
    const map = await fromPhone().catch(() => undefined);
    if (map) return map;
  }
  try {
    return await fetchMapSource(raceId, signal);
  } catch (error) {
    const map = stored && !signal.aborted ? await fromPhone().catch(() => undefined) : undefined;
    if (!map) throw error;
    onOlder();
    return map;
  }
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
}
/** Webbläsarens besked om nätet (falskt = säkert utan nät; sant betyder bara att det kanske finns). */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

export interface OfflineInput {
  readonly raceId: string;
  readonly state: CourseSettingState;
  readonly store: EditorStore;
  readonly sync: CourseSettingSync;
  readonly version: number;
  readonly status: SyncStatus;
  readonly mapSha256: string | undefined;
  /** Beskeden ovanpå kartan. */
  readonly say: (message: { tone: "ok" | "error" | "attention"; text: string; list?: readonly string[] }) => void;
  /** Text för en post som inte kunde sparas. */
  readonly describe: (item: QueuedItem, status: number) => string;
  /** Efter att kön skickats: notiserna och bockarna hämtas igen. */
  readonly onSent: (result: DrainResult) => void;
  /** Serverns notiser och bockar senast de hämtades (sparas med posten). */
  readonly notes: readonly CourseSettingNote[];
  readonly inspections: readonly CourseSettingInspection[];
}

export function useCourseSettingOffline(input: OfflineInput) {
  const { raceId, store, sync, version, status } = input;
  const storage = useMemo(fieldStore, []);
  const latest = useRef(input);
  latest.current = input;
  const browserOnline = useBrowserOnline();
  const [queue, setQueue] = useState<readonly QueuedItem[]>([]);
  const [queueOffline, setQueueOffline] = useState(false);
  const [authStopped, setAuthStopped] = useState(false);
  const [mapInfo, setMapInfo] = useState<StoredMapInfo>();
  const [busy, setBusy] = useState(false);
  const [panelMessage, setPanelMessage] = useState<string>();
  const offlineSaved = mapInfo !== undefined;
  const offlineRef = useRef(offlineSaved);
  offlineRef.current = offlineSaved;

  const reloadQueue = useCallback(async () => {
    try { setQueue(await storage.listQueue(raceId)); } catch (error) { console.error("Kön i telefonen kunde inte läsas", error); }
  }, [storage, raceId]);
  useEffect(() => {
    void reloadQueue();
    void storage.mapInfo(raceId).then(setMapInfo, error => console.error("Kartfilen i telefonen kunde inte läsas", error));
  }, [storage, raceId, reloadQueue]);

  // Editorns väntande åtgärder i telefonen: strax efter varje ändring och varje ny version.
  const persist = useCallback(async () => {
    const current = latest.current;
    const editor = store.state;
    const record = recordToKeep({ raceId, state: current.state, version: sync.version, base: sync.document, document: editor.document,
      log: editor.suggesting ? [] : editor.log, inFlight: sync.pendingRequest, offline: offlineRef.current, now: new Date(),
      notes: current.notes, inspections: current.inspections });
    try {
      if (record) await storage.writeRecord(record); else await storage.clearRecord(raceId);
    } catch (error) { console.error("Ändringarna kunde inte sparas i telefonen", error); }
  }, [storage, raceId, store, sync]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const schedulePersist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = undefined; void persist(); }, 250);
  }, [persist]);
  useEffect(() => store.subscribe(schedulePersist), [store, schedulePersist]);
  useEffect(() => { schedulePersist(); }, [version, status, offlineSaved, input.notes, input.inspections, schedulePersist]);
  useEffect(() => {
    const now = () => { if (document.visibilityState === "hidden") { if (timer.current) clearTimeout(timer.current); void persist(); } };
    document.addEventListener("visibilitychange", now);
    window.addEventListener("pagehide", now);
    return () => { document.removeEventListener("visibilitychange", now); window.removeEventListener("pagehide", now); };
  }, [persist]);

  // Kön: skickas i ordning; det som inte gick ligger kvar.
  const draining = useRef(false);
  const counts = useRef({ edits: 0, notes: 0, inspections: 0 });
  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      const result = await drainQueue(storage, raceId, {
        note: (race, request) => createCourseSettingNote(race, request),
        inspection: (race, request) => setCourseSettingInspection(race, request)
      });
      setQueueOffline(result.stopped === "offline");
      setAuthStopped(result.stopped === "auth");
      for (const item of result.sent) counts.current[item.kind === "note" ? "notes" : "inspections"] += 1;
      if (result.rejected.length > 0) {
        latest.current.say({ tone: "attention", text: text.rejected(result.rejected.length),
          list: result.rejected.map(row => latest.current.describe(row.item, row.status)) });
      }
      if (result.sent.length > 0 || result.rejected.length > 0) latest.current.onSent(result);
    } catch (error) {
      console.error("Kön kunde inte skickas", error);
    } finally {
      draining.current = false;
      await reloadQueue();
    }
  }, [storage, raceId, reloadQueue]);

  const enqueue = useCallback(async (item: QueuedItem) => {
    await storage.addQueued(item);
    await reloadQueue();
    void drain();
  }, [storage, reloadQueue, drain]);
  const enqueueNote = useCallback((request: Omit<CourseSettingNoteCreate, "formatVersion">) =>
    enqueue({ id: request.requestId, raceId, kind: "note", createdAt: new Date().toISOString(), request }), [enqueue, raceId]);
  const enqueueInspection = useCallback((request: CourseSettingInspectionRequest) =>
    enqueue({ id: crypto.randomUUID(), raceId, kind: "inspection", createdAt: request.at, request }), [enqueue, raceId]);

  /** Försök igen nu: kön och editorns sparande (efter inloggning eller när nätet är tillbaka). */
  const retry = useCallback(() => {
    if (sync.halted && latest.current.status === "stopped") sync.resume(); else sync.poke();
    void drain();
  }, [sync, drain]);
  useEffect(() => {
    void drain();
    const again = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("online", retry); window.removeEventListener("focus", retry); document.removeEventListener("visibilitychange", again); };
  }, [drain, retry]);
  useEffect(() => {
    if (queue.length === 0) return;
    const interval = setInterval(() => void drain(), 15_000);
    return () => clearInterval(interval);
  }, [queue.length, drain]);

  const unsentEdits = store.state.suggesting ? 0 : store.state.log.length;
  const waiting = unsentEdits + queue.length;
  const offline = !browserOnline || status === "failed" || queueOffline;
  const loggedOut = authStopped || status === "stopped";

  // Vad som hände när nätet kom tillbaka: allt som väntade är sparat (det som inte gick har egna besked).
  const wasWaiting = useRef(false);
  useEffect(() => {
    if ((offline || loggedOut) && waiting > 0) { wasWaiting.current = true; counts.current.edits = Math.max(counts.current.edits, unsentEdits); return; }
    if (!wasWaiting.current || offline || loggedOut || waiting > 0 || status !== "saved") return;
    wasWaiting.current = false;
    const { edits, notes, inspections } = counts.current;
    counts.current = { edits: 0, notes: 0, inspections: 0 };
    const parts = [...(edits > 0 ? [text.backEdits(edits)] : []), ...(notes > 0 ? [text.backNotes(notes)] : []),
      ...(inspections > 0 ? [text.backInspections(inspections)] : [])];
    if (parts.length > 0) latest.current.say({ tone: "ok", text: text.back(parts) });
  }, [offline, loggedOut, waiting, unsentEdits, status]);

  // Sparad för offline: sidskalet hålls uppdaterat när sidan öppnas med nät.
  useEffect(() => {
    if (!offlineSaved || !browserOnline) return;
    refreshShell(raceId).catch(error => console.error("Sidan kunde inte sparas om för offline", error));
  }, [offlineSaved, browserOnline, raceId]);

  /** "Spara kartan för offline": kartfilen i IndexedDB, sidan i service workern och posten för att öppna utan nät. */
  async function saveOffline() {
    setBusy(true); setPanelMessage(undefined);
    try {
      const sha256 = latest.current.mapSha256;
      if (!sha256) throw new Error("Ingen kartfil");
      const file = await fetchMapSource(raceId);
      const info = { raceId, sha256, fileName: file.fileName, bytes: file.bytes.byteLength, savedAt: new Date().toISOString() };
      await storage.writeMap({ ...info, data: file.bytes });
      setMapInfo(info);
      offlineRef.current = true;
      await persist();
      // Webbläsaren ombeds att inte rensa lagringen när utrymmet tryter.
      await navigator.storage?.persist?.().catch(() => false);
      if (!shellSupported()) { setPanelMessage(text.panel.noShell); return; }
      try { await saveShell(raceId); } catch (error) { console.error("Sidan sparades inte för offline", error); setPanelMessage(text.panel.shellFailed); }
    } catch (error) {
      console.error("Kartan kunde inte sparas för offline", error);
      setPanelMessage(text.panel.failed);
    } finally { setBusy(false); }
  }

  async function removeOffline() {
    setBusy(true); setPanelMessage(undefined);
    try {
      await storage.clearMap(raceId);
      setMapInfo(undefined);
      offlineRef.current = false;
      await persist();
      await removeShell(raceId);
      setPanelMessage(text.panel.removed);
    } catch (error) { console.error("Det sparade kunde inte tas bort", error); setPanelMessage(text.panel.failed); } finally { setBusy(false); }
  }

  const statusText = loggedOut && waiting > 0 ? text.status.loggedOut(waiting) : offline ? text.status.offline(waiting) : undefined;
  return { storage, queue, waiting, offline, loggedOut, statusText, enqueueNote, enqueueInspection, retry, mapInfo, offlineSaved, busy,
    panelMessage, saveOffline, removeOffline };
}

export type CourseSettingOffline = ReturnType<typeof useCourseSettingOffline>;
