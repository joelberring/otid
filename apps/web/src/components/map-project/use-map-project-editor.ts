"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAP_PROJECT_SYNC_MAX_EDITS, type MapProjectSyncResponse, type MapProjectView } from "@o-tid/contracts";
import type { MapColor, MapGeoreference, Point } from "@o-tid/map-file";
import {
  acknowledge, addEdit, effectiveObjects, effectiveState, emptyHistory, keepOpenProposals, mergePulled, recordStep, redoStep, resolveConflict, undoStep,
  type EditKind, type EditResult, type KeyedState, type ObjectKey, type ObjectRef, type ObjectState, type RevisionHistory, type ServerObject
} from "@o-tid/map-revision";
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
}

/**
 * ADR-0219 (K1): kartprojektets editor utan gränssnitt. Grundfilen hämtas (webbläsarens kartcache per sha256) och läses i
 * Workern; de egna ändringarna ligger i kön (`map-revision`) som sparas i IndexedDB efter varje ändring och skickas till servern
 * en stund efter den senaste. Andras ändringar hämtas var femte sekund medan sidan syns. Workern får alla ändrade objekt efter
 * varje ny ändring eller hämtning och ritar om (`renderKey`).
 */
export function useMapProjectEditor(view: MapProjectView, onSynced?: (proposed: boolean) => void) {
  const base = mapProjectBase(view.projectId);
  const [session, setSession] = useState<MapProjectSession>();
  const [bounds, setBounds] = useState<Bounds>();
  const [colors, setColors] = useState<readonly MapColor[]>([]);
  const [georeference, setGeoreference] = useState<MapGeoreference | null>(null);
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
      setBounds(loaded.objects === 0 && area ? areaBounds(area) : loaded.bounds); setColors(loaded.colors); setGeoreference(loaded.georeference); setMapStatus("ready");
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
      for (let round = 0; round < 20; round += 1) {
        const current = clientRef.current;
        const edits = canEdit ? current.state.pending.slice(0, MAP_PROJECT_SYNC_MAX_EDITS) : [];
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
    const nextHistory = recordStep(historyRef.current, { key: change.key, ref: change.ref, before, after: change.after });
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    store({ ...current, state: added.state });
    scheduleSend();
    return true;
  }, [canEdit, store, scheduleSend]);

  const step = useCallback((direction: "undo" | "redo") => {
    const current = clientRef.current;
    if (!current || !canEdit) return;
    const run = direction === "undo" ? undoStep : redoStep;
    const outcome = run(current.state, historyRef.current, crypto.randomUUID(), new Date().toISOString());
    if (outcome.kind === "empty") return;
    historyRef.current = outcome.history;
    setHistory(outcome.history);
    if (outcome.kind === "changed") { setNotice("changedByOther"); return; }
    store({ ...current, state: outcome.state });
    scheduleSend();
  }, [canEdit, store, scheduleSend]);

  const resolve = useCallback((key: ObjectKey, keep: "MINE" | "THEIRS") => {
    const current = clientRef.current;
    if (!current) return;
    const resolved = resolveConflict(current.state, key, keep, crypto.randomUUID(), new Date().toISOString());
    store({ ...current, state: resolved.state });
    scheduleSend();
  }, [store, scheduleSend]);

  return {
    session, bounds, colors, georeference, mapStatus, catalog, renderKey, sync, notice, setNotice,
    state: client?.state, history, commit, undo: () => step("undo"), redo: () => step("redo"), resolve, syncNow,
    /** Objekten som dras (ritas inte av Workern medan förhandsvisningen syns ovanpå). */
    setPreview
  };
}

/** Områdets omslutande rektangel med en tiondel marginal. */
function areaBounds(area: readonly (readonly { x: number; y: number }[])[]): Bounds {
  const points = area.flat();
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
  const margin = Math.max(maxX - minX, maxY - minY) * 0.1;
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}
