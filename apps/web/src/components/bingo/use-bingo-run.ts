"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bingoProgressResponseSchema, type BingoGroup } from "@o-tid/contracts";
import { bingoStep, type BingoRunState } from "@o-tid/domain";
import { wgs84ToMapPoint, type MapGeoreference } from "@o-tid/map-file";
import { metersPerMm } from "../../lib/course-setting-geo";
import { bingoProgressRequest, newBingoRun, readBingoRun, saveBingoRun, type StoredBingoRun } from "../../lib/bingo-run";
import { ReadoutSound } from "../../readout/sound";

const SYNC_MS = 10_000;
const GAP_MS = 30_000;

export type GpsProblem = "insecure" | "noGeolocation" | "denied" | "positionFailed" | "noGeoreference";

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

const changed = (a: BingoRunState, b: BingoRunState) => a.taken !== b.taken || a.track !== b.track || a.gaps !== b.gaps || a.distanceM !== b.distanceM;

/**
 * Loppet i telefonen (ADR-0225): anmälan, GPS (`watchPosition` med hög noggrannhet), reglerna i `bingoStep`, plinget, Wake
 * Lock och kön mot servern. Loppet sparas i localStorage vid varje ändring och skickas helt var tionde sekund tills servern
 * kvitterat den senaste versionen. Positionerna räknas bara medan sidan syns; ett uppehåll blir ett glapp.
 */
export function useBingoRun({ raceId, groups, georeference, mapScale }: {
  raceId: string; groups: readonly BingoGroup[]; georeference: MapGeoreference | null; mapScale: number;
}) {
  const [run, setRun] = useState<StoredBingoRun>();
  const [resumed, setResumed] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [problem, setProblem] = useState<GpsProblem>();
  const [accuracy, setAccuracy] = useState<number>();
  const [lastTaken, setLastTaken] = useState<{ cell: string; at: number }>();
  const [gapNotice, setGapNotice] = useState<readonly [number, number]>();
  const [wakeLockFailed, setWakeLockFailed] = useState(false);
  const [syncProblem, setSyncProblem] = useState(false);
  const runRef = useRef<StoredBingoRun | undefined>(undefined);
  const sound = useRef(new ReadoutSound());
  const wakeLock = useRef<WakeLockSentinelLike | undefined>(undefined);
  const hiddenAt = useRef<number | undefined>(undefined);
  const sending = useRef(false);

  const commit = useCallback((next: StoredBingoRun, persist: boolean) => {
    runRef.current = next;
    if (persist) { if (!saveBingoRun(raceId, next)) setStorageFailed(true); setRun(next); }
  }, [raceId]);

  useEffect(() => {
    const stored = readBingoRun(raceId);
    if (stored) { runRef.current = stored; setRun(stored); setResumed(stored.status === "RUNNING"); }
  }, [raceId]);

  const running = run?.status === "RUNNING";
  const group = run ? groups.find(item => item.course === run.group) : undefined;

  // Skärmen tänd (Wake Lock) medan loppet pågår; tas igen när sidan syns på nytt.
  const lockScreen = useCallback(async () => {
    const navigatorWithLock = navigator as WakeLockNavigator;
    if (!navigatorWithLock.wakeLock) { setWakeLockFailed(true); return; }
    try {
      if (wakeLock.current && !wakeLock.current.released) return;
      wakeLock.current = await navigatorWithLock.wakeLock.request("screen");
      setWakeLockFailed(false);
    } catch (error) { console.warn("Skärmen kunde inte hållas tänd", error); setWakeLockFailed(true); }
  }, []);
  useEffect(() => {
    if (!running) { void wakeLock.current?.release().catch(() => undefined); wakeLock.current = undefined; return; }
    void lockScreen();
    const visibility = () => {
      if (document.visibilityState === "hidden") { hiddenAt.current = Date.now(); return; }
      void lockScreen();
      void sound.current.unlock();
      const from = hiddenAt.current;
      hiddenAt.current = undefined;
      if (from !== undefined && Date.now() - from > GAP_MS) setGapNotice([from, Date.now()]);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [running, lockScreen]);

  // GPS medan loppet pågår.
  useEffect(() => {
    if (!running || !group) return;
    if (!georeference) { setProblem("noGeoreference"); return; }
    if (!window.isSecureContext) { setProblem("insecure"); return; }
    if (!("geolocation" in navigator)) { setProblem("noGeolocation"); return; }
    const perMm = metersPerMm(georeference, mapScale);
    const id = navigator.geolocation.watchPosition(position => {
      const current = runRef.current;
      if (!current || current.status !== "RUNNING") return;
      let at;
      try { at = wgs84ToMapPoint(georeference, { latitude: position.coords.latitude, longitude: position.coords.longitude }); }
      catch (error) { console.error("Positionen kunde inte räknas om till kartan", error); setProblem("noGeoreference"); return; }
      setProblem(undefined);
      setAccuracy(Math.round(position.coords.accuracy));
      const step = bingoStep(current.run, { x: at.x, y: at.y, accuracyM: position.coords.accuracy, t: position.timestamp || Date.now() },
        group.cells, perMm);
      const persist = changed(current.run, step.state);
      commit({ ...current, run: step.state, version: persist ? current.version + 1 : current.version }, persist);
      if (step.newlyTaken.length > 0) {
        sound.current.play("ok");
        try { navigator.vibrate?.([120, 60, 120]); } catch { /* vibration finns inte i alla webbläsare (iPhone) */ }
        setLastTaken({ cell: step.newlyTaken[step.newlyTaken.length - 1]!, at: Date.now() });
      }
    }, failure => setProblem(failure.code === failure.PERMISSION_DENIED ? "denied" : "positionFailed"),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [running, group, georeference, mapScale, commit]);

  // Kön mot servern: hela läget tills den senaste versionen är kvitterad.
  const sync = useCallback(async () => {
    const current = runRef.current;
    if (!current || current.acked >= current.version || sending.current) return;
    sending.current = true;
    const version = current.version;
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15_000);
      const response = await fetch(`/api/public/races/${encodeURIComponent(raceId)}/bingo`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bingoProgressRequest(current)), signal: controller.signal })
        .finally(() => window.clearTimeout(timer));
      if (!response.ok) { console.warn("Bingons läge togs inte emot", response.status); setSyncProblem(true); return; }
      const receipt = bingoProgressResponseSchema.parse(await response.json());
      const latest = runRef.current;
      if (latest && receipt.runnerId === latest.runnerId) { commit({ ...latest, acked: Math.max(latest.acked, version) }, true); setSyncProblem(false); }
    } catch (error) {
      console.warn("Bingons läge kunde inte skickas; försöker igen", error);
      setSyncProblem(true);
    } finally { sending.current = false; }
  }, [raceId, commit]);
  useEffect(() => {
    if (!run || run.acked >= run.version) return;
    const timer = window.setInterval(() => void sync(), SYNC_MS);
    return () => window.clearInterval(timer);
  }, [run, sync]);
  useEffect(() => {
    const online = () => void sync();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [sync]);

  /** Starta (användarens tryck): ljudet låses upp här, skärmen hålls tänd och loppet sparas direkt. */
  const start = useCallback(async (name: string, course: string) => {
    const audioSession = (navigator as AudioSessionNavigator).audioSession;
    // iPhone (Safari 17+): spela också när telefonen står på ljudlöst.
    if (audioSession) { try { audioSession.type = "playback"; } catch { /* finns inte i alla versioner */ } }
    void sound.current.unlock();
    void lockScreen();
    const next = newBingoRun(name, course, Date.now(), globalThis.crypto.randomUUID());
    commit(next, true);
    setResumed(false);
    void sync();
  }, [commit, lockScreen, sync]);

  const end = useCallback((status: "FINISHED" | "ABANDONED") => {
    const current = runRef.current;
    if (!current || current.status !== "RUNNING") return;
    commit({ ...current, status, finishedAt: Date.now(), version: current.version + 1 }, true);
    void sync();
  }, [commit, sync]);

  const reset = useCallback(() => { runRef.current = undefined; setRun(undefined); setLastTaken(undefined); setGapNotice(undefined); }, []);

  return { run, group, resumed, storageFailed, problem, accuracy, lastTaken, gapNotice, wakeLockFailed, syncProblem, start, end, reset, sync };
}
