import { useState } from "react";
import { resultsOfficialResponseSchema, resultsOfficialStateSchema, type ResultsOfficialOutcome, type ResultsOfficialRequest,
  type ResultsOfficialState } from "@o-tid/contracts";
import { parseFrozenRaceFinalizations, validateFrozenIofResultListResponse } from "../../lib/iof-result-list-export-admin-client";
import { saveVerifiedDownload } from "../../lib/verified-download";
import { resultsOfficialSv as text } from "../../i18n/results-official-sv";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** "Resultaten är klara" (PLAN.md steg 27): läget, ett hinder att visa och ett besked. */
export function useResultsOfficialState() {
  const [resultsOfficial, setResultsOfficial] = useState<ResultsOfficialState>();
  const [resultsOfficialBlocked, setResultsOfficialBlocked] = useState<Extract<ResultsOfficialOutcome, { outcome: "BLOCKED" }>>();
  const [resultsOfficialMessage, setResultsOfficialMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  /** Begäran behålls efter ett nätfel så att "Försök igen" skickar samma. */
  const [resultsOfficialRequest, setResultsOfficialRequest] = useState<ResultsOfficialRequest>();
  return { resultsOfficial, setResultsOfficial, resultsOfficialBlocked, setResultsOfficialBlocked, resultsOfficialMessage,
    setResultsOfficialMessage, resultsOfficialRequest, setResultsOfficialRequest };
}

export function createResultsOfficialActions(ws: Base & RaceDataActions) {
  const { raceId, resultsOfficialRequest, writingRef, pending, requireSession, begin, beginRequest, finish, current, assertCurrent,
    request, json, csrf, setResultsOfficial, setResultsOfficialBlocked, setResultsOfficialMessage, setResultsOfficialRequest } = ws;

  async function readResultsOfficial(op: Parameters<typeof request>[1]) {
    const response = await request("/results-official", op);
    if (!response.ok) throw new Error("Results state unavailable");
    const value = resultsOfficialStateSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Results state scope mismatch");
    setResultsOfficial(value);
  }
  /** Ger "aborted" när läsningen inte blev av eller avbröts av ett annat anrop, så att den kan göras om. */
  async function loadResultsOfficial(): Promise<"ok" | "failed" | "aborted"> {
    if (writingRef.current || pending.current || !requireSession()) return "aborted";
    const op = beginRequest();
    try { await readResultsOfficial(op); return "ok"; }
    catch {
      if (!current(op)) return "aborted";
      setResultsOfficialMessage({ tone: "error", text: text.loadError }); return "failed";
    }
    finally { finish(op); }
  }
  async function markResults(action: ResultsOfficialRequest["action"]) {
    if (writingRef.current || pending.current || !requireSession()) return;
    const body: ResultsOfficialRequest = resultsOfficialRequest?.action === action ? resultsOfficialRequest
      : { formatVersion: 1, requestId: crypto.randomUUID(), action };
    setResultsOfficialRequest(body); setResultsOfficialMessage(undefined); setResultsOfficialBlocked(undefined);
    const op = begin(true);
    try {
      const response = await request("/results-official", op, { method: "POST", headers: { "content-type": "application/json",
        "x-otid-csrf": csrf(), "idempotency-key": `results-official:${body.requestId}` }, body: JSON.stringify(body) });
      if (response.status === 409) {
        setResultsOfficialRequest(undefined); setResultsOfficialMessage({ tone: "error", text: text.conflict }); return;
      }
      if (!response.ok) throw new Error("Results not marked");
      const receipt = resultsOfficialResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== body.requestId) throw new Error("Results receipt mismatch");
      setResultsOfficialRequest(undefined);
      if (receipt.result.outcome === "BLOCKED") setResultsOfficialBlocked(receipt.result);
      else setResultsOfficialMessage({ tone: "ok", text: receipt.result.outcome === "OFFICIAL" ? text.markedOfficial : text.markedPreliminary });
      await readResultsOfficial(op);
    } catch { if (current(op)) setResultsOfficialMessage({ tone: "error", text: text.unreachable }); }
    finally { finish(op); }
  }
  /** Den fastställda IOF-filen för Eventor; kontrollsumman jämförs med fastställandet innan filen sparas. */
  async function downloadOfficialResults(finalizationId: string) {
    if (writingRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setResultsOfficialMessage(undefined);
    try {
      const list = await request("/result-finalizations", op);
      if (!list.ok) throw new Error("History unavailable");
      const selected = parseFrozenRaceFinalizations(await json(list, op), raceId).finalizations.find(row => row.id === finalizationId);
      if (!selected) throw new Error("Finalization missing");
      const response = await request(`/result-finalizations/${selected.id}`, op);
      if (!response.ok) throw new Error("Frozen export unavailable");
      const filename = validateFrozenIofResultListResponse(response, selected);
      await saveVerifiedDownload(response, filename, selected.completeXmlSha256, () => assertCurrent(op));
      setResultsOfficialMessage({ tone: "ok", text: text.downloaded });
    } catch { if (current(op)) setResultsOfficialMessage({ tone: "error", text: text.downloadError }); }
    finally { finish(op); }
  }
  return { loadResultsOfficial, markResults, downloadOfficialResults };
}
