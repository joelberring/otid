"use client";

import { useEffect, useState } from "react";
import type { CourseSettingState } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { offlineSv } from "../../i18n/course-setting-offline-sv";
import type { FieldStore } from "../../lib/course-setting-offline";
import { MapRenderSession } from "../../lib/course-setting-map-protocol";
import type { Bounds } from "../../lib/course-setting-viewport";
import { controlledWorker } from "../../lib/course-setting-worker";
import { loadMapFile } from "./use-course-setting-offline";

// Steg 67: styrda av service workern när sidan är sparad för offline (`controlledWorker`).
const createMapWorker = () => controlledWorker(() => new Worker(new URL("../../lib/course-setting-map-worker.ts", import.meta.url), { type: "module" }));

export type MapFileStatus = "none" | "reading" | "ready" | "failed";

/**
 * Banläggningens kartfil: hämtas (från telefonen, webbläsarens cache eller servern, ADR-0218) och läses i en Worker som
 * sedan ritar kartan. `progress` är andelen som hämtats (0–1) medan filen hämtas från servern, annars undefined.
 */
export function useCourseSettingMapFile(input: { readonly raceId: string; readonly mapFile: CourseSettingState["mapFile"];
  readonly storage: FieldStore; readonly say: (message: { tone: "attention"; text: string }) => void }) {
  const { raceId, mapFile, storage } = input;
  const [session, setSession] = useState<MapRenderSession>();
  const [bounds, setBounds] = useState<Bounds | undefined>(mapFile?.bounds);
  const [status, setStatus] = useState<MapFileStatus>(mapFile ? "reading" : "none");
  const [georeference, setGeoreference] = useState<MapGeoreference | null>();
  const [bytes, setBytes] = useState<number>();
  const [progress, setProgress] = useState<number>();
  const say = input.say;
  useEffect(() => {
    if (!mapFile) return;
    const controller = new AbortController();
    let closed = false;
    let created: MapRenderSession | undefined;
    void (async () => {
      try {
        const file = await loadMapFile(raceId, mapFile.sha256, storage, controller.signal, () => say({ tone: "attention", text: offlineSv.olderMap }),
          fraction => { if (!closed) setProgress(fraction); });
        if (closed) return;
        setProgress(undefined);
        setBytes(file.bytes.byteLength);
        created = new MapRenderSession(createMapWorker, (loaded, _scale, georef) => {
          if (!closed) { setBounds(loaded); setGeoreference(georef); setStatus("ready"); }
        },
          () => { if (!closed) setStatus("failed"); });
        // Kartfilen går över till Workern (ingen kopia stannar här).
        created.load(file.bytes, file.fileName);
        setSession(created);
      } catch { if (!closed) { setProgress(undefined); setStatus("failed"); } }
    })();
    return () => { closed = true; controller.abort(); created?.close(); };
  // Bara en ny kartfil (eller tävling) läser om kartan; `say` och lagret byts inte under tiden.
  }, [raceId, mapFile]);
  return { session, bounds, status, georeference, bytes, progress };
}
