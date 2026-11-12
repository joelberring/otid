/// <reference lib="webworker" />
import { handleCandidateRequest, type CandidateRequest, type CandidateResponse, type CandidateStore } from "./map-project-candidates";

/**
 * Kandidaternas Worker (ägaren 2026-11-12, «varningar om att sidan inte svarar vid stora jobb»): grundkartan sätts ihop och
 * kandidaterna räknas här, utanför sidans tråd. Uträkningar som hunnit bli inaktuella (en kryssruta slogs om igen innan
 * den förra var klar) hoppas över: bara den senaste i kön räknas, de andra får ett tomt svar som sidan ändå kastar.
 */
declare const self: DedicatedWorkerGlobalScope;

const store: CandidateStore = new Map();
const post = (response: CandidateResponse) => self.postMessage(response);
let waiting: Extract<CandidateRequest, { type: "compute" }> | undefined;

function run() {
  const next = waiting;
  waiting = undefined;
  if (next) handleCandidateRequest(store, next, post);
}

self.onmessage = (event: MessageEvent<CandidateRequest>) => {
  const request = event.data;
  if (request.type !== "compute") { handleCandidateRequest(store, request, post); return; }
  if (waiting) post({ type: "computed", id: waiting.id, result: null });
  else setTimeout(run, 0);
  waiting = request;
};
