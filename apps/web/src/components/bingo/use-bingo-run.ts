"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bingoProgressResponseSchema, type BingoGroup, type BingoMode } from "@o-tid/contracts";
import { bingoStep, chooseShotFix, SHIP_RULES, type BingoRunState } from "@o-tid/domain";
import { wgs84ToMapPoint, type MapGeoreference } from "@o-tid/map-file";
import { bingoEn } from "../../i18n/bingo-en";
import { bingoSv } from "../../i18n/bingo-sv";
import { metersPerMm } from "../../lib/course-setting-geo";
import { bingoProgressRequest, newBingoRun, readBingoRun, saveBingoRun, type StoredBingoRun } from "../../lib/bingo-run";
import { postThroughApp, trackingBridge } from "../../lib/otid-tracking";
import { browserPositionSource, type PositionFix, type PositionProblem } from "../../lib/position-source";
import { ReadoutSound } from "../../readout/sound";
import { useTexts } from "../language-provider";
import { pingOk, useAppTracking } from "./use-app-tracking";

const SYNC_MS = 10_000;
const GAP_MS = 30_000;

export type GpsProblem = "insecure" | "noGeolocation" | "noGeoreference" | PositionProblem;

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

const changed = (a: BingoRunState, b: BingoRunState) => a.taken !== b.taken || a.track !== b.track || a.gaps !== b.gaps || a.distanceM !== b.distanceM;

/**
 * Loppet i telefonen (ADR-0225): anmälan, GPS (`watchPosition` med hög noggrannhet), reglerna i `bingoStep`, plinget, Wake
 * Lock och kön mot servern. Loppet sparas i localStorage vid varje ändring och skickas helt var tionde sekund tills servern
 * kvitterat den senaste versionen. Positionerna räknas bara medan sidan syns; ett uppehåll blir ett glapp.
 *
 * I O-Tids app (ADR-0227, läget Bingo) kommer positionerna från appens journal i stället: ingen Wake Lock, punkterna räknas
 * även när sidan inte syns (uppspelade när den syns igen), positionens tid är punktens `t`, läget skickas med appens `post`
 * och plinget går genom appen. I webbläsaren är allt som förut.
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
  const lastSent = useRef(0);
  const appNotice = useTexts(bingoSv.runner, bingoEn.runner).appNotice.BINGO;

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
  const app = useAppTracking(run, mode === "BINGO", appNotice);
  const { watch: watchApp, attempt: appAttempt } = app;

  // Skärmen tänd (Wake Lock) medan loppet pågår; tas igen när sidan syns på nytt.
  // `lockEpoch` räknas upp när låsningen släpps (sidan lämnas eller loppet slutar): en låsning som då är på väg släpps direkt.
  const lockEpoch = useRef(0);
  const lockScreen = useCallback(async () => {
    const navigatorWithLock = navigator as WakeLockNavigator;
    if (!navigatorWithLock.wakeLock) { setWakeLockFailed(true); return; }
    try {
      if (wakeLock.current && !wakeLock.current.released) return;
      const epoch = lockEpoch.current;
      const sentinel = await navigatorWithLock.wakeLock.request("screen");
      if (epoch !== lockEpoch.current) { void sentinel.release().catch(() => undefined); return; }
      wakeLock.current = sentinel;
      setWakeLockFailed(false);
    } catch (error) { console.warn("Skärmen kunde inte hållas tänd", error); setWakeLockFailed(true); }
  }, []);
  useEffect(() => {
    const release = () => { lockEpoch.current += 1; void wakeLock.current?.release().catch(() => undefined); wakeLock.current = undefined; };
    if (!tracking) { release(); return; }
    // I appen räknas positionerna med låst skärm: ingen Wake Lock och inget glapp för en dold sida.
    if (trackingBridge()) return;
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
    return () => { document.removeEventListener("visibilitychange", visibility); release(); };
  }, [tracking, lockScreen]);

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
      let response: Response;
      // I appen genom `post` (Android stryper webbvyns egna nätanrop i bakgrunden); samma adress, body och kvitto.
      if (post) response = await postThroughApp(post, path, JSON.stringify(bingoProgressRequest(current)), 15_000);
      else {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 15_000);
        response = await fetch(path, { method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" }, body: JSON.stringify(bingoProgressRequest(current)), signal: controller.signal })
          .finally(() => window.clearTimeout(timer));
      }
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
  /** Pling och vibration (en tagen ruta, träff i Sänka skepp). */
  const ping = useCallback(() => pingOk(sound.current), []);

  // GPS medan loppet pågår: appens journal i appen, annars webbläsarens `watchPosition` (som förut).
  useEffect(() => {
    if (!tracking || !group) return;
    if (!georeference) { setProblem("noGeoreference"); return; }
    const perMm = metersPerMm(georeference, mapScale);
    const count = (fixes: readonly PositionFix[]) => {
      const current = runRef.current;
      const last = fixes[fixes.length - 1];
      if (!current || current.status !== "RUNNING" || !last) return;
      let state = current.run;
      const newlyTaken: string[] = [];
      for (const fix of fixes) {
        let at;
        try { at = wgs84ToMapPoint(georeference, { latitude: fix.latitude, longitude: fix.longitude }); }
        catch (error) { console.error("Positionen kunde inte räknas om till kartan", error); setProblem("noGeoreference"); return; }
        const step = bingoStep(state, { x: at.x, y: at.y, accuracyM: fix.accuracyM, t: fix.t }, group.cells, perMm);
        state = step.state;
        newlyTaken.push(...step.newlyTaken);
      }
      setProblem(undefined);
      setAccuracy(Math.round(last.accuracyM));
      const persist = changed(current.run, state);
      commit({ ...current, run: state, version: persist ? current.version + 1 : current.version, ...(last.seq !== undefined ? { lastSeq: last.seq } : {}) },
        persist);
      if (newlyTaken.length > 0) {
        ping();
        setLastTaken({ cell: newlyTaken[newlyTaken.length - 1]!, at: Date.now() });
      }
      // I appen stryps timers i bakgrunden: punkterna driver också sändningen (högst var tionde sekund).
      if (last.seq !== undefined && Date.now() - lastSent.current >= SYNC_MS) void sync();
    };
    const stopApp = runRef.current ? watchApp(runRef.current, { onFixes: count }) : undefined;
    if (stopApp) return stopApp;
    if (!window.isSecureContext) { setProblem("insecure"); return; }
    if (!("geolocation" in navigator)) { setProblem("noGeolocation"); return; }
    const watch = browserPositionSource({ enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 }).watch({ onFixes: count, onProblem: setProblem });
    return () => watch.stop();
  }, [tracking, group, georeference, mapScale, commit, ping, sync, watchApp, appAttempt]);

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
    if (mode === "BINGO" && !trackingBridge()) void lockScreen();
    const seed = mode === "SHIPS" ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! : undefined;
    const next = newBingoRun(name, course, Date.now(), globalThis.crypto.randomUUID(), seed);
    commit(next, true);
    setResumed(false);
    void sync();
  }, [commit, lockScreen, sync, mode]);

  const { catchUp } = app;
  const end = useCallback(async (status: "FINISHED" | "ABANDONED") => {
    const finishedAt = Date.now();
    // I appen: punkterna fram till nu ur journalen först (spårningen stoppas när loppet är slut, `useAppTracking`).
    if (mode === "BINGO" && trackingBridge()) await catchUp();
    const current = runRef.current;
    if (!current || current.status !== "RUNNING") return;
    commit({ ...current, status, finishedAt, version: current.version + 1 }, true);
    void sync();
  }, [commit, sync, catchUp, mode]);

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

  const reset = useCallback(() => { runRef.current = undefined; setRun(undefined); setLastTaken(undefined); setGapNotice(undefined); }, []);

  return { shipGps, run, group, resumed, storageFailed, problem: app.problem ?? problem, accuracy, lastTaken, gapNotice, wakeLockFailed, syncProblem, start, end,
    reset, sync, shoot, aiming, ping, restartGps: app.canRestart ? app.restart : undefined, inApp: app.inApp, metersPerMm: georeference ? metersPerMm(georeference, mapScale) : mapScale / 1000 };
}
