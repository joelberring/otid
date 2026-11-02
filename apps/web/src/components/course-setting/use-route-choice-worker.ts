"use client";

import { useEffect, useRef, useState } from "react";
import type { RouteChoiceSettings } from "@o-tid/route-choice";
import type { FieldStore } from "../../lib/course-setting-offline";
import { controlledWorker } from "../../lib/course-setting-worker";
import { fetchRouteChoice } from "../../lib/route-choice-api";
import { RouteChoiceSession } from "../../lib/route-choice-client";
import { loadMapFile } from "./use-course-setting-offline";

// Steg 67: styrd av service workern när sidan är sparad för offline (`controlledWorker`).
const createRouteWorker = () => controlledWorker(() => new Worker(new URL("../../lib/route-choice-worker.ts", import.meta.url), { type: "module" }));

/**
 * Översynen 2026-11-02 (minnet i mobilen): vägvalens Worker läser kartfilen en gång till och bygger kostnadsmodellen,
 * vilket är det tyngsta i editorn. Den startas först när den behövs (en sträcka på en bana är vald), inte när editorn
 * öppnas, så fältläget i telefonen har bara kartans Worker. Kartfilen läses då igen (ur telefonen om den är sparad där,
 * annars från servern), i stället för att en kopia hålls i minnet hela tiden.
 */
export function useRouteChoiceWorker(input: { raceId: string; mapSha256: string | undefined; admin: boolean; storage: FieldStore;
  wanted: boolean }) {
  const { raceId, mapSha256, admin, storage, wanted } = input;
  const session = useRef<RouteChoiceSession | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  useEffect(() => { if (wanted && mapSha256) setStarted(true); }, [wanted, mapSha256]);
  useEffect(() => {
    if (!started || !mapSha256) return;
    const controller = new AbortController();
    let closed = false;
    setReady(false); setFailed(false);
    void (async () => {
      try {
        // Vägvalens inställningar är admins; den som bara har banläggningen räknar med standardinställningarna.
        const [file, settings] = await Promise.all([loadMapFile(raceId, mapSha256, storage, controller.signal, () => undefined), admin
          ? fetchRouteChoice(raceId, controller.signal).then(value => value.settings as RouteChoiceSettings, () => ({ version: 1 }) as RouteChoiceSettings)
          : Promise.resolve({ version: 1 } as RouteChoiceSettings)]);
        if (closed) return;
        const worker = new RouteChoiceSession(createRouteWorker);
        session.current = worker;
        worker.load(file.bytes, file.fileName, settings, () => { if (!closed) setReady(true); },
          () => { if (!closed) { setReady(false); setFailed(true); } });
      } catch (error) {
        if (closed) return;
        console.error("Vägvalen kunde inte startas", error);
        setFailed(true);
      }
    })();
    return () => { closed = true; controller.abort(); session.current?.close(); session.current = undefined; setReady(false); };
  }, [started, raceId, mapSha256, admin, storage]);
  return { session, ready, failed, started };
}
