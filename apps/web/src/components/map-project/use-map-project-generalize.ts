"use client";

import { useCallback, useState } from "react";
import { MAP_PROJECT_SYNC_MAX_EDITS, type MapProjectView } from "@o-tid/contracts";
import { proposalBase, type GeneralizeOptions, type GeneralizeResult, type ObjectKey, type ObjectRef, type RevisionClientState, type RevisionEdit } from "@o-tid/map-revision";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import type { MapProjectSession } from "../../lib/map-project-protocol";
import { mapProjectGeneralizeSv } from "../../i18n/map-project-generalize-sv";

const text = mapProjectGeneralizeSv;
const MAX_PROPOSAL_BYTES = 3 * 1024 * 1024;

/**
 * ADR-0219 K6 (del 1): generaliseringen räknas i Workern för kartan med ändringarna och lämnas som förslag (källan GENERALIZE),
 * högst 200 ändringar och 3 MB per förslag. Objekt med egna ändringar som inte skickats eller en krock hoppas över.
 */
export function useMapProjectGeneralize(view: MapProjectView, session: MapProjectSession | undefined, state: RevisionClientState | undefined,
  onSent: () => void) {
  const base = mapProjectBase(view.projectId);
  const [result, setResult] = useState<{ value: GeneralizeResult; refs: ReadonlyMap<ObjectKey, ObjectRef>; options: GeneralizeOptions }>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  const preview = useCallback((options: GeneralizeOptions) => {
    if (!session) return;
    setBusy(text.computing); setMessage(undefined); setResult(undefined);
    session.generalize(options, (value, refs) => { setResult({ value, refs, options }); setBusy(undefined); });
  }, [session]);

  /**
   * Ändringarna som kan föreslås nu (och hur många som hoppas över), i grupper som hålls ihop: en ihopfogad linje (JOIN) med
   * linjerna som gick upp i den (JOINED) föreslås tillsammans eller inte alls, så att ingen del försvinner utan den andra.
   */
  const groups = useCallback((): { groups: RevisionEdit[][]; skipped: number } => {
    if (!result || !state) return { groups: [], skipped: 0 };
    const at = new Date().toISOString();
    const out: RevisionEdit[][] = [];
    let skipped = 0, current: { edits: RevisionEdit[]; ok: boolean; count: number } | undefined;
    const close = () => { if (current) { if (current.ok) out.push(current.edits); else skipped += current.count; } current = undefined; };
    for (const change of result.value.changes) {
      if (change.reason !== "JOINED") { close(); current = { edits: [], ok: true, count: 0 }; }
      current ??= { edits: [], ok: true, count: 0 };
      current.count += 1;
      const grounded = proposalBase(state, change.key);
      const ref = result.refs.get(change.key) ?? null;
      if (!grounded || (change.key.startsWith("b:") && !ref)) { current.ok = false; continue; }
      current.edits.push({ editId: crypto.randomUUID(), key: change.key, ref: change.key.startsWith("b:") ? ref : null, base: grounded.base, at,
        ...(change.object ? { kind: "RESHAPE" as const, state: { kind: "OBJECT" as const, object: change.object } }
          : { kind: "DELETE" as const, state: { kind: "DELETED" as const }, point: change.at }) });
    }
    close();
    return { groups: out, skipped };
  }, [result, state]);
  const edits = useCallback((): { edits: RevisionEdit[]; skipped: number } => {
    const planned = groups();
    return { edits: planned.groups.flat(), skipped: planned.skipped };
  }, [groups]);

  const propose = useCallback(async () => {
    if (!result) return;
    const { groups: all } = groups();
    if (all.length === 0) return;
    const parts: RevisionEdit[][] = [];
    let current: RevisionEdit[] = [], size = 0;
    for (const group of all) {
      const bytes = JSON.stringify(group).length;
      if (current.length && (current.length + group.length > MAP_PROJECT_SYNC_MAX_EDITS || size + bytes > MAX_PROPOSAL_BYTES)) { parts.push(current); current = []; size = 0; }
      current.push(...group); size += bytes;
    }
    if (current.length) parts.push(current);
    setMessage(undefined);
    for (const [index, part] of parts.entries()) {
      setBusy(text.sending(index + 1, parts.length));
      const response = await clubRequest(`${base}/proposals`, "POST", { formatVersion: 1, requestId: crypto.randomUUID(), source: "GENERALIZE",
        note: text.note(result.options.simplifyMm, result.options.removeSmall, index + 1, parts.length), edits: part })
        .catch(() => ({ status: 0, json: undefined }));
      if (response.status !== 200 && response.status !== 201) {
        setBusy(undefined);
        setMessage({ tone: "error", text: text.failed((response.json as { error?: string } | undefined)?.error ?? response.status) });
        return;
      }
    }
    setBusy(undefined); setResult(undefined);
    setMessage({ tone: "ok", text: text.sent(parts.length) });
    onSent();
  }, [result, groups, base, onSent]);

  return { result: result?.value, preview, propose, edits, busy, message, canPropose: view.viewer.canPropose };
}
