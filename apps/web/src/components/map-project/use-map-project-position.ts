"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MapGeoreference } from "@o-tid/map-file";
import { toMapPosition, type MapPosition, type PositionFix } from "../../lib/course-setting-geo";

/**
 * ADR-0219 tillägget om rekningen (K3): telefonens position i kartprojektet. Positionen följs när den visas eller när ett spår
 * spelas in; varje ny position går till `onFix` (inspelningen). Medan ett spår spelas in hålls skärmen tänd (Wake Lock) där
 * webbläsaren kan. En position sämre än `MAX_RECORD_ACCURACY_M` spelas inte in.
 */
export const MAX_RECORD_ACCURACY_M = 50;
export type PositionProblem = "insecure" | "unsupported" | "denied" | "timeout" | "unavailable" | "crs";

export interface TimedFix extends PositionFix { readonly at: number }

export function useMapProjectPosition(input: { georeference: MapGeoreference | null; active: boolean; recording: boolean;
  onFix?: ((fix: TimedFix) => void) | undefined }) {
  const { georeference, active, recording } = input;
  const [fix, setFix] = useState<TimedFix>();
  const [problem, setProblem] = useState<PositionProblem>();
  const onFix = useRef(input.onFix);
  onFix.current = input.onFix;
  const watching = active || recording;

  useEffect(() => {
    if (!watching) { setFix(undefined); setProblem(undefined); return; }
    if (typeof window !== "undefined" && !window.isSecureContext) { setProblem("insecure"); return; }
    if (!("geolocation" in navigator)) { setProblem("unsupported"); return; }
    const id = navigator.geolocation.watchPosition(position => {
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyM: position.coords.accuracy,
        at: position.timestamp || Date.now() };
      setFix(next);
      setProblem(undefined);
      onFix.current?.(next);
    }, failure => setProblem(failure.code === failure.PERMISSION_DENIED ? "denied" : failure.code === failure.TIMEOUT ? "timeout" : "unavailable"),
    { enableHighAccuracy: true, maximumAge: 0 });
    return () => navigator.geolocation.clearWatch(id);
  }, [watching]);

  // Skärmen tänd medan spåret spelas in (släpps när sidan göms och tas igen när den syns).
  useEffect(() => {
    if (!recording || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let closed = false;
    const take = async () => {
      try { lock = await navigator.wakeLock.request("screen"); } catch { lock = undefined; }
      if (closed) void lock?.release();
    };
    const visible = () => { if (document.visibilityState === "visible") void take(); };
    void take();
    document.addEventListener("visibilitychange", visible);
    return () => { closed = true; document.removeEventListener("visibilitychange", visible); void lock?.release(); };
  }, [recording]);

  const located = useMemo<{ position?: MapPosition; problem?: PositionProblem }>(() => {
    if (!fix || !georeference) return {};
    try { return { position: toMapPosition(georeference, fix) }; } catch { return { problem: "crs" }; }
  }, [fix, georeference]);

  return { fix, position: located.position, problem: problem ?? located.problem };
}
