/// <reference lib="webworker" />
import { drawMap, MapFileError, readMapFile, type ParsedMap } from "@o-tid/map-file";
import { MAX_RENDER_SIDE, type MapRenderRequest, type MapRenderResponse } from "./course-setting-map-protocol";

/**
 * Steg 62 (ADR-0177): banläggningens karta i arrangörens webbläsare. Kartfilen läses en gång; varje vy ritas med
 * `drawMap` i en OffscreenCanvas och skickas som bild. Beställningar köas inte: ritas en vy medan en nyare kommer, hoppas
 * mellanliggande över.
 */
declare const self: DedicatedWorkerGlobalScope;

const post = (message: MapRenderResponse, transfer: Transferable[] = []) => self.postMessage(message, transfer);
let map: ParsedMap | undefined;
let queued: Extract<MapRenderRequest, { type: "render" }> | undefined;
let drawing = false;

function render(request: Extract<MapRenderRequest, { type: "render" }>) {
  if (!map) return;
  const width = Math.max(1, Math.min(MAX_RENDER_SIDE, Math.round(request.width)));
  const height = Math.max(1, Math.min(MAX_RENDER_SIDE, Math.round(request.height)));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) { post({ type: "error", code: "NO_CANVAS" }); return; }
  drawMap(context, map, { pxPerMm: request.pxPerMm, origin: request.origin });
  const bitmap = canvas.transferToImageBitmap();
  post({ type: "rendered", id: request.id, bitmap }, [bitmap]);
}

/** Ritar den senaste beställningen; nya som kommer under tiden ersätter varandra. */
function drain() {
  if (drawing) return;
  drawing = true;
  setTimeout(() => {
    try {
      const next = queued;
      queued = undefined;
      if (next) render(next);
    } catch (error) {
      console.error("Kartan kunde inte ritas", error);
      post({ type: "error", code: "FAILED" });
    } finally {
      drawing = false;
      if (queued) drain();
    }
  }, 0);
}

self.onmessage = (event: MessageEvent<MapRenderRequest>) => {
  const request = event.data;
  if (request.type === "render") { queued = request; drain(); return; }
  try {
    map = readMapFile(new Uint8Array(request.bytes), request.fileName);
    if (!map.bounds || map.objects.length === 0) { post({ type: "error", code: "EMPTY" }); return; }
    post({ type: "loaded", bounds: map.bounds, scale: map.scale });
  } catch (error) {
    // Ett läsfel är ett begripligt besked till arrangören; allt annat loggas i webbläsarens konsol.
    if (error instanceof MapFileError) post({ type: "error", code: error.code });
    else { console.error("Kartfilen kunde inte läsas", error); post({ type: "error", code: "FAILED" }); }
  }
};
