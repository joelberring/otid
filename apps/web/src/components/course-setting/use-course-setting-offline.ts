"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type {
  CourseSettingInspection, CourseSettingInspectionRequest, CourseSettingNote, CourseSettingNoteCreate, CourseSettingState
} from "@o-tid/contracts";
import { offlineSv as text } from "../../i18n/course-setting-offline-sv";
import {
  createCourseSettingNote, deleteCourseSettingNote, deleteCourseSettingNoteReply, fetchCourseSetting, HttpError, setCourseSettingInspection
} from "../../lib/course-setting-api";
import {
  drainQueue, recordToKeep, RecordWriter, remapQueue, type DrainResult, type FieldStore, type NoteDeleteRequest, type QueuedItem, type StoredMapInfo
} from "../../lib/course-setting-offline";
import { fieldStore, forgetCourseSettingCopy } from "../../lib/course-setting-offline-forget";
import { refreshShell, removeShell, saveShell, shellSupported } from "../../lib/course-setting-offline-shell";
import type { CourseSettingSync, EditorStore, SyncStatus } from "../../lib/course-setting-sync";
import { fetchMapSource } from "../../lib/route-choice-api";

/**
 * Steg 67 (ADR-0181 beslut 7): editorn utan täckning. Håller editorns väntande åtgärder i telefonen (`FieldRecord`, skrivs
 * strax efter varje ändring och när en ny version läses), skickar kön med notiser och bockar när nätet finns (vid start,
 * när nätet kommer tillbaka, när sidan visas igen och var 15:e sekund medan något väntar), och "Spara för offline"
 * (kartfilen i IndexedDB och sidskalet i service workern). Säger vad som hände när kön skickades.
 *
 * Översynen 2026-11-02: kön skickas först när editorns ändringar är sparade, och dess id översätts när editorns id byts
 * (`sync.listenIds`), i samma ordning som allt annat i kön. Ett fel när telefonen sparar (t.ex. full lagring på iOS) syns
 * i statusraden. Posten skrivs i två delar: grunden bara när den ändrats, loggen efter varje ändring. Säger servern att
 * man inte längre har tillgång (403 på läsningen) tas telefonens kopia av tävlingen bort.
 */
export { fieldStore };

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
  /** Tillgången är borttagen och kopian i telefonen likaså. */
  readonly onAccessGone: () => void;
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
  const [storageError, setStorageError] = useState(false);
  const storageErrorRef = useRef(false);
  const storageFailed = useCallback((what: string, error: unknown) => {
    console.error(what, error);
    if (!storageErrorRef.current) latest.current.say({ tone: "error", text: text.storageFailed });
    storageErrorRef.current = true;
    setStorageError(true);
  }, []);
  const storageOk = useCallback(() => { storageErrorRef.current = false; setStorageError(false); }, []);
  /** Allt som ändrar kön görs i tur och ordning (lägga till, översätta id, skicka). */
  const queueOps = useRef<Promise<unknown>>(Promise.resolve());
  const serial = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const next = queueOps.current.then(op, op);
    queueOps.current = next.catch(() => undefined);
    return next;
  }, []);

  const reloadQueue = useCallback(async () => {
    try { setQueue(await storage.listQueue(raceId)); } catch (error) { console.error("Kön i telefonen kunde inte läsas", error); }
  }, [storage, raceId]);
  useEffect(() => {
    void reloadQueue();
    void storage.mapInfo(raceId).then(setMapInfo, error => console.error("Kartfilen i telefonen kunde inte läsas", error));
  }, [storage, raceId, reloadQueue]);

  // Editorns väntande åtgärder i telefonen: strax efter varje ändring och varje ny version. Grunden (dokumentet, notiserna
  // och bockarna) skrivs bara när den ändrats sedan den senast skrevs.
  const writer = useMemo(() => new RecordWriter(storage, error => {
    if (error === undefined) storageOk(); else storageFailed("Ändringarna kunde inte sparas i telefonen", error);
  }), [storage, storageOk, storageFailed]);
  const persist = useCallback(async () => {
    const current = latest.current;
    const editor = store.state;
    const record = recordToKeep({ raceId, state: current.state, version: sync.version, base: sync.document, document: editor.document,
      log: editor.suggesting ? [] : editor.log, inFlight: sync.pendingRequest, offline: offlineRef.current, now: new Date(),
      notes: current.notes, inspections: current.inspections });
    await writer.write(raceId, record, { version: sync.version, parts: [sync.document, current.notes, current.inspections, current.state] });
  }, [writer, raceId, store, sync]);
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

  // Kön: skickas i ordning efter editorns ändringar (en notis kan gälla en kontroll som just skapats); det som inte gick
  // ligger kvar.
  const draining = useRef(false);
  const counts = useRef({ edits: 0, notes: 0, inspections: 0 });
  const drain = useCallback(async () => {
    if (draining.current || sync.dirty) return;
    draining.current = true;
    try {
      const result = await serial(() => drainQueue(storage, raceId, {
        note: (race, request) => createCourseSettingNote(race, request),
        inspection: (race, request) => setCourseSettingInspection(race, request),
        deleteNote: (race, request) => request.replyId ? deleteCourseSettingNoteReply(race, request.noteId, request.replyId)
          : deleteCourseSettingNote(race, request.noteId)
      }));
      setQueueOffline(result.stopped === "offline");
      setAuthStopped(result.stopped === "auth");
      for (const item of result.sent) counts.current[item.kind === "inspection" ? "inspections" : "notes"] += 1;
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
  }, [storage, raceId, reloadQueue, serial, sync]);

  // Editorns id har bytts: kön översätts direkt (före det som läggs i kön efter bytet); det som pekar på något som inte
  // finns tas ur kön med besked.
  useEffect(() => sync.listenIds((map, gone) => {
    void serial(() => remapQueue(storage, raceId, map, gone)).then(removed => {
      if (removed.length > 0) latest.current.say({ tone: "attention", text: text.rejected(removed.length),
        list: removed.map(item => `${latest.current.describe(item, 409)}`) });
      return reloadQueue();
    }, error => storageFailed("Kön i telefonen kunde inte översättas", error));
  }), [sync, serial, storage, raceId, reloadQueue, storageFailed]);

  const enqueue = useCallback(async (item: QueuedItem) => {
    try { await serial(() => storage.addQueued(item)); } catch (error) { storageFailed("Kön i telefonen kunde inte sparas", error); throw error; }
    await reloadQueue();
    void drain();
  }, [storage, reloadQueue, drain, serial, storageFailed]);
  const enqueueNote = useCallback((request: Omit<CourseSettingNoteCreate, "formatVersion">) =>
    enqueue({ id: request.requestId, raceId, kind: "note", createdAt: new Date().toISOString(), request }), [enqueue, raceId]);
  /**
   * ADR-0181 beslut 8: ta bort en notis eller ett svar genom kön. En notis som ännu inte skickats tas ur kön också
   * (borttagningen efter den blir då "redan borttagen").
   */
  const enqueueDelete = useCallback(async (request: NoteDeleteRequest) => {
    if (!request.replyId) await serial(() => storage.removeQueued(request.noteId));
    await enqueue({ id: crypto.randomUUID(), raceId, kind: "note-delete", createdAt: new Date().toISOString(), request });
  }, [enqueue, storage, raceId, serial]);
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
  // Ändringarna är sparade: nu kan kön gå.
  useEffect(() => { if (status === "saved" && queue.length > 0) void drain(); }, [status, queue.length, drain]);

  // Utloggad eller avvisad: har tillgången tagits bort (403 när banläggningen läses) tas telefonens kopia bort.
  const checkedAccess = useRef(false);
  useEffect(() => {
    if (!(authStopped || status === "stopped") || checkedAccess.current) return;
    checkedAccess.current = true;
    void fetchCourseSetting(raceId).then(() => undefined, async error => {
      if (!(error instanceof HttpError && error.status === 403)) return;
      await serial(() => forgetCourseSettingCopy(raceId, storage)).catch(problem => console.error("Kopian i telefonen kunde inte tas bort", problem));
      latest.current.onAccessGone();
    }).finally(() => { checkedAccess.current = false; });
  }, [authStopped, status, raceId, storage, serial]);

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

  const statusText = storageError ? text.status.storageFailed(waiting) : loggedOut && waiting > 0 ? text.status.loggedOut(waiting)
    : offline ? text.status.offline(waiting) : undefined;
  return { storage, queue, waiting, offline, loggedOut, storageError, statusText, enqueueNote, enqueueDelete, enqueueInspection, retry, mapInfo,
    offlineSaved, busy, panelMessage, saveOffline, removeOffline };
}

export type CourseSettingOffline = ReturnType<typeof useCourseSettingOffline>;
