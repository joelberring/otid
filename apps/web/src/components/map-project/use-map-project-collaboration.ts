"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  MapProjectAreaList, MapProjectAreaStatus, MapProjectAiMode, MapProjectAreaView, MapProjectMode, MapProjectProposalList, MapProjectProposalView, MapProjectView
} from "@o-tid/contracts";
import type { Point } from "@o-tid/map-file";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase, mapProjectFailure } from "../../lib/map-project-client";

/** Förslagen hämtas igen så här ofta (när sidan syns) och direkt efter en egen synk som gav förslag. */
const PROPOSALS_POLL_MS = 30_000;

/**
 * ADR-0219 (K1): samarbetet i editorn – förslagen (lista, godkänn, avvisa, dra tillbaka), delområdena (rita, dela ut, status,
 * ta bort) och arbetssättet. Servern avgör behörigheten; svaret 403/409 blir ett besked.
 */
export function useMapProjectCollaboration(view: MapProjectView) {
  const base = mapProjectBase(view.projectId);
  const [mode, setMode] = useState<MapProjectMode>(view.mode);
  const [aiMode, setAiMode] = useState<MapProjectAiMode>(view.aiMode);
  const [areas, setAreas] = useState<readonly MapProjectAreaView[]>(view.areas);
  const [proposals, setProposals] = useState<readonly MapProjectProposalView[]>([]);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  const loadProposals = useCallback(async () => {
    try {
      const result = await clubRequest(`${base}/proposals`);
      if (result.status === 200) setProposals((result.json as MapProjectProposalList).proposals);
    } catch { /* Utan nät: listan visas som den var; synken säger att nätet saknas. */ }
  }, [base]);
  const loadAreas = useCallback(async () => {
    try {
      const result = await clubRequest(`${base}/areas`);
      if (result.status === 200) setAreas((result.json as MapProjectAreaList).areas);
    } catch { /* som ovan */ }
  }, [base]);

  useEffect(() => {
    void loadProposals();
    const timer = setInterval(() => { if (document.visibilityState === "visible") { void loadProposals(); void loadAreas(); } }, PROPOSALS_POLL_MS);
    return () => clearInterval(timer);
  }, [loadProposals, loadAreas]);

  async function run(action: () => Promise<{ status: number; json: unknown }>, after: () => Promise<void>): Promise<boolean> {
    setBusy(true); setProblem(undefined);
    try {
      const result = await action();
      if (result.status >= 200 && result.status < 300) { await after(); return true; }
      setProblem(mapProjectFailure(result.status));
      return false;
    } catch { setProblem(mapProjectFailure(0)); return false; }
    finally { setBusy(false); }
  }

  return {
    mode, aiMode, areas, proposals, problem, busy, setProblem, loadProposals, loadAreas,
    /** Ägaren 2026-11-12: vad AI-kopplingen får göra i projektet. */
    setAiMode: (next: MapProjectAiMode) => run(() => clubRequest(base, "PUT", { formatVersion: 1, aiMode: next }), async () => { setAiMode(next); }),
    setMode: (next: MapProjectMode) => run(() => clubRequest(base, "PUT", { formatVersion: 1, mode: next }), async () => { setMode(next); }),
    /** Alla öppna förslag, i omgångar tills inget återstår (servern tar en omgång per anrop). Ger antalen, eller undefined vid fel. */
    decideAll: async (action: "ACCEPT" | "REJECT", onProgress: (done: number, left: number) => void) => {
      setBusy(true); setProblem(undefined);
      let done = 0, conflicts = 0;
      try {
        for (let round = 0; round < 50; round += 1) {
          const result = await clubRequest(`${base}/proposals`, "PUT", { formatVersion: 1, action });
          if (result.status !== 200) { setProblem(mapProjectFailure(result.status)); return undefined; }
          const body = result.json as { decided: number; conflicts: number; remaining: number };
          done += body.decided; conflicts = body.conflicts;
          onProgress(done, body.remaining);
          if (body.decided === 0 || body.remaining <= conflicts) break;
        }
        return { done, conflicts };
      } catch { setProblem(mapProjectFailure(0)); return undefined; }
      finally { setBusy(false); await loadProposals(); }
    },
    decide: (proposalId: string, action: "ACCEPT" | "REJECT" | "WITHDRAW", note?: string) =>
      run(() => clubRequest(`${base}/proposals/${encodeURIComponent(proposalId)}`, "PUT", { formatVersion: 1, action, ...(note ? { note } : {}) }),
        loadProposals),
    createArea: (name: string, polygon: readonly (readonly Point[])[], assigneeAccountId: string | null) =>
      run(() => clubRequest(`${base}/areas`, "POST", { formatVersion: 1, requestId: crypto.randomUUID(), name, polygon,
        ...(assigneeAccountId ? { assigneeAccountId } : {}) }), loadAreas),
    updateArea: (areaId: string, change: { name?: string; assigneeAccountId?: string | null; status?: MapProjectAreaStatus; revisedOn?: string | null }) =>
      run(() => clubRequest(`${base}/areas/${encodeURIComponent(areaId)}`, "PUT", { formatVersion: 1, ...change }), loadAreas),
    removeArea: (areaId: string) => run(() => clubRequest(`${base}/areas/${encodeURIComponent(areaId)}`, "DELETE"), loadAreas)
  };
}
