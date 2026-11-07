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

type MapFileStatus = "none" | "reading" | "ready" | "failed";

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
    const sha256 = mapFile.sha256;
    const controller = new AbortController();
    let closed = false;
    // Workern startar medan filen hämtas (ADR-0218), så att den är redo när filen kommer.
    const created = new MapRenderSession(createMapWorker, (loaded, _scale, georef) => {
      if (!closed) { setBounds(loaded); setGeoreference(georef); setStatus("ready"); }
    },
      () => { if (!closed) setStatus("failed"); });
    // Förloppet högst var 200:e ms: varje ändring ritar om editorn, och ur cachen är filen hämtad på en gång.
    let shown = 0;
    const onProgress = (fraction: number) => {
      const now = performance.now();
      if (closed || (now - shown < 200 && fraction < 1)) return;
      shown = now;
      setProgress(fraction);
    };
    void (async () => {
      try {
        const file = await loadMapFile(raceId, sha256, storage, controller.signal, () => say({ tone: "attention", text: offlineSv.olderMap }),
          onProgress);
        if (closed) return;
        setProgress(undefined);
        setBytes(file.bytes.byteLength);
        // Kartfilen går över till Workern (ingen kopia stannar här).
        created.load(file.bytes, file.fileName);
        setSession(created);
      } catch { if (!closed) { setProgress(undefined); setStatus("failed"); } }
    })();
    return () => { closed = true; controller.abort(); created.close(); };
  // Bara en ny kartfil (sha256) eller tävling läser om kartan, inte ett nytt tillstånd med samma fil; `say` och lagret byts
  // inte under tiden.
  }, [raceId, mapFile?.sha256]);
  return { session, bounds, status, georeference, bytes, progress };
}
