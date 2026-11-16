"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bingoProgressResponseSchema, type VirtualCourseView, type VirtualSettings } from "@o-tid/contracts";
import { bingoStep, chooseShotFix, controlsInReach, judgePunches, SHIP_RULES, type VirtualCourse, type VirtualPunch } from "@o-tid/domain";
import { wgs84ToMapPoint, type MapGeoreference } from "@o-tid/map-file";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { metersPerMm } from "../../lib/course-setting-geo";
import { bingoProgressRequest, newBingoRun, readBingoRun, saveBingoRun, type StoredBingoRun } from "../../lib/bingo-run";
import { postThroughApp, trackingBridge } from "../../lib/otid-tracking";
import type { PositionFix } from "../../lib/position-source";
import { ReadoutSound } from "../../readout/sound";
import { useTexts } from "../language-provider";
import { pingOk, useAppTracking } from "./use-app-tracking";
import type { GpsProblem } from "./use-bingo-run";

const SYNC_MS = 10_000;
type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
/** `t` (positionens tid) finns bara för appens punkter; i webbläsaren gäller `receivedAt` som förut. */
type Fix = { latitude: number; longitude: number; accuracyM: number; receivedAt: number; t?: number };

/** Stämplingen som en position ger: närmaste kontroll inom radien som blir giltig (nästa i ordningen, eller ny). */
function punchAt(course: VirtualCourse, run: StoredBingoRun, position: { x: number; y: number; accuracyM: number }, at: number, radiusM: number,
  perMm: number): { punch: VirtualPunch; code: string } | undefined {
  const before = judgePunches(course, run.punches ?? [], run.startedAt, radiusM, perMm);
  for (const control of controlsInReach(course, position, radiusM, perMm)) {
    const punch: VirtualPunch = { control: control.id, at, ...position };
    const after = judgePunches(course, [...(run.punches ?? []), punch], run.startedAt, radiusM, perMm);
    if (after.length > before.length) return { punch, code: control.code };
  }
  return undefined;
}

/**
 * Loppet med virtuella kontroller i telefonen (ADR-0226). Automatiskt: GPS med tänd skärm (Wake Lock) som i bingon, och en
 * stämpling när en position ligger inom radien från nästa giltiga kontroll. Knapp: GPS:en värms upp när sidan syns, och
 * «Stämpla» tar en färsk position som i Sänka skepp. Samma lagring och kö med kvittens som bingon.
 *
 * I O-Tids app (ADR-0227) går spårningen hela loppet, även med låst skärm: punkterna ur appens journal ger spåret och den
 * automatiska stämplingen med punktens `t` som tid, ingen Wake Lock, läget skickas med appens `post`. I webbläsaren som förut.
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
  const lastSent = useRef(0);
  const appNotice = useTexts(bingoSv.runner, bingoEn.runner).appNotice.CONTROLS;
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
  const app = useAppTracking(run, true, appNotice);
  const { watch: watchApp, attempt: appAttempt, catchUp } = app;

  const ping = useCallback(() => pingOk(sound.current), []);

  /** En position i kartans mm: stämplar närmaste kontroll inom radien som blir giltig (nästa i ordningen, eller ny). */
  const tryPunch = useCallback((fix: Fix): boolean => {
    const current = runRef.current;
    if (!current || current.status !== "RUNNING" || !course || !georeference) return false;
    let at;
    try { at = wgs84ToMapPoint(georeference, { latitude: fix.latitude, longitude: fix.longitude }); }
    catch (error) { console.error("Positionen kunde inte räknas om till kartan", error); setProblem("noGeoreference"); return false; }
    const found = punchAt(course, current, { x: at.x, y: at.y, accuracyM: fix.accuracyM }, fix.t ?? fix.receivedAt, settings.radiusM, perMm);
    if (!found) return false;
    commit({ ...current, punches: [...(current.punches ?? []), found.punch], version: current.version + 1 }, true);
    setLastPunch({ code: found.code, at: Date.now() });
    ping();
    return true;
  }, [course, georeference, settings.radiusM, perMm, commit, ping]);

  // Kön mot servern: hela läget tills den senaste versionen är kvitterad.
  const sync = useCallback(async () => {
    const current = runRef.current;
    if (!current || current.acked >= current.version || sending.current) return;
    sending.current = true;
    lastSent.current = Date.now();
    const version = current.version;
    try {
      const path = `/api/public/races/${encodeURIComponent(raceId)}/bingo`;
      const post = trackingBridge()?.post;
      // I appen genom `post` (Android stryper webbvyns egna nätanrop i bakgrunden); samma adress, body och kvitto.
      const response = post ? await postThroughApp(post, path, JSON.stringify(bingoProgressRequest(current)), 15_000)
        : await fetch(path, { method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" }, body: JSON.stringify(bingoProgressRequest(current)) });
      if (!response.ok) { console.warn("Läget togs inte emot", response.status); return; }
      const receipt = bingoProgressResponseSchema.parse(await response.json());
      const latest = runRef.current;
      if (latest && receipt.runnerId === latest.runnerId) commit({ ...latest, acked: Math.max(latest.acked, version) }, true);
    } catch (error) { console.warn("Läget kunde inte skickas; försöker igen", error); }
    finally { sending.current = false; }
  }, [raceId, commit]);
  // I appen: spårningen hela loppet, även med låst skärm. Punkterna ur journalen ger spåret och (automatiskt) stämplingarna;
  // de som kommer just nu värmer också upp «Stämpla».
  useEffect(() => {
    const current = runRef.current;
    if (!running || !current || !trackingBridge()) return;
    const count = (batch: readonly PositionFix[], live: boolean) => {
      const before = runRef.current;
      const last = batch[batch.length - 1];
      if (!before || before.status !== "RUNNING" || !last) return;
      if (live) {
        fixes.current = [...fixes.current.slice(-9), last];
        setGps({ accuracy: Math.round(last.accuracyM), ready: chooseShotFix(fixes.current, Date.now(), warmup.current) !== undefined });
      }
      let next = before;
      let punched: string | undefined;
      for (const fix of batch) {
        if (!georeference) break;
        let at;
        try { at = wgs84ToMapPoint(georeference, fix); }
        catch (error) { console.error("Positionen kunde inte räknas om till kartan", error); setProblem("noGeoreference"); break; }
        const position = { x: at.x, y: at.y, accuracyM: fix.accuracyM };
        const step = bingoStep(next.run, { ...position, t: fix.t }, [], perMm);
        const moved = step.state.track !== next.run.track || step.state.distanceM !== next.run.distanceM;
        next = { ...next, run: step.state, lastSeq: fix.seq ?? next.lastSeq, version: moved ? next.version + 1 : next.version };
        const found = settings.punch === "AUTO" && course && fix.accuracyM <= SHIP_RULES.shotAccuracyM
          ? punchAt(course, next, position, fix.t, settings.radiusM, perMm) : undefined;
        if (found) { next = { ...next, punches: [...(next.punches ?? []), found.punch], version: next.version + 1 }; punched = found.code; }
      }
      setProblem(undefined);
      commit(next, next.version !== before.version);
      if (punched) { setLastPunch({ code: punched, at: Date.now() }); ping(); }
      // Timers stryps i bakgrunden: punkterna driver också sändningen (högst var tionde sekund).
      if (Date.now() - lastSent.current >= SYNC_MS) void sync();
    };
    warmup.current = Date.now();
    fixes.current = [];
    return watchApp(current, { onFixes: count });
  }, [running, settings.punch, settings.radiusM, course, georeference, perMm, commit, ping, sync, watchApp, appAttempt]);

  // GPS medan sidan syns under loppet: automatiskt stämplar den direkt; med knapp värms den bara upp. Spår och sträcka i båda.
  useEffect(() => {
    if (running && trackingBridge()) return;
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

  const end = useCallback(async (status: "FINISHED" | "ABANDONED") => {
    const finishedAt = Date.now();
    // I appen: punkterna fram till nu ur journalen först (spårningen stoppas när loppet är slut, `useAppTracking`).
    if (trackingBridge()) await catchUp();
    const current = runRef.current;
    if (!current || current.status !== "RUNNING") return;
    commit({ ...current, status, finishedAt, version: current.version + 1 }, true);
    void sync();
  }, [commit, sync, catchUp]);

  const reset = useCallback(() => { runRef.current = undefined; setRun(undefined); setLastPunch(undefined); }, []);

  return { run, view, judged, problem: app.problem ?? problem, gps, lastPunch, stamping, storageFailed, start, end, reset, sync, stamp, ping,
    restartGps: app.canRestart ? app.restart : undefined, inApp: app.inApp };
}
