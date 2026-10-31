import type { CostModel, LegAnalysis, LegInput, RouteChoiceSettings } from "@o-tid/route-choice";
import type { CalibrationResult, CalibrationSample, RouteChoiceWorkerErrorCode, RouteChoiceWorkerRequest,
  RouteChoiceWorkerResponse, SpeedFactors } from "./route-choice-worker-protocol";

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
  private readonly runs = new Map<number, { leg: (index: number, analysis: LegAnalysis) => void; done: () => void;
    calibrated?: (result: CalibrationResult) => void; failed: (code: RouteChoiceWorkerErrorCode) => void }>();

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
    if (message.type === "leg") handler.leg(message.index, message.analysis);
    else if (message.type === "calibrated") { this.runs.delete(message.runId); handler.calibrated?.(message.result); }
    else if (message.type === "done") { this.runs.delete(message.runId); handler.done(); }
    else { this.runs.delete(message.runId); handler.failed(message.code); }
  }

  private fail(code: RouteChoiceWorkerErrorCode) {
    this.onError?.(code);
    for (const handler of this.runs.values()) handler.failed(code);
    this.runs.clear();
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

  /** Räknar sträckorna i ordning; en tidigare körning avbryts. */
  analyse(legs: readonly LegInput[], leg: (index: number, analysis: LegAnalysis) => void, done: () => void,
    failed: (code: RouteChoiceWorkerErrorCode) => void): number {
    this.cancel();
    const runId = ++this.run;
    this.runs.set(runId, { leg, done, failed });
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

  /** Avbryter pågående körning (svaren som redan kommit står kvar). */
  cancel() {
    for (const [runId] of this.runs) this.send({ type: "cancel", runId });
    this.runs.clear();
  }

  close() { this.runs.clear(); this.worker.terminate(); }
}
