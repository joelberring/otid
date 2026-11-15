"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bingoProgressResponseSchema, type VirtualCourseView, type VirtualSettings } from "@o-tid/contracts";
import { bingoStep, chooseShotFix, controlsInReach, judgePunches, SHIP_RULES, type VirtualCourse, type VirtualPunch } from "@o-tid/domain";
import { wgs84ToMapPoint, type MapGeoreference } from "@o-tid/map-file";
import { metersPerMm } from "../../lib/course-setting-geo";
import { bingoProgressRequest, newBingoRun, readBingoRun, saveBingoRun, type StoredBingoRun } from "../../lib/bingo-run";
import { ReadoutSound } from "../../readout/sound";
import type { GpsProblem } from "./use-bingo-run";

const SYNC_MS = 10_000;
type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
type Fix = { latitude: number; longitude: number; accuracyM: number; receivedAt: number };

/**
 * Loppet med virtuella kontroller i telefonen (ADR-0226). Automatiskt: GPS med tänd skärm (Wake Lock) som i bingon, och en
 * stämpling när en position ligger inom radien från nästa giltiga kontroll. Knapp: GPS:en värms upp när sidan syns, och
 * «Stämpla» tar en färsk position som i Sänka skepp. Samma lagring och kö med kvittens som bingon.
 */
export function useVirtualRun({ raceId, courses, settings, georeference, mapScale }: {
  raceId: string; courses: readonly VirtualCourseView[]; settings: VirtualSettings; georeference: MapGeoreference | null; mapScale: number;
}) {
  const [run, setRun] = useState<StoredBingoRun>();
  const [problem, setProblem] = useState<GpsProblem>();
  const [gps, setGps] = useState<{ accuracy: number | undefined; ready: boolean }>({ accuracy: undefined, ready: false });
  const [lastPunch, setLastPunch] = useState<{ code: string; at: number } | { missed: true; accuracy: number | undefined; at: number }>();
  const [stamping, setStamping] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const runRef = useRef<StoredBingoRun | undefined>(undefined);
  const sound = useRef(new ReadoutSound());
  const fixes = useRef<Fix[]>([]);
  const warmup = useRef(0);
  const sending = useRef(false);
  const perMm = georeference ? metersPerMm(georeference, mapScale) : mapScale / 1000;

  const commit = useCallback((next: StoredBingoRun, persist: boolean) => {
    runRef.current = next;
    if (persist) { if (!saveBingoRun(raceId, next)) setStorageFailed(true); setRun(next); }
  }, [raceId]);
  useEffect(() => {
    const stored = readBingoRun(raceId);
    if (stored?.punches) { runRef.current = stored; setRun(stored); }
  }, [raceId]);

  const view = run ? courses.find(course => course.course === run.group) : undefined;
  const course = useMemo<VirtualCourse | undefined>(() => view ? { order: view.order, controls: view.controls } : undefined, [view]);
  const judged = useMemo(() => course && run ? judgePunches(course, run.punches ?? [], run.startedAt, settings.radiusM, perMm) : [],
    [course, run, settings.radiusM, perMm]);
  const running = run?.status === "RUNNING";

  const ping = useCallback(() => {
    sound.current.play("ok");
    try { navigator.vibrate?.([120, 60, 120]); } catch { /* vibration finns inte i alla webbläsare (iPhone) */ }
  }, []);

  /** En position i kartans mm: stämplar närmaste kontroll inom radien som blir giltig (nästa i ordningen, eller ny). */
  const tryPunch = useCallback((fix: Fix): boolean => {
    const current = runRef.current;
    if (!current || current.status !== "RUNNING" || !course || !georeference) return false;
    let at;
    try { at = wgs84ToMapPoint(georeference, { latitude: fix.latitude, longitude: fix.longitude }); }
    catch (error) { console.error("Positionen kunde inte räknas om till kartan", error); setProblem("noGeoreference"); return false; }
    const position = { x: at.x, y: at.y, accuracyM: fix.accuracyM };
    const before = judgePunches(course, current.punches ?? [], current.startedAt, settings.radiusM, perMm);
    for (const control of controlsInReach(course, position, settings.radiusM, perMm)) {
      const punch: VirtualPunch = { control: control.id, at: fix.receivedAt, ...position };
      const after = judgePunches(course, [...(current.punches ?? []), punch], current.startedAt, settings.radiusM, perMm);
      if (after.length > before.length) {
        commit({ ...current, punches: [...(current.punches ?? []), punch], version: current.version + 1 }, true);
        setLastPunch({ code: control.code, at: Date.now() });
        ping();
        return true;
      }
    }
    return false;
  }, [course, georeference, settings.radiusM, perMm, commit, ping]);

  // GPS medan sidan syns under loppet: automatiskt stämplar den direkt; med knapp värms den bara upp. Spår och sträcka i båda.
  useEffect(() => {
    if (!running || !("geolocation" in navigator) || !window.isSecureContext) {
      if (running) setProblem(!window.isSecureContext ? "insecure" : "noGeolocation");
      return;
    }
    let id: number | undefined;
    let lock: WakeLockSentinelLike | undefined;
    const stop = () => { if (id !== undefined) navigator.geolocation.clearWatch(id); id = undefined; fixes.current = []; };
    const begin = () => {
      if (settings.punch === "AUTO") {
        const withLock = navigator as WakeLockNavigator;
        void withLock.wakeLock?.request("screen").then(sentinel => { lock = sentinel; }, (error: unknown) => console.warn("Skärmen kunde inte hållas tänd", error));
      }
      if (id !== undefined) return;
      warmup.current = Date.now();
      fixes.current = [];
      id = navigator.geolocation.watchPosition(position => {
        const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyM: position.coords.accuracy, receivedAt: Date.now() };
        fixes.current = [...fixes.current.slice(-9), fix];
        setProblem(undefined);
        setGps({ accuracy: Math.round(fix.accuracyM), ready: chooseShotFix(fixes.current, fix.receivedAt, warmup.current) !== undefined });
        const current = runRef.current;
        if (current && georeference) {
          try {
            const at = wgs84ToMapPoint(georeference, fix);
            const step = bingoStep(current.run, { x: at.x, y: at.y, accuracyM: fix.accuracyM, t: fix.receivedAt }, [], perMm);
            if (step.state.track !== current.run.track || step.state.distanceM !== current.run.distanceM) {
              commit({ ...current, run: step.state, version: current.version + 1 }, true);
            } else commit({ ...current, run: step.state }, false);
          } catch (error) { console.error("Positionen kunde inte räknas om till kartan", error); }
        }
        if (settings.punch === "AUTO" && fix.accuracyM <= SHIP_RULES.shotAccuracyM) tryPunch(fix);
      }, failure => setProblem(failure.code === failure.PERMISSION_DENIED ? "denied" : "positionFailed"), { enableHighAccuracy: true, maximumAge: 0 });
    };
    const visibility = () => { if (document.visibilityState === "visible") begin(); else { stop(); void lock?.release().catch(() => undefined); } };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); stop(); void lock?.release().catch(() => undefined); };
  }, [running, settings.punch, georeference, perMm, commit, tryPunch]);

  /** «Stämpla» (knapp): en färsk, noggrann position (`chooseShotFix`), annars väntar telefonen upp till 20 s. */
  const stamp = useCallback(async () => {
    void sound.current.unlock();
    setStamping(true);
    const pressed = Date.now();
    let fix = chooseShotFix(fixes.current, Date.now(), warmup.current);
    while (!fix && Date.now() - pressed < SHIP_RULES.shotWaitSeconds * 1000) {
      await new Promise(resolve => window.setTimeout(resolve, 250));
      fix = chooseShotFix(fixes.current, Date.now(), warmup.current);
    }
    setStamping(false);
    if (!fix || !tryPunch(fix)) {
      const recent = fixes.current.filter(item => item.receivedAt >= pressed).map(item => item.accuracyM);
      setLastPunch({ missed: true, accuracy: fix ? undefined : recent.length > 0 ? Math.round(Math.min(...recent)) : undefined, at: Date.now() });
    }
  }, [tryPunch]);

  // Kön mot servern: hela läget tills den senaste versionen är kvitterad.
  const sync = useCallback(async () => {
    const current = runRef.current;
    if (!current || current.acked >= current.version || sending.current) return;
    sending.current = true;
    const version = current.version;
    try {
      const response = await fetch(`/api/public/races/${encodeURIComponent(raceId)}/bingo`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(bingoProgressRequest(current)) });
      if (!response.ok) { console.warn("Läget togs inte emot", response.status); return; }
      const receipt = bingoProgressResponseSchema.parse(await response.json());
      const latest = runRef.current;
      if (latest && receipt.runnerId === latest.runnerId) commit({ ...latest, acked: Math.max(latest.acked, version) }, true);
    } catch (error) { console.warn("Läget kunde inte skickas; försöker igen", error); }
    finally { sending.current = false; }
  }, [raceId, commit]);
  useEffect(() => {
    if (!run || run.acked >= run.version) return;
    const timer = window.setInterval(() => void sync(), SYNC_MS);
    return () => window.clearInterval(timer);
  }, [run, sync]);
  useEffect(() => { if (lastPunch && "code" in lastPunch) void sync(); }, [lastPunch, sync]);

  const start = useCallback((name: string, courseId: string, duel: string | undefined, team: string | undefined) => {
    const audioSession = (navigator as AudioSessionNavigator).audioSession;
    if (audioSession) { try { audioSession.type = "playback"; } catch { /* finns inte i alla versioner */ } }
    void sound.current.unlock();
    const next: StoredBingoRun = { ...newBingoRun(name, courseId, Date.now(), globalThis.crypto.randomUUID()), punches: [],
      ...(duel ? { duel } : {}), ...(team ? { team } : {}) };
    commit(next, true);
    void sync();
  }, [commit, sync]);

  const end = useCallback((status: "FINISHED" | "ABANDONED") => {
    const current = runRef.current;
    if (!current || current.status !== "RUNNING") return;
    commit({ ...current, status, finishedAt: Date.now(), version: current.version + 1 }, true);
    void sync();
  }, [commit, sync]);

  const reset = useCallback(() => { runRef.current = undefined; setRun(undefined); setLastPunch(undefined); }, []);

  return { run, view, judged, problem, gps, lastPunch, stamping, storageFailed, start, end, reset, sync, stamp, ping };
}
