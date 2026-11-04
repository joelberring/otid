/// <reference lib="webworker" />
import { MapFileError, readMapFile, type ParsedMap } from "@o-tid/map-file";
import { controlFeatures, detectPressNorm, legFeatures, prepareLevelMap, type LegLevelFeatures } from "@o-tid/course-setting";
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
  levelLegs.clear();
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

/**
 * ADR-0212: nivåstödets sträckor per indata (samma nyckel som vägvalen), så att bara ändrade sträckor räknas om när
 * banläggaren bedömer igen. Tas bort när kartan eller inställningarna byts.
 */
const levelLegs = new Map<string, { features: LegLevelFeatures | undefined; best: number | undefined; straight: number }>();

/** Sprint har ingen färgskala (SOFT 2022): kartans norm som i utskriften (ADR-0211 beslut 3). */
function sprintMap(parsed: ParsedMap): boolean {
  const codes = new Set<string>();
  for (const object of parsed.objects) { const symbol = parsed.symbols.get(object.symbol); if (symbol) codes.add(symbol.code.text.replace(/\.0+$/, "")); }
  return detectPressNorm({ scale: parsed.scale, codes }) === "ISSPROM";
}

async function level(runId: number, request: Extract<RouteChoiceWorkerRequest, { type: "level" }>) {
  if (!model || !map) { post({ type: "error", code: "NO_MODEL", runId }); return; }
  if (request.sprint || sprintMap(map)) { post({ type: "level", runId, result: { controls: [], legs: [], notApplicable: "SPRINT" } }); return; }
  const prepared = prepareLevelMap(map);
  const legs: LegLevelFeatures[] = [];
  for (const [index, leg] of request.legs.entries()) {
    let known = levelLegs.get(leg.input.key);
    if (!known) {
      await yieldToMessages();
      if (runId !== activeRun || !model) return;
      const analysis = analyseLeg(model, { ...leg.input, follow: true }, settings);
      if (runId !== activeRun) return;
      known = { best: analysis.best?.meters, straight: analysis.straightMeters,
        features: legFeatures(prepared, { key: leg.input.key, from: leg.from, to: leg.to, best: analysis.best?.points, followRatio: analysis.following?.timeRatio }) };
      if (levelLegs.size > 2000) levelLegs.clear();
      levelLegs.set(leg.input.key, known);
    }
    if (known.features) legs.push({ ...known.features, from: leg.from, to: leg.to });
    post({ type: "level-leg", runId, done: index + 1, total: request.legs.length, key: leg.input.key, best: known.best, straight: known.straight });
  }
  await yieldToMessages();
  if (runId !== activeRun) return;
  const controls = request.controls.map(control => controlFeatures(prepared, control));
  post({ type: "level", runId, result: { controls, legs } });
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
    case "level":
      activeRun = request.runId;
      return level(request.runId, request);
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
