"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredBingoRun } from "../../lib/bingo-run";
import type { ReadoutSound } from "../../readout/sound";
import { trackingBridge, type TrackingBridge } from "../../lib/otid-tracking";
import { appPositionSource, type AppPositionWatch, type PositionHandlers, type PositionProblem } from "../../lib/position-source";

/**
 * Maxtid för spårningen i appen (ADR-0227 beslut 5): arrangemangets sluttid + 60 minuter, men tävlingen har ingen sluttid
 * (bara datum och första start), så fyra timmar efter loppets start.
 */
const APP_TRACKING_MAX_MS = 4 * 60 * 60 * 1000;

/** Problemen som kan avhjälpas med «Starta GPS igen» (löparens uttryckliga tryck i synlig app). */
const RESTARTABLE = new Set<PositionProblem>(["appDenied", "trackingStopped", "trackingFailed"]);

/**
 * Loppets spårning i O-Tids app (ADR-0227), delad av bingon och de virtuella kontrollerna. I webbläsaren gör den ingenting.
 * `watch` startar eller fortsätter spårningen för loppet och ger punkterna; när loppet är slut stoppas spårningen, och
 * journalen tas bort först när servern har kvitterat loppets sista version (AGENTS.md).
 */
export function useAppTracking(run: StoredBingoRun | undefined, tracks: boolean, notice: string) {
  const [problem, setProblem] = useState<PositionProblem>();
  const [inApp, setInApp] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const force = useRef(false);
  const active = useRef<AppPositionWatch | undefined>(undefined);
  // Notisens text läses när spårningen startar; ett byte av språk ska inte starta om bevakningen.
  const noticeRef = useRef(notice);
  useEffect(() => { noticeRef.current = notice; }, [notice]);

  /** Bevakar loppet genom appen; undefined i webbläsaren (eller om bryggan saknar en metod). */
  const watch = useCallback((current: StoredBingoRun, handlers: Omit<PositionHandlers, "onProblem">): (() => void) | undefined => {
    const bridge = trackingBridge();
    if (!bridge) return undefined;
    const forceStart = force.current;
    force.current = false;
    setInApp(true);
    const watcher = appPositionSource(bridge, { sessionId: current.runnerId, stopAtMs: current.startedAt + APP_TRACKING_MAX_MS, title: "O-Tid",
      text: noticeRef.current, afterSeq: current.lastSeq ?? 0, forceStart }).watch({ ...handlers, onProblem: setProblem });
    active.current = watcher;
    return () => { watcher.stop(); if (active.current === watcher) active.current = undefined; };
  }, []);

  /** Före Mål: räkna ikapp journalen så att punkterna fram till nu kommer med. */
  const catchUp = useCallback(async () => {
    try { await active.current?.catchUp(); }
    catch (error) { console.error("Journalen i appen kunde inte läsas före målgången", error); setProblem("trackingFailed"); }
  }, []);

  const restart = useCallback(() => { force.current = true; setProblem(undefined); setAttempt(count => count + 1); }, []);

  // Loppet är slut: stoppa spårningen (en gång per lopp), och töm journalen när servern har kvitterat sista versionen.
  const stopping = useRef<{ sessionId: string; done: Promise<boolean> } | undefined>(undefined);
  const purged = useRef<string | undefined>(undefined);
  useEffect(() => {
    const bridge = trackingBridge();
    if (!bridge || !tracks || !run || run.status === "RUNNING") return;
    const sessionId = run.runnerId;
    if (stopping.current?.sessionId !== sessionId) stopping.current = { sessionId, done: stopTracking(bridge, sessionId) };
    const stopped = stopping.current;
    if (run.acked < run.version || purged.current === sessionId) return;
    purged.current = sessionId;
    void stopped.done.then(async ok => {
      if (!ok) { stopping.current = undefined; purged.current = undefined; return; }
      if (!bridge.purge) { console.warn("Appen kan inte ta bort journalen (äldre version)"); return; }
      try { await bridge.purge({ sessionId }); }
      catch (error) { purged.current = undefined; console.error("Journalen i appen kunde inte tas bort", error); }
    });
  }, [run, tracks]);

  return { problem, inApp, attempt, watch, catchUp, restart, canRestart: problem !== undefined && RESTARTABLE.has(problem) };
}

async function stopTracking(bridge: TrackingBridge, sessionId: string): Promise<boolean> {
  try { await bridge.stop({ sessionId }); return true; }
  catch (error) { console.error("Spårningen i appen kunde inte stoppas", error); return false; }
}

/** Pling och vibration: i appen med `signal` (fungerar med låst skärm), annars som i webbläsaren. */
export function pingOk(sound: ReadoutSound): void {
  const signal = trackingBridge()?.signal;
  if (signal) {
    void signal({ kind: "ok" }).catch((error: unknown) => { console.warn("Appen kunde inte plinga; webbens ljud används", error); webPing(sound); });
    return;
  }
  webPing(sound);
}

function webPing(sound: ReadoutSound): void {
  sound.play("ok");
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* vibration finns inte i alla webbläsare (iPhone) */ }
}
