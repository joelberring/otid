"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAP_PROJECT_SYNC_MAX_EDITS, type MapProjectSyncResponse, type MapProjectView } from "@o-tid/contracts";
import { withColorChanges, type MapColor, type MapColorChange, type MapGeoreference, type MapObject, type MapSymbolColorChange, type Point } from "@o-tid/map-file";
import type { SymbolColorsControl } from "./map-project-symbol-colors";
import {
  acknowledge, addEdit, effectiveObjects, effectiveState, emptyHistory, keepOpenProposals, mergePulled, recordStep, recordSteps, redoStep, resolveConflict, undoStep,
  type EditKind, type EditResult, type KeyedState, type ObjectKey, type ObjectRef, type ObjectState, type RevisionHistory, type ServerObject
} from "@o-tid/map-revision";
import { areaBounds } from "@o-tid/map-revision/base-map";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { controlledWorker } from "../../lib/course-setting-worker";
import { cachedMapFile, mapFileCache } from "../../lib/map-file-cache";
import { clientStoreAvailable, loadClient, saveClient, type StoredClient } from "../../lib/map-project-client-store";
import { mapProjectBase } from "../../lib/map-project-client";
import { MapProjectSession, type CatalogSymbol } from "../../lib/map-project-protocol";

// K3: styrd av service workern när kartsidan är sparad för offline (`controlledWorker`, som banläggningens).
const createWorker = () => controlledWorker(() => new Worker(new URL("../../lib/map-project-worker.ts", import.meta.url), { type: "module" }));

/** Synken: hur ofta andras ändringar hämtas när sidan syns, och hur länge egna ändringar samlas innan de skickas. */
const POLL_MS = 5000, SEND_DELAY_MS = 700;

export type SyncState = { readonly kind: "idle" | "syncing" | "offline" | "error"; readonly at?: number | undefined; readonly status?: number | undefined };

export interface ObjectChange {
  readonly key: ObjectKey;
  readonly ref: ObjectRef | null;
  readonly after: ObjectState;
  readonly kind: EditKind;
  /** Var ändringen gjordes (en borttagning av grundfilens objekt), för delområdena. */
  readonly point?: Point | undefined;
  /** Flera objekt ändrade på en gång (markerade med en ruta): stegen med samma grupp ångras tillsammans. */
  readonly group?: string | undefined;
}

/**
 * ADR-0219 (K1): kartprojektets editor utan gränssnitt. Grundfilen hämtas (webbläsarens kartcache per sha256) och läses i
 * Workern; de egna ändringarna ligger i kön (`map-revision`) som sparas i IndexedDB efter varje ändring och skickas till servern
 * en stund efter den senaste. Andras ändringar hämtas var femte sekund medan sidan syns. Workern får alla ändrade objekt efter
 * varje ny ändring eller hämtning och ritar om (`renderKey`).
 */
/** Så mycket (tecken) skickas högst i en synkning; servern tar emot 4 MB. */
const SEND_MAX_CHARS = 2_500_000;
/** Nästa sändning ur kön: högst 200 ändringar och inte mer än servern tar emot (stora inlästa objekt), minst en. */
export function sendBatch<T>(pending: readonly T[], maxChars = SEND_MAX_CHARS): T[] {
  const out: T[] = [];
  let size = 0;
  for (const edit of pending) {
    const length = JSON.stringify(edit).length;
    if (out.length >= MAP_PROJECT_SYNC_MAX_EDITS || (out.length > 0 && size + length > maxChars)) break;
    out.push(edit); size += length;
  }
  return out;
}

export function useMapProjectEditor(view: MapProjectView, onSynced?: (proposed: boolean) => void) {
  const base = mapProjectBase(view.projectId);
  const [session, setSession] = useState<MapProjectSession>();
  const [bounds, setBounds] = useState<Bounds>();
  const [colors, setColors] = useState<readonly MapColor[]>([]);
  // Projektets ändrade färger (ägaren 2026-11-10): de sparade, och det som visas just nu (en förhandsvisning medan man ändrar).
  const [colorChanges, setColorChanges] = useState<readonly MapColorChange[]>(view.colors);
  const [symbolColorChanges, setSymbolColorChanges] = useState<readonly MapSymbolColorChange[]>(view.symbolColors);
  const [georeference, setGeoreference] = useState<MapGeoreference | null>(null);
  const [northLines, setNorthLines] = useState<number>();
  /** Kartans skala (normen för lagren). */
  const [scale, setScale] = useState<number>();
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [catalog, setCatalog] = useState<readonly CatalogSymbol[]>([]);
  const [client, setClient] = useState<StoredClient>();
  const clientRef = useRef<StoredClient | undefined>(undefined);
  const [history, setHistory] = useState<RevisionHistory>(emptyHistory);
  const historyRef = useRef(history);
  const [renderKey, setRenderKey] = useState(0);
  const [sync, setSync] = useState<SyncState>({ kind: "idle" });
  const [notice, setNotice] = useState<string>();
  const [preview, setPreview] = useState<ReadonlySet<ObjectKey>>(new Set());
  // Föreslå (och Ändra där ändringen blir ett förslag) ritar också; servern avgör vad som blir förslag.
  const canEdit = view.viewer.canEdit || view.viewer.canPropose;
  const syncedRef = useRef(onSynced);
  syncedRef.current = onSynced;

  const area = view.area;
  // Grundfilen till Workern.
  useEffect(() => {
    const controller = new AbortController();
    let closed = false;
    const created = new MapProjectSession(createWorker, loaded => {
      if (closed) return;
      // En ny tom karta: kartvyn täcker området.
      setBounds(loaded.objects === 0 && area ? areaBounds(area) : loaded.bounds); setColors(loaded.colors); if (view.colors.length) created.colors(view.colors); if (view.symbolColors.length) created.symbolColors(view.symbolColors); setGeoreference(loaded.georeference); setNorthLines(loaded.northLines); setScale(loaded.scale); setMapStatus("ready");
      created.catalog(symbols => { if (!closed) setCatalog(symbols); });
    }, () => { if (!closed) setMapStatus("failed"); });
    void (async () => {
      try {
        const file = await cachedMapFile(mapFileCache, view.base.sha256, async () => {
          const response = await fetch(`${base}/source`, { credentials: "same-origin", signal: controller.signal });
          if (!response.ok) throw new Error(`Grundfilen kunde inte hämtas (${response.status})`);
          return { bytes: await response.arrayBuffer(), fileName: view.base.fileName };
        }, controller.signal);
        if (closed) return;
        // Cachen behåller sin kopia; Workern får en egen.
        created.load(file.bytes.slice(0), file.fileName, view.base.sha256);
        setSession(created);
      } catch { if (!closed) setMapStatus("failed"); }
    })();
    return () => { closed = true; controller.abort(); created.close(); };
  }, [base, view.base.sha256, view.base.fileName, area]);

  // Det sparade läget i webbläsaren.
  useEffect(() => {
    let closed = false;
    void loadClient(view.projectId, view.viewer.accountId).catch(() => undefined).then(stored => {
      if (closed) return;
      const value = stored ?? { state: { seq: 0, server: {}, pending: [], conflicts: {} }, clientId: crypto.randomUUID() };
      clientRef.current = value;
      setClient(value);
      if (!clientStoreAvailable()) setNotice("noStore");
    });
    return () => { closed = true; };
  }, [view.projectId, view.viewer.accountId]);

  const store = useCallback((next: StoredClient) => {
    clientRef.current = next;
    setClient(next);
    void saveClient(view.projectId, view.viewer.accountId, next).catch(() => setNotice("noStore"));
  }, [view.projectId, view.viewer.accountId]);

  /** Alla ändrade objekt till Workern (med dem som just dras dolda) och en ny bild. */
  const states = useMemo(() => {
    const out = new Map<ObjectKey, KeyedState>();
    if (!client) return out;
    for (const [key, value] of effectiveObjects(client.state)) out.set(key, value);
    for (const key of preview) out.set(key, { ref: out.get(key)?.ref ?? null, state: { kind: "DELETED" } });
    return out;
  }, [client, preview]);
  useEffect(() => {
    if (!session || mapStatus !== "ready") return;
    session.states(states);
    setRenderKey(key => key + 1);
  }, [session, mapStatus, states]);

  // Synken.
  const syncing = useRef(false), again = useRef(false);
  const syncNow = useCallback(async () => {
    if (!clientRef.current) return;
    if (syncing.current) { again.current = true; return; }
    syncing.current = true;
    setSync(previous => ({ ...previous, kind: "syncing" }));
    try {
      for (let round = 0; round < 200; round += 1) {
        const current = clientRef.current;
        const edits = canEdit ? sendBatch(current.state.pending) : [];
        let result: { status: number; json: unknown };
        try {
          result = await clubRequest(`${base}/sync`, "POST", { formatVersion: 1, clientId: current.clientId, since: current.state.seq, edits });
        } catch { setSync({ kind: "offline", at: Date.now() }); return; }
        if (result.status !== 200) { setSync({ kind: "error", status: result.status, at: Date.now() }); return; }
        const response = result.json as MapProjectSyncResponse;
        const latest = clientRef.current;
        const acked = acknowledge(latest.state, response.results as EditResult[]);
        if (acked.conflicted.length) setNotice("conflict");
        if (acked.rejected.length) setNotice("rejected");
        if (acked.proposed.length) setNotice("proposed");
        const merged = keepOpenProposals(mergePulled(acked.state, response.objects as ServerObject[], response.seq), response.openProposals ?? []);
        if (edits.length > 0 || response.objects.length > 0) syncedRef.current?.(acked.proposed.length > 0);
        store({ ...latest, state: merged });
        // Mer att hämta, eller egna ändringar som kom till under tiden (eller inte fick plats): en omgång till.
        const sent = new Set(edits.map(edit => edit.editId));
        const unsent = canEdit && response.status === "OPEN" && merged.pending.some(edit => !sent.has(edit.editId));
        if (!response.more && !unsent) break;
      }
      setSync({ kind: "idle", at: Date.now() });
    } finally {
      syncing.current = false;
      if (again.current) { again.current = false; void syncNow(); }
    }
  }, [base, canEdit, store]);

  const sendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleSend = useCallback(() => {
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => void syncNow(), SEND_DELAY_MS);
  }, [syncNow]);

  const ready = !!client;
  useEffect(() => {
    if (!ready) return;
    void syncNow();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void syncNow(); }, POLL_MS);
    const online = () => void syncNow();
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", online);
    return () => { clearInterval(timer); window.removeEventListener("online", online); document.removeEventListener("visibilitychange", online); };
  }, [ready, syncNow]);
  useEffect(() => () => { if (sendTimer.current) clearTimeout(sendTimer.current); }, []);

  /** En egen ändring: i kön, i historiken (Ångra) och snart till servern. Falskt när objektet väntar på ett val efter en krock. */
  const commit = useCallback((change: ObjectChange): boolean => {
    const current = clientRef.current;
    if (!current || !canEdit) return false;
    const before = effectiveState(current.state, change.key);
    const added = addEdit(current.state, { editId: crypto.randomUUID(), key: change.key, ref: change.ref, state: change.after, kind: change.kind,
      at: new Date().toISOString(), ...(change.point ? { point: change.point } : {}) });
    if (!added) { setNotice("conflictFirst"); return false; }
    const nextHistory = recordStep(historyRef.current, { key: change.key, ref: change.ref, before, after: change.after, ...(change.group ? { group: change.group } : {}) });
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    store({ ...current, state: added.state });
    scheduleSend();
    return true;
  }, [canEdit, store, scheduleSend]);

  /**
   * Många egna ändringar på en gång (en inläst grundkarta): allt i kön och i historiken som en grupp, sparat en gång. Ger
   * antalet som kom med (ett objekt som väntar på ett val efter en krock hoppas över).
   */
  const commitMany = useCallback((changes: readonly ObjectChange[]): number => {
    const current = clientRef.current;
    if (!current || !canEdit || changes.length === 0) return 0;
    const group = crypto.randomUUID(), at = new Date().toISOString();
    let state = current.state;
    const steps = [];
    for (const change of changes) {
      const before = effectiveState(state, change.key);
      const added = addEdit(state, { editId: crypto.randomUUID(), key: change.key, ref: change.ref, state: change.after, kind: change.kind, at });
      if (!added) continue;
      state = added.state;
      steps.push({ key: change.key, ref: change.ref, before, after: change.after, group });
    }
    if (steps.length === 0) return 0;
    historyRef.current = recordSteps(historyRef.current, steps);
    setHistory(historyRef.current);
    store({ ...current, state });
    scheduleSend();
    return steps.length;
  }, [canEdit, store, scheduleSend]);

  const step = useCallback((direction: "undo" | "redo") => {
    const current = clientRef.current;
    if (!current || !canEdit) return;
    const run = direction === "undo" ? undoStep : redoStep;
    const top = (history: RevisionHistory) => (direction === "undo" ? history.undo : history.redo).at(-1);
    // Steg i samma grupp (flera objekt flyttade på en gång) tas tillsammans.
    const group = top(historyRef.current)?.group;
    let state = current.state, changed = false, any = false;
    do {
      const outcome = run(state, historyRef.current, crypto.randomUUID(), new Date().toISOString());
      if (outcome.kind === "empty") break;
      historyRef.current = outcome.history;
      if (outcome.kind === "changed") changed = true; else { state = outcome.state; any = true; }
    } while (group && top(historyRef.current)?.group === group);
    setHistory(historyRef.current);
    if (changed) setNotice("changedByOther");
    if (!any) return;
    store({ ...current, state });
    scheduleSend();
  }, [canEdit, store, scheduleSend]);

  const resolve = useCallback((key: ObjectKey, keep: "MINE" | "THEIRS") => {
    const current = clientRef.current;
    if (!current) return;
    const resolved = resolveConflict(current.state, key, keep, crypto.randomUUID(), new Date().toISOString());
    store({ ...current, state: resolved.state });
    scheduleSend();
  }, [store, scheduleSend]);

  /** Kandidaterna från en inläsning ritas med sina symboler ovanpå kartan (tom lista tar bort dem). */
  const shownCandidates = useRef<readonly MapObject[]>([]);
  const showCandidates = useCallback((objects: readonly MapObject[]) => {
    if (!session || (objects.length === 0 && shownCandidates.current.length === 0)) return;
    shownCandidates.current = objects;
    session.candidates(objects);
    setRenderKey(value => value + 1);
  }, [session]);
  /** Rita kartan med de här färgändringarna (utan att spara dem). Symbolernas rutor i panelen ritas också om. */
  const showColors = useCallback((changes: readonly MapColorChange[]) => {
    if (!session) return;
    session.colors(changes);
    session.catalog(setCatalog);
    setRenderKey(value => value + 1);
  }, [session]);
  /** Spara färgändringarna i projektet (ägarna); kartan ritas med dem. Falskt när servern säger nej. */
  const saveColors = useCallback(async (changes: readonly MapColorChange[]): Promise<boolean> => {
    const result = await clubRequest(base, "PUT", { formatVersion: 1, colors: changes }).catch(() => ({ status: 0 }));
    if (result.status !== 200 && result.status !== 204) return false;
    setColorChanges(changes);
    showColors(changes);
    return true;
  }, [base, showColors]);

  /** Rita kartan med de här symbolfärgerna (utan att spara dem); symbolernas rutor i panelen ritas också om. */
  const showSymbolColors = useCallback((changes: readonly MapSymbolColorChange[]) => {
    if (!session) return;
    session.symbolColors(changes);
    session.catalog(setCatalog);
    setRenderKey(value => value + 1);
  }, [session]);
  /** Spara symbolfärgerna i projektet (ägarna); kartan ritas med dem. Falskt när servern säger nej. */
  const saveSymbolColors = useCallback(async (changes: readonly MapSymbolColorChange[]): Promise<boolean> => {
    const result = await clubRequest(base, "PUT", { formatVersion: 1, symbolColors: changes }).catch(() => ({ status: 0 }));
    if (result.status !== 200 && result.status !== 204) return false;
    setSymbolColorChanges(changes);
    showSymbolColors(changes);
    return true;
  }, [base, showSymbolColors]);

  /** Symbollistans färgbyte (ägaren 2026-11-13): kartans färger med projektets ändringar, de sparade byten och vad som får ändras. */
  const symbolColors = useMemo<SymbolColorsControl>(() => ({ colors: withColorChanges(colors, colorChanges), saved: symbolColorChanges,
    canChange: view.viewer.canDecide, ocad: view.base.format === "OCD", onShow: showSymbolColors, onSave: saveSymbolColors }),
  [colors, colorChanges, symbolColorChanges, view.viewer.canDecide, view.base.format, showSymbolColors, saveSymbolColors]);

  return {
    colorChanges, showColors, saveColors, symbolColors, showCandidates,
    session, bounds, colors, georeference, northLines, scale, mapStatus, catalog, renderKey, sync, notice, setNotice,
    state: client?.state, history, commit, commitMany, undo: () => step("undo"), redo: () => step("redo"), resolve, syncNow,
    /** Objekten som dras (ritas inte av Workern medan förhandsvisningen syns ovanpå). */
    setPreview
  };
}
