"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapProjectCheckList, MapProjectCheckView, MapProjectTrackList, MapProjectTrackPoints, MapProjectTrackView, MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import {
  areaProgress, checkStillValid, DEFAULT_RECON, type AreaProgress, type ObjectKey, type ReconSettings, type RevisionClientState, type TrackPoint
} from "@o-tid/map-revision";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import type { MapProjectSession, ReconResult } from "../../lib/map-project-protocol";
import {
  closeParts, deleteLocalTrack, localPoints, localTracks, putLocalTrack, trackFull, type LocalTrack
} from "../../lib/map-project-track-store";
import { joinSegments, parseGpx, trackOnMap, trackParts, type RawPoint } from "../../lib/map-project-tracks";
import { MAX_RECORD_ACCURACY_M, type TimedFix } from "./use-map-project-position";

/** Spåren och bekräftelserna hämtas igen så här ofta (när sidan syns); telefonens spår skickas lika ofta. */
const POLL_MS = 15_000;
/** Statusen räknas om en stund efter den senaste ändringen. */
const RECOMPUTE_MS = 400;
/** Under inspelningen sparas punkterna i telefonen med det här mellanrummet (och när sidan göms). */
const SAVE_EVERY_MS = 5000;

export type ReconLayer = "STATUS" | "COVERAGE" | "TRACKS";

/**
 * ADR-0219 tillägget om rekningen (K3): rekningen i editorn. Projektets spår (servern och telefonens som ännu inte skickats),
 * inspelningen i fält, GPX-filer, bekräftelserna och statusen och täckningen som Workern räknar (`reconMarkers`,
 * `coverageGrid`). En bekräftelse gäller bara så länge objektet inte ändrats (`checkStillValid`).
 */
export function useMapProjectRecon(input: { view: MapProjectView; session: MapProjectSession | undefined; georeference: MapGeoreference | null;
  clientState: RevisionClientState | undefined; renderKey: number }) {
  const { view, session, georeference, clientState, renderKey } = input;
  const base = mapProjectBase(view.projectId);
  const accountId = view.viewer.accountId;
  // Sparade inställningar gäller direkt (sidans projekt läses inte om).
  const [saved, setSaved] = useState<ReconSettings | null | undefined>(undefined);
  const settings: ReconSettings = (saved === undefined ? view.recon : saved) ?? DEFAULT_RECON;
  const [layers, setLayers] = useState<ReadonlySet<ReconLayer>>(new Set());
  const [serverTracks, setServerTracks] = useState<readonly MapProjectTrackView[]>([]);
  const [points, setPoints] = useState<ReadonlyMap<string, { updatedAt: string; points: RawPoint[] }>>(new Map());
  const pointsRef = useRef(points);
  const [local, setLocal] = useState<readonly LocalTrack[]>([]);
  const [checks, setChecks] = useState<ReadonlyMap<ObjectKey, MapProjectCheckView>>(new Map());
  const [result, setResult] = useState<ReconResult>();
  const [problem, setProblem] = useState<string>();
  const recordingRef = useRef<LocalTrack | undefined>(undefined);
  const [recording, setRecording] = useState<LocalTrack>();
  const canRecord = view.viewer.canPropose || view.viewer.canEdit;

  const loadServer = useCallback(async () => {
    try {
      const [listed, checked] = await Promise.all([clubRequest(`${base}/tracks`), clubRequest(`${base}/checks`)]);
      if (checked.status === 200) setChecks(new Map((checked.json as MapProjectCheckList).checks.map(check => [check.key, check])));
      if (listed.status !== 200) return;
      const tracks = (listed.json as MapProjectTrackList).tracks;
      setServerTracks(tracks);
      // Punkterna för spår som är nya eller ändrade sedan sist; spår som tagits bort försvinner.
      const known = new Set(tracks.map(track => track.trackId));
      pointsRef.current = new Map([...pointsRef.current].filter(([id]) => known.has(id)));
      setPoints(pointsRef.current);
      for (const track of tracks) {
        if (pointsRef.current.get(track.trackId)?.updatedAt === track.updatedAt || track.pointCount === 0) continue;
        void clubRequest(`${base}/tracks/${encodeURIComponent(track.trackId)}`).then(response => {
          if (response.status !== 200) return;
          const loaded = (response.json as MapProjectTrackPoints).points;
          pointsRef.current = new Map(pointsRef.current).set(track.trackId, { updatedAt: track.updatedAt, points: loaded });
          setPoints(pointsRef.current);
        }).catch(() => undefined);
      }
    } catch { /* Utan nät: det som visas står kvar. */ }
  }, [base]);

  const loadLocal = useCallback(async () => {
    try { setLocal(await localTracks(view.projectId, accountId)); } catch { setLocal([]); }
  }, [view.projectId, accountId]);

  /** Telefonens spår till servern, del för del; ett spår tas bort ur telefonen först när servern har allt. */
  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const stored of await localTracks(view.projectId, accountId)) {
        let track = stored.trackId === recordingRef.current?.trackId ? recordingRef.current : stored;
        if (!track.created) {
          const created = await clubRequest(`${base}/tracks`, "POST", { formatVersion: 1, trackId: track.trackId, name: track.name, source: track.source,
            startedAt: track.startedAt });
          if (created.status !== 200 && created.status !== 201) { await putLocalTrack({ ...track, problem: created.status }); continue; }
          track = { ...track, created: true, problem: undefined };
        }
        while (track.sent < track.parts.length) {
          const seq = track.sent;
          const last = seq === track.parts.length - 1 && track.endedAt !== undefined;
          const sent = await clubRequest(`${base}/tracks/${encodeURIComponent(track.trackId)}/parts`, "POST", { formatVersion: 1, seq,
            points: track.parts[seq], ...(last ? { endedAt: track.endedAt } : {}) });
          if (sent.status !== 200) { track = { ...track, problem: sent.status }; break; }
          track = { ...track, sent: seq + 1, problem: undefined };
        }
        // Inspelningen kan ha fått nya punkter under tiden: dess eget läge vinner, med det som skickats.
        if (recordingRef.current?.trackId === track.trackId) {
          const sentNow = track.sent, created = track.created;
          recordingRef.current = { ...recordingRef.current, sent: sentNow, created, problem: track.problem };
          track = recordingRef.current;
          setRecording(track);
        }
        if (track.endedAt !== undefined && track.sent >= track.parts.length && track.created) await deleteLocalTrack(track.trackId);
        else await putLocalTrack(track);
      }
    } catch { /* Utan nät: nästa försök. */ }
    finally { flushing.current = false; }
    await loadLocal();
    await loadServer();
  }, [base, view.projectId, accountId, loadLocal, loadServer]);

  useEffect(() => {
    void loadLocal().then(() => flush());
    const timer = setInterval(() => { if (document.visibilityState === "visible") void flush(); }, POLL_MS);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => { clearInterval(timer); window.removeEventListener("online", online); };
  }, [loadLocal, flush]);

  // Inspelningen: punkterna samlas i minnet och sparas i telefonen var femte sekund och när sidan göms.
  const lastSave = useRef(0);
  const saveRecording = useCallback(async (force = false) => {
    const track = recordingRef.current;
    if (!track || (!force && Date.now() - lastSave.current < SAVE_EVERY_MS)) return;
    lastSave.current = Date.now();
    await putLocalTrack(track).catch(() => setProblem("noStore"));
  }, []);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") void saveRecording(true); };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [saveRecording]);

  const onFix = useCallback((fix: TimedFix) => {
    const track = recordingRef.current;
    if (!track || fix.accuracyM > MAX_RECORD_ACCURACY_M) return;
    const seconds = Math.max(0, (fix.at - Date.parse(track.startedAt)) / 1000);
    let next = closeParts({ ...track, open: [...track.open, [fix.latitude, fix.longitude, Math.round(seconds), Math.round(fix.accuracyM)]] }, false);
    if (trackFull(next)) { next = closeParts({ ...next, endedAt: new Date().toISOString() }, true); recordingRef.current = undefined; setRecording(undefined);
      setProblem("trackFull"); void putLocalTrack(next).then(() => flush()); return; }
    const closed = next.parts.length > track.parts.length;
    recordingRef.current = next;
    setRecording(next);
    void saveRecording(closed);
    if (closed) void flush();
  }, [saveRecording, flush]);

  const startRecording = useCallback(async (name: string) => {
    const track: LocalTrack = { trackId: crypto.randomUUID(), projectId: view.projectId, accountId, name, source: "FIELD",
      startedAt: new Date().toISOString(), parts: [], open: [], sent: 0, created: false };
    recordingRef.current = track;
    setRecording(track);
    setLayers(current => new Set([...current, "TRACKS"]));
    lastSave.current = Date.now();
    await putLocalTrack(track).catch(() => setProblem("noStore"));
    void flush();
  }, [view.projectId, accountId, flush]);

  const stopRecording = useCallback(async () => {
    const track = recordingRef.current;
    if (!track) return;
    recordingRef.current = undefined;
    setRecording(undefined);
    const ended = closeParts({ ...track, endedAt: new Date().toISOString() }, true);
    if (ended.parts.length === 0 && !ended.created) { await deleteLocalTrack(ended.trackId).catch(() => undefined); await loadLocal(); return; }
    await putLocalTrack(ended).catch(() => setProblem("noStore"));
    await flush();
  }, [flush, loadLocal]);

  const importGpx = useCallback(async (file: File) => {
    setProblem(undefined);
    let parsed;
    try { parsed = parseGpx(await file.text()); } catch { setProblem("gpx"); return; }
    const parts = trackParts(joinSegments(parsed.segments));
    if (parts.length === 0) { setProblem("gpxEmpty"); return; }
    const name = (parsed.name ?? file.name.replace(/\.gpx$/i, "")).trim().slice(0, 80) || "GPX";
    const now = new Date().toISOString();
    await putLocalTrack({ trackId: crypto.randomUUID(), projectId: view.projectId, accountId, name, source: "GPX", startedAt: parsed.startedAt ?? now,
      parts, open: [], sent: 0, created: false, endedAt: now }).catch(() => setProblem("noStore"));
    setLayers(current => new Set([...current, "TRACKS", "STATUS"]));
    await flush();
  }, [view.projectId, accountId, flush]);

  const removeTrack = useCallback(async (trackId: string) => {
    const stored = local.find(track => track.trackId === trackId);
    if (!stored || stored.created) {
      const response = await clubRequest(`${base}/tracks/${encodeURIComponent(trackId)}`, "DELETE").catch(() => ({ status: 0, json: undefined }));
      if (response.status !== 200 && response.status !== 404) { setProblem(String(response.status)); return; }
    }
    if (stored) await deleteLocalTrack(trackId).catch(() => undefined);
    await loadLocal();
    await loadServer();
  }, [base, local, loadLocal, loadServer]);

  const renameTrack = useCallback(async (trackId: string, name: string) => {
    const response = await clubRequest(`${base}/tracks/${encodeURIComponent(trackId)}`, "PUT", { formatVersion: 1, name }).catch(() => ({ status: 0, json: undefined }));
    if (response.status !== 200) setProblem(String(response.status));
    await loadServer();
  }, [base, loadServer]);

  /** Bekräftelserna som fortfarande gäller (objektet inte ändrat sedan, varken på servern eller i kön). */
  const validChecks = useMemo(() => {
    const pending = new Set(clientState?.pending.map(edit => edit.key) ?? []);
    const out = new Set<ObjectKey>();
    for (const [key, check] of checks) {
      if (checkStillValid(check.basis, clientState?.server[key]?.lastEditId ?? null, pending.has(key))) out.add(key);
    }
    return out;
  }, [checks, clientState]);

  /** Bekräfta (`true`) eller ta bort bekräftelsen för objekten; basen är objektets senaste ändring som telefonen känner till. */
  const setChecked = useCallback(async (keys: readonly ObjectKey[], checked: boolean) => {
    if (keys.length === 0) return true;
    const body = checked ? { formatVersion: 1, set: keys.map(key => ({ key, basis: clientState?.server[key]?.lastEditId ?? null })) }
      : { formatVersion: 1, clear: keys };
    const response = await clubRequest(`${base}/checks`, "POST", body).catch(() => ({ status: 0, json: undefined }));
    if (response.status !== 200) { setProblem(String(response.status)); return false; }
    await loadServer();
    return true;
  }, [base, clientState, loadServer]);

  // Spåren i kartans mm.
  const trackLines = useMemo(() => {
    if (!georeference) return { others: [] as TrackPoint[][], recording: undefined as TrackPoint[] | undefined };
    const shownLocal = local.filter(track => track.trackId !== recording?.trackId && !serverTracks.some(row => row.trackId === track.trackId && row.endedAt));
    const lines = [...[...points.values()].map(entry => entry.points), ...shownLocal.map(localPoints)].map(line => trackOnMap(line, georeference));
    return { others: lines, recording: recording ? trackOnMap(localPoints(recording), georeference) : undefined };
  }, [georeference, points, local, serverTracks, recording]);

  // Statusen och täckningen räknas när lagren visas.
  const wanted = layers.has("STATUS") || layers.has("COVERAGE");
  useEffect(() => {
    if (!session || !wanted) return;
    const timer = setTimeout(() => {
      const tracks = [...trackLines.others, ...(trackLines.recording ? [trackLines.recording] : [])];
      session.recon({ tracks, checked: [...validChecks], settings }, setResult);
    }, RECOMPUTE_MS);
    return () => clearTimeout(timer);
  }, [session, wanted, trackLines, validChecks, settings, renderKey]);

  const progress = useMemo(() => {
    const out = new Map<string, AreaProgress>();
    if (!result) return out;
    for (const area of view.areas) out.set(area.areaId, areaProgress(area.polygon, result.coverage, result.markers));
    return out;
  }, [result, view.areas]);

  const saveSettings = useCallback(async (next: ReconSettings | null) => {
    const response = await clubRequest(base, "PUT", { formatVersion: 1, recon: next }).catch(() => ({ status: 0, json: undefined }));
    if (response.status !== 200) { setProblem(String(response.status)); return false; }
    setSaved(next);
    return true;
  }, [base]);

  const toggleLayer = (layer: ReconLayer) => setLayers(current => {
    const next = new Set(current);
    if (next.has(layer)) next.delete(layer); else next.add(layer);
    return next;
  });

  return {
    settings, saveSettings, layers, toggleLayer, serverTracks, local, recording, canRecord, startRecording, stopRecording, onFix, importGpx, removeTrack, renameTrack,
    checks, validChecks, setChecked, result: wanted ? result : undefined, trackLines, progress, problem, setProblem
  };
}
