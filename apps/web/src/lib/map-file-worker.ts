/// <reference lib="webworker" />
import { RACE_MAP_MAX_BYTES } from "@o-tid/contracts";
import { drawMap, mapPointToWgs84, MapFileError, preferredPxPerMm, readMapFile, renderSize } from "@o-tid/map-file";
import { mapFileMetadata } from "./map-file-metadata";
import type { MapFileWorkerRequest, MapFileWorkerResponse } from "./map-file-worker-protocol";

/**
 * Steg 59 (ADR-0177, ADR-0179 beslut 2): kartfilen läses och ritas i arrangörens webbläsare, i en Worker så att sidan inte
 * fryser. Servern får bara bytes att spara. Blir PNG:n större än kartbildens gräns ritas kartan om med lägre upplösning.
 */
declare const self: DedicatedWorkerGlobalScope;

const post = (message: MapFileWorkerResponse) => self.postMessage(message);

async function render(request: MapFileWorkerRequest): Promise<MapFileWorkerResponse> {
  post({ type: "progress", stage: "reading" });
  const map = readMapFile(new Uint8Array(request.bytes), request.fileName);
  if (!map.bounds || map.objects.length === 0) return { type: "error", code: "EMPTY" };
  post({ type: "progress", stage: "drawing" });
  let pxPerMm = preferredPxPerMm(map.scale);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const size = renderSize(map, pxPerMm);
    if (!size) return { type: "error", code: "EMPTY" };
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) return { type: "error", code: "NO_CANVAS" };
    const report = drawMap(context, map, { pxPerMm: size.pxPerMm, origin: size.origin });
    const png = await canvas.convertToBlob({ type: "image/png" });
    if (png.size > RACE_MAP_MAX_BYTES) {
      pxPerMm = size.pxPerMm * Math.sqrt(RACE_MAP_MAX_BYTES / png.size) * 0.9;
      continue;
    }
    const metadata = mapFileMetadata(map, size, report.simplifications, mapPointToWgs84);
    if (!metadata) return { type: "error", code: "EMPTY" };
    return { type: "done", png, metadata, width: size.width, height: size.height };
  }
  return { type: "error", code: "TOO_LARGE" };
}

self.onmessage = (event: MessageEvent<MapFileWorkerRequest>) => {
  render(event.data).then(post, (error: unknown) => {
    // Ett läsfel är ett begripligt besked till arrangören; allt annat loggas i webbläsarens konsol.
    if (error instanceof MapFileError) post({ type: "error", code: error.code });
    else { console.error("Kartfilen kunde inte ritas", error); post({ type: "error", code: "FAILED" }); }
  });
};
