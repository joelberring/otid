/// <reference lib="webworker" />
import { MapFileError, readMapFile, type ParsedMap } from "@o-tid/map-file";
import { analyseLeg, buildCostModel, calibrateSpeeds, resolveSettings, type CostModel, type RouteChoiceSettings } from "@o-tid/route-choice";
import type { RouteChoiceWorkerRequest, RouteChoiceWorkerResponse } from "./route-choice-worker-protocol";

/**
 * Steg 60 (ADR-0177, ADR-0179 beslut 11): vägvalsanalysen i arrangörens webbläsare. Kartfilen läses och kostnadsmodellen
 * byggs en gång (igen när inställningarna ändras); banan räknas sträcka för sträcka och varje svar skickas direkt. En ny
 * körning eller `cancel` avbryter den pågående mellan två sträckor. Servern räknar inget.
 */
declare const self: DedicatedWorkerGlobalScope;

const post = (message: RouteChoiceWorkerResponse, transfer: Transferable[] = []) => self.postMessage(message, transfer);
let map: ParsedMap | undefined;
let model: CostModel | undefined;
let settings: RouteChoiceSettings = { version: 1 };
/** Senaste körningen; en äldre körning slutar vid nästa sträcka. */
let activeRun = 0;

function build() {
  if (!map) { model = undefined; post({ type: "error", code: "NO_MODEL" }); return; }
  model = buildCostModel(map, settings);
  post({ type: "model", unknownSymbols: model.unknownSymbols, speeds: { ...resolveSettings(settings).speedByClass } });
}

/** Ger plats åt nya meddelanden (t.ex. `cancel`) mellan två sträckor. */
const yieldToMessages = () => new Promise<void>(resolve => setTimeout(resolve, 0));

async function analyse(runId: number, request: Extract<RouteChoiceWorkerRequest, { type: "analyse" }>) {
  if (!model) { post({ type: "error", code: "NO_MODEL", runId }); return; }
  for (const [index, leg] of request.legs.entries()) {
    await yieldToMessages();
    if (runId !== activeRun || !model) return;
    const analysis = analyseLeg(model, leg, settings);
    if (runId !== activeRun) return;
    post({ type: "leg", runId, index, analysis }, analysis.corridor ? [analysis.corridor.mask.buffer] : []);
  }
  if (runId === activeRun) post({ type: "done", runId });
}

function calibrate(request: Extract<RouteChoiceWorkerRequest, { type: "calibrate" }>) {
  if (!model) { post({ type: "error", code: "NO_MODEL", runId: request.runId }); return; }
  const before = { ...resolveSettings(settings).speedByClass };
  const result = calibrateSpeeds(model, request.samples, settings);
  post({ type: "calibrated", runId: request.runId, result: { before, after: { ...before, ...result.speedByClass }, samples: result.samplesUsed,
    reliability: result.reliability } });
}

function handle(request: RouteChoiceWorkerRequest): Promise<void> | void {
  switch (request.type) {
    case "load":
      activeRun += 1;
      settings = request.settings;
      map = readMapFile(new Uint8Array(request.bytes), request.fileName);
      build();
      return;
    case "settings":
      activeRun += 1;
      settings = request.settings;
      build();
      return;
    case "analyse":
      activeRun = request.runId;
      return analyse(request.runId, request);
    case "cancel":
      if (request.runId === activeRun) activeRun += 1;
      return;
    case "calibrate":
      return calibrate(request);
  }
}

self.onmessage = (event: MessageEvent<RouteChoiceWorkerRequest>) => {
  const request = event.data;
  const runId = "runId" in request ? request.runId : undefined;
  Promise.resolve().then(() => handle(request)).catch((error: unknown) => {
    // Ett läsfel är ett begripligt besked till arrangören; allt annat loggas i webbläsarens konsol.
    if (error instanceof MapFileError) post({ type: "error", code: error.code, runId });
    else { console.error("Vägvalen kunde inte räknas", error); post({ type: "error", code: "FAILED", runId }); }
  });
};
