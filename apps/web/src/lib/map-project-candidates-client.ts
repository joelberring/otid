import { VectorParseError, type SourceData, type SourceFeature } from "@o-tid/map-revision";
import type { BaseMapCalm, BaseMapPart, BaseMapStage, BaseMapStep, CalmOutcome, CandidateInput, CandidateRequest, CandidateResponse, CandidateResult } from "./map-project-candidates";

/** Så många filers objekt hålls i Workern (den visade, den förra och en som just läses in). */
const KEPT = 3;

/**
 * Kandidaternas Worker sedd från sidan (`map-project-candidates.ts`). En fils objekt skickas dit en gång (de känns igen på
 * listan `features`), så att en kryssruta i kandidatraden bara skickar de små valen. Bara det senaste svaret på en uträkning
 * används; en äldre uträkning som kommer efter en nyare kastas.
 */
export class CandidateSession {
  private readonly worker: Worker;
  private nextId = 0;
  private latestCompute = 0;
  private readonly ids = new WeakMap<readonly SourceFeature[], number>();
  private readonly kept: (readonly SourceFeature[])[] = [];
  private readonly pending = new Map<number, (response: CandidateResponse) => void>();

  constructor(createWorker: () => Worker) {
    this.worker = createWorker();
    this.worker.onmessage = (event: MessageEvent<CandidateResponse>) => this.pending.get(event.data.id)?.(event.data);
    this.worker.onerror = event => {
      event.preventDefault();
      // Workern dog: alla som väntar får fel, och det som skickats dit finns inte längre.
      for (const [id, done] of [...this.pending]) done({ type: "error", id, message: "FAILED", parse: false });
    };
  }

  private post(message: CandidateRequest) { this.worker.postMessage(message); }

  /** Objekten finns i Workern; de äldsta glöms. */
  private remember(features: readonly SourceFeature[], dataId: number) {
    this.ids.set(features, dataId);
    this.kept.push(features);
    while (this.kept.length > KEPT) {
      const old = this.kept.shift()!, oldId = this.ids.get(old);
      this.ids.delete(old);
      if (oldId !== undefined) this.post({ type: "forget", dataId: oldId });
    }
  }

  private dataIdOf(features: readonly SourceFeature[]): number {
    const known = this.ids.get(features);
    if (known !== undefined) return known;
    const dataId = ++this.nextId;
    this.post({ type: "data", dataId, features });
    this.remember(features, dataId);
    return dataId;
  }

  /**
   * Resultatfilerna tolkas (och sätts ihop till grundkartan med `merge`) i Workern; `onStep` får var den är. Ett fel i en fil
   * blir `VectorParseError` med filens meddelande. Med `calm` lugnas kurvorna på flack mark, och svaret säger vad som togs bort.
   */
  baseMap(request: { parts: readonly BaseMapPart[]; stages?: readonly BaseMapStage[] | undefined; merge: boolean; osm?: SourceData | undefined; scale?: number | undefined;
    cuts?: Extract<CandidateRequest, { type: "base-map" }>["cuts"]; norm?: Extract<CandidateRequest, { type: "base-map" }>["norm"]; calm?: BaseMapCalm | undefined },
    onStep: (step: BaseMapStep) => void): Promise<{ data: SourceData; calm?: CalmOutcome | undefined }> {
    const id = ++this.nextId, dataId = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, response => {
        if (response.type === "progress") { onStep(response.step === "read" ? { step: "read", done: response.done, total: response.total } : { step: "merge" }); return; }
        this.pending.delete(id);
        if (response.type === "base-map") { this.remember(response.data.features, response.dataId); resolve({ data: response.data, calm: response.calm }); }
        else if (response.type === "error") reject(response.parse ? new VectorParseError(response.message) : new Error(response.message));
      });
      this.post({ type: "base-map", id, dataId, ...request });
    });
  }

  /** Kandidaterna räknas i Workern; `onResult` anropas bara för den senaste uträkningen (`undefined` om den inte gick). */
  compute(features: readonly SourceFeature[], input: CandidateInput, onResult: (result: CandidateResult | undefined) => void) {
    const id = ++this.nextId;
    this.latestCompute = id;
    this.pending.set(id, response => {
      this.pending.delete(id);
      if (id === this.latestCompute) onResult(response.type === "computed" ? response.result ?? undefined : undefined);
    });
    this.post({ type: "compute", id, dataId: this.dataIdOf(features), input });
  }

  close() {
    this.pending.clear();
    this.worker.terminate();
  }
}
