"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bingoProgressResponseSchema, type BingoGroup, type BingoMode } from "@o-tid/contracts";
import { bingoStep, chooseShotFix, SHIP_RULES, type BingoRunState } from "@o-tid/domain";
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
export function useBingoRun({ raceId, mode, groups, georeference, mapScale }: {
  raceId: string; mode: BingoMode; groups: readonly BingoGroup[]; georeference: MapGeoreference | null; mapScale: number;
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
  // Sänka skepp: ingen kontinuerlig GPS och ingen Wake Lock (telefonen får vara låst mellan skotten).
  const tracking = running && mode === "BINGO";
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
    if (!tracking) { void wakeLock.current?.release().catch(() => undefined); wakeLock.current = undefined; return; }
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
  }, [tracking, lockScreen]);

  // GPS medan loppet pågår.
  useEffect(() => {
    if (!tracking || !group) return;
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
  }, [tracking, group, georeference, mapScale, commit]);

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
      if (latest && receipt.runnerId === latest.runnerId) {
        // Servern behåller det första fröet; telefonen följer det (samma skepp som ledaren ser).
        const seed = receipt.seed !== undefined && latest.seed !== undefined ? receipt.seed : latest.seed;
        commit({ ...latest, acked: Math.max(latest.acked, version), ...(seed !== undefined ? { seed } : {}) }, true);
        setSyncProblem(false);
      }
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
    if (mode === "BINGO") void lockScreen();
    const seed = mode === "SHIPS" ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! : undefined;
    const next = newBingoRun(name, course, Date.now(), globalThis.crypto.randomUUID(), seed);
    commit(next, true);
    setResumed(false);
    void sync();
  }, [commit, lockScreen, sync, mode]);

  const end = useCallback((status: "FINISHED" | "ABANDONED") => {
    const current = runRef.current;
    if (!current || current.status !== "RUNNING") return;
    commit({ ...current, status, finishedAt: Date.now(), version: current.version + 1 }, true);
    void sync();
  }, [commit, sync]);

  /**
   * Sänka skepp: en position för skottet. Väntar upp till 20 s på noggrannhet ≤ 20 m; ger den bästa noggrannheten om ingen
   * räckte. Skottet sparas (och skickas) bara med en tillräckligt noggrann position.
   */
  const [aiming, setAiming] = useState<{ cell: string; since: number }>();
  // Sänka skepp: GPS:en värms upp så fort sidan syns under loppet och stoppas när den döljs (ägaren 2026-11-16).
  const fixes = useRef<{ latitude: number; longitude: number; accuracyM: number; receivedAt: number }[]>([]);
  const warmup = useRef(0);
  const [shipGps, setShipGps] = useState<{ accuracy: number | undefined; ready: boolean }>({ accuracy: undefined, ready: false });
  const aimingShips = running && mode === "SHIPS";
  useEffect(() => {
    if (!aimingShips || !("geolocation" in navigator) || !window.isSecureContext) return;
    let id: number | undefined;
    const stop = () => { if (id !== undefined) navigator.geolocation.clearWatch(id); id = undefined; fixes.current = []; };
    const begin = () => {
      if (id !== undefined) return;
      warmup.current = Date.now();
      fixes.current = [];
      setShipGps({ accuracy: undefined, ready: false });
      id = navigator.geolocation.watchPosition(position => {
        const now = Date.now();
        fixes.current = [...fixes.current.slice(-9), { latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy, receivedAt: now }];
        setShipGps({ accuracy: Math.round(position.coords.accuracy), ready: chooseShotFix(fixes.current, now, warmup.current) !== undefined });
      }, failure => { if (failure.code === failure.PERMISSION_DENIED) setProblem("denied"); }, { enableHighAccuracy: true, maximumAge: 0 });
    };
    const visibility = () => { if (document.visibilityState === "visible") begin(); else stop(); };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    // Färskheten: «du kan skjuta» släcks när positionen blir äldre än 2 s.
    const tick = window.setInterval(() => setShipGps(current => {
      const ready = chooseShotFix(fixes.current, Date.now(), warmup.current) !== undefined;
      return current.ready === ready ? current : { ...current, ready };
    }), 1000);
    return () => { document.removeEventListener("visibilitychange", visibility); window.clearInterval(tick); stop(); };
  }, [aimingShips]);

  /**
   * Sänka skepp: positionen för skottet. En färsk (högst 2 s), noggrann (≤ 20 m) position som inte kom direkt efter
   * upplåsningen (`chooseShotFix`); annars väntar telefonen upp till 20 s. Ger den bästa noggrannheten om ingen räckte.
   */
  const shoot = useCallback(async (cell: string): Promise<{ ok: true } | { ok: false; accuracyM: number | undefined }> => {
    void sound.current.unlock();
    if (!georeference) { setProblem("noGeoreference"); return { ok: false, accuracyM: undefined }; }
    if (!window.isSecureContext) { setProblem("insecure"); return { ok: false, accuracyM: undefined }; }
    if (!("geolocation" in navigator)) { setProblem("noGeolocation"); return { ok: false, accuracyM: undefined }; }
    const pressed = Date.now();
    setAiming({ cell, since: pressed });
    let fix = chooseShotFix(fixes.current, Date.now(), warmup.current);
    while (!fix && Date.now() - pressed < SHIP_RULES.shotWaitSeconds * 1000) {
      await new Promise(resolve => window.setTimeout(resolve, 250));
      fix = chooseShotFix(fixes.current, Date.now(), warmup.current);
    }
    setAiming(undefined);
    if (!fix) {
      const recent = fixes.current.filter(item => item.receivedAt >= pressed).map(item => item.accuracyM);
      return { ok: false, accuracyM: recent.length > 0 ? Math.round(Math.min(...recent)) : undefined };
    }
    let at;
    try { at = wgs84ToMapPoint(georeference, { latitude: fix.latitude, longitude: fix.longitude }); }
    catch (error) { console.error("Positionen kunde inte räknas om till kartan", error); setProblem("noGeoreference"); return { ok: false, accuracyM: undefined }; }
    setProblem(undefined);
    const current = runRef.current;
    if (!current || current.status !== "RUNNING") return { ok: false, accuracyM: undefined };
    const shot = { cell, at: Date.now(), x: at.x, y: at.y, accuracyM: fix.accuracyM };
    commit({ ...current, shots: [...(current.shots ?? []), shot], version: current.version + 1 }, true);
    void sync();
    return { ok: true };
  }, [georeference, commit, sync]);

  /** Pling och vibration (träff i Sänka skepp). */
  const ping = useCallback(() => {
    sound.current.play("ok");
    try { navigator.vibrate?.([120, 60, 120]); } catch { /* vibration finns inte i alla webbläsare (iPhone) */ }
  }, []);

  const reset = useCallback(() => { runRef.current = undefined; setRun(undefined); setLastTaken(undefined); setGapNotice(undefined); }, []);

  return { shipGps, run, group, resumed, storageFailed, problem, accuracy, lastTaken, gapNotice, wakeLockFailed, syncProblem, start, end, reset, sync, shoot, aiming,
    ping, metersPerMm: georeference ? metersPerMm(georeference, mapScale) : mapScale / 1000 };
}
