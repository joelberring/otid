import type { CostModel, LegAnalysis, LegInput, RouteChoiceSettings } from "@o-tid/route-choice";
import type { CalibrationResult, CalibrationSample, LevelLegRequest, LevelMeasured, RouteChoiceWorkerErrorCode, RouteChoiceWorkerRequest,
  RouteChoiceWorkerResponse, SpeedFactors } from "./route-choice-worker-protocol";
import type { LevelControlInput } from "@o-tid/course-setting";

/**
 * Steg 60: vägvalsanalysens Worker sedd från arbetsytan. En Worker per öppen vy; kartfilen skickas en gång. `analyse` ger
 * svar sträcka för sträcka och avbryter en tidigare körning; `close` avslutar Workern så att minnet släpps.
 */
export interface RouteChoiceModel { readonly unknownSymbols: CostModel["unknownSymbols"]; readonly speeds: SpeedFactors }

export class RouteChoiceSession {
  private readonly worker: Worker;
  private run = 0;
  private onModel: ((model: RouteChoiceModel) => void) | undefined;
  private onError: ((code: RouteChoiceWorkerErrorCode) => void) | undefined;
  /** Varje räknad sträcka, vem som än bad om den (vägarna nära kontrollerna sparas för kontrollnumren, ägaren 2026-11-08). */
  private readonly listeners = new Set<(leg: LegInput, analysis: LegAnalysis) => void>();
  private readonly runLegs = new Map<number, readonly LegInput[]>();
  private readonly runs = new Map<number, { leg: (index: number, analysis: LegAnalysis) => void; done: () => void;
    calibrated?: (result: CalibrationResult) => void; failed: (code: RouteChoiceWorkerErrorCode) => void; cancelled?: () => void;
    levelLeg?: (message: Extract<RouteChoiceWorkerResponse, { type: "level-leg" }>) => void; level?: (result: LevelMeasured) => void }>();

  constructor(createWorker: () => Worker) {
    this.worker = createWorker();
    this.worker.onmessage = (event: MessageEvent<RouteChoiceWorkerResponse>) => this.receive(event.data);
    this.worker.onerror = event => { event.preventDefault(); this.fail("FAILED"); };
  }

  private receive(message: RouteChoiceWorkerResponse) {
    if (message.type === "model") { this.onModel?.({ unknownSymbols: message.unknownSymbols, speeds: message.speeds }); return; }
    if (message.type === "error" && message.runId === undefined) { this.fail(message.code); return; }
    if (message.runId === undefined) return;
    const handler = this.runs.get(message.runId);
    if (!handler) return;
    if (message.type !== "leg" && message.type !== "level-leg") this.runLegs.delete(message.runId);
    if (message.type === "leg") {
      handler.leg(message.index, message.analysis);
      const leg = this.runLegs.get(message.runId)?.[message.index];
      if (leg) for (const listener of this.listeners) listener(leg, message.analysis);
    }
    else if (message.type === "calibrated") { this.runs.delete(message.runId); handler.calibrated?.(message.result); }
    else if (message.type === "level-leg") handler.levelLeg?.(message);
    else if (message.type === "level") { this.runs.delete(message.runId); handler.level?.(message.result); }
    else if (message.type === "done") { this.runs.delete(message.runId); handler.done(); }
    else { this.runs.delete(message.runId); handler.failed(message.code); }
  }

  private fail(code: RouteChoiceWorkerErrorCode) {
    this.onError?.(code);
    for (const handler of this.runs.values()) handler.failed(code);
    this.runs.clear();
    this.runLegs.clear();
  }

  private send(request: RouteChoiceWorkerRequest, transfer: Transferable[] = []) { this.worker.postMessage(request, transfer); }

  /** Läser kartfilen och bygger kostnadsmodellen; `onModel` får okända symboler och farterna. */
  load(bytes: ArrayBuffer, fileName: string, settings: RouteChoiceSettings, onModel: (model: RouteChoiceModel) => void,
    onError: (code: RouteChoiceWorkerErrorCode) => void) {
    this.onModel = onModel; this.onError = onError;
    this.cancel();
    this.send({ type: "load", bytes, fileName, settings }, [bytes]);
  }

  /** Nya inställningar: modellen byggs om (och `onModel` anropas igen). Pågående körning avbryts. */
  settings(settings: RouteChoiceSettings) { this.cancel(); this.send({ type: "settings", settings }); }

  /** Räknar sträckorna i ordning; en tidigare körning avbryts (och får `cancelled`). */
  analyse(legs: readonly LegInput[], leg: (index: number, analysis: LegAnalysis) => void, done: () => void,
    failed: (code: RouteChoiceWorkerErrorCode) => void, cancelled?: () => void): number {
    this.cancel();
    const runId = ++this.run;
    this.runs.set(runId, { leg, done, failed, ...(cancelled ? { cancelled } : {}) });
    this.runLegs.set(runId, legs);
    this.send({ type: "analyse", runId, legs });
    return runId;
  }

  calibrate(samples: readonly CalibrationSample[]): Promise<CalibrationResult> {
    const runId = ++this.run;
    return new Promise((resolve, reject) => {
      this.runs.set(runId, { leg: () => undefined, done: () => undefined, calibrated: resolve, failed: code => reject(new Error(code)) });
      this.send({ type: "calibrate", runId, samples });
    });
  }

  /**
   * ADR-0212: nivåstödet för en bana. En tidigare körning avbryts; `progress` får varje sträcka (och dess längd för den
   * gemensamma tabellen), `done` mätningen.
   */
  level(request: { legs: readonly LevelLegRequest[]; controls: readonly LevelControlInput[]; sprint: boolean },
    progress: (message: Extract<RouteChoiceWorkerResponse, { type: "level-leg" }>) => void, done: (result: LevelMeasured) => void,
    failed: (code: RouteChoiceWorkerErrorCode) => void, cancelled?: () => void): number {
    this.cancel();
    const runId = ++this.run;
    this.runs.set(runId, { leg: () => undefined, done: () => undefined, failed, levelLeg: progress, level: done, ...(cancelled ? { cancelled } : {}) });
    this.send({ type: "level", runId, ...request });
    return runId;
  }

  /** Lyssnar på varje räknad sträcka; ger funktionen som slutar lyssna. */
  listen(listener: (leg: LegInput, analysis: LegAnalysis) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Avbryter pågående körning (svaren som redan kommit står kvar). */
  cancel() {
    const handlers = [...this.runs.values()];
    for (const [runId] of this.runs) this.send({ type: "cancel", runId });
    this.runs.clear();
    this.runLegs.clear();
    for (const handler of handlers) handler.cancelled?.();
  }

  close() { this.runs.clear(); this.runLegs.clear(); this.listeners.clear(); this.worker.terminate(); }
}
