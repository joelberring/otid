import type { MapFingerprintPayload, RaceMapSourceMetadata } from "@o-tid/contracts";

/** Steg 59: meddelandena mellan arbetsytan och kartfilens Worker. */
export interface MapFileWorkerRequest {
  readonly bytes: ArrayBuffer;
  readonly fileName: string;
  /** ADR-0196: högst så många pixlar på längsta sidan (klubbarkivets bilder behöver inte full upplösning). */
  readonly maxSide?: number;
}

export type MapFileWorkerErrorCode = "NOT_A_MAP_FILE" | "UNSUPPORTED_VERSION" | "TRUNCATED" | "INVALID" | "EMPTY" | "NO_CANVAS" |
  "TOO_LARGE" | "FAILED";

export type MapFileWorkerResponse =
  | { readonly type: "progress"; readonly stage: "reading" | "drawing" }
  | { readonly type: "done"; readonly png: Blob; readonly metadata: RaceMapSourceMetadata; readonly width: number; readonly height: number;
      /** ADR-0210: kartans fingeravtryck (klubbarkivets kontroll sparar det). */
      readonly fingerprint?: MapFingerprintPayload | null }
  | MapFileRenderError;

/** `message` är läsarens besked (t.ex. "OCAD 7 stöds inte. …") när filen inte gick att läsa. */
export type MapFileRenderError = { readonly type: "error"; readonly code: MapFileWorkerErrorCode; readonly message?: string };

export type MapFileRenderResult = Extract<MapFileWorkerResponse, { type: "done" }>;

/**
 * Kör kartfilen genom Workern. `onStage` får "reading" och "drawing" när de börjar. Avslutar Workern när svaret kommit
 * (eller vid `signal`), så att minnet för en stor karta släpps.
 */
export function renderMapFile(createWorker: () => Worker, request: MapFileWorkerRequest, onStage: (stage: "reading" | "drawing") => void,
  signal?: AbortSignal): Promise<MapFileRenderResult | MapFileRenderError> {
  return new Promise(resolve => {
    const worker = createWorker();
    const done = (result: MapFileRenderResult | MapFileRenderError) => { worker.terminate(); resolve(result); };
    signal?.addEventListener("abort", () => done({ type: "error", code: "FAILED" }), { once: true });
    worker.onmessage = (event: MessageEvent<MapFileWorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") onStage(message.stage);
      else done(message);
    };
    worker.onerror = event => { event.preventDefault(); done({ type: "error", code: "FAILED" }); };
    worker.postMessage(request, [request.bytes]);
  });
}
