"use client";

import { useCallback, useMemo, useState } from "react";
import { mapProjectRectifyEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import { MAP_PROJECT_SYNC_MAX_EDITS, type MapProjectView } from "@o-tid/contracts";
import type { Point } from "@o-tid/map-file";
import {
  fitWarp, proposalBase, type ObjectKey, type ObjectRef, type RevisionClientState, type RevisionEdit, type WarpChange, type WarpKind, type WarpPair
} from "@o-tid/map-revision";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import type { MapProjectSession } from "../../lib/map-project-protocol";
import { mapProjectRectifySv } from "../../i18n/map-project-rectify-sv";

const MAX_PROPOSAL_BYTES = 3 * 1024 * 1024;
type Box = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * ADR-0219 K6b: rätta en äldre karta med passpunkter. Ett klick där något ligger på kartan nu och ett klick där det ska ligga
 * (t.ex. på ett ortofoto eller laserns skuggning) ger en passpunkt. Workern flyttar alla objekt (eller de i ett delområde)
 * likformigt, affint eller som gummiduk, och ändringarna lämnas som förslag (källan PROCESS) i delar om högst 200.
 */
export function useMapProjectRectify(view: MapProjectView, session: MapProjectSession | undefined, state: RevisionClientState | undefined,
  onSent: () => void) {
  const text = useTexts(mapProjectRectifySv, mapProjectRectifyEn);
  const base = mapProjectBase(view.projectId);
  const [picking, setPicking] = useState(false);
  const [pairs, setPairs] = useState<readonly WarpPair[]>([]);
  const [pending, setPending] = useState<Point>();
  const [chosen, setChosen] = useState<WarpKind>();
  const [result, setResult] = useState<{ changes: readonly WarpChange<ObjectKey>[]; refs: ReadonlyMap<ObjectKey, ObjectRef>; kind: WarpKind }>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  // Förval: likformig med två punkter, affin med tre eller fler; gummiduk väljs.
  const kind: WarpKind = chosen && (chosen === "similarity" || pairs.length >= 3) ? chosen : pairs.length >= 3 ? "affine" : "similarity";
  const fit = useMemo(() => fitWarp(pairs, kind), [pairs, kind]);

  const start = useCallback(() => { setPicking(true); setMessage(undefined); }, []);
  const stop = useCallback(() => { setPicking(false); setPending(undefined); }, []);
  const clear = useCallback(() => { setPairs([]); setPending(undefined); setResult(undefined); setChosen(undefined); }, []);
  const undo = useCallback(() => { if (pending) setPending(undefined); else { setPairs(current => current.slice(0, -1)); setResult(undefined); } }, [pending]);
  const remove = useCallback((index: number) => { setPairs(current => current.filter((_, at) => at !== index)); setResult(undefined); }, []);
  const choose = useCallback((next: WarpKind) => { setChosen(next); setResult(undefined); }, []);

  /** Ett klick på kartan: först där det ligger nu, sedan där det ska ligga. */
  const click = useCallback((at: Point) => {
    if (!pending) { setPending(at); return; }
    setPairs(current => [...current, { from: pending, to: at }]);
    setPending(undefined); setResult(undefined);
  }, [pending]);

  const preview = useCallback((within: Box | undefined) => {
    if (!session || !fit) return;
    setBusy(text.computing); setMessage(undefined); setResult(undefined);
    const used = kind;
    session.warp({ pairs, kind: used, within }, (changes, refs) => { setResult({ changes, refs, kind: used }); setBusy(undefined); });
  }, [session, fit, pairs, kind]);

  /** Ändringarna som kan föreslås nu; objekt med egna ändringar som inte skickats eller en krock hoppas över. */
  const edits = useCallback((): { edits: RevisionEdit[]; skipped: number } => {
    if (!result || !state) return { edits: [], skipped: 0 };
    const at = new Date().toISOString();
    const out: RevisionEdit[] = [];
    let skipped = 0;
    for (const change of result.changes) {
      const grounded = proposalBase(state, change.key);
      const ref = result.refs.get(change.key) ?? null;
      if (!grounded || (change.key.startsWith("b:") && !ref)) { skipped += 1; continue; }
      out.push({ editId: crypto.randomUUID(), key: change.key, ref: change.key.startsWith("b:") ? ref : null, base: grounded.base, at,
        kind: "MOVE", state: { kind: "OBJECT", object: change.object } });
    }
    return { edits: out, skipped };
  }, [result, state]);

  const propose = useCallback(async () => {
    if (!result) return;
    const all = edits().edits;
    if (all.length === 0) return;
    const parts: RevisionEdit[][] = [];
    let current: RevisionEdit[] = [], size = 0;
    for (const edit of all) {
      const bytes = JSON.stringify(edit).length;
      if (current.length && (current.length >= MAP_PROJECT_SYNC_MAX_EDITS || size + bytes > MAX_PROPOSAL_BYTES)) { parts.push(current); current = []; size = 0; }
      current.push(edit); size += bytes;
    }
    if (current.length) parts.push(current);
    setMessage(undefined);
    for (const [index, part] of parts.entries()) {
      setBusy(text.sending(index + 1, parts.length));
      const response = await clubRequest(`${base}/proposals`, "POST", { formatVersion: 1, requestId: crypto.randomUUID(), source: "PROCESS",
        note: text.note(result.kind, pairs.length, index + 1, parts.length), edits: part }).catch(() => ({ status: 0, json: undefined }));
      if (response.status !== 200 && response.status !== 201) {
        setBusy(undefined);
        setMessage({ tone: "error", text: text.failed((response.json as { error?: string } | undefined)?.error ?? response.status) });
        return;
      }
    }
    setBusy(undefined); setResult(undefined); setPairs([]); setPicking(false);
    setMessage({ tone: "ok", text: text.sent(parts.length) });
    onSent();
  }, [result, edits, base, pairs.length, onSent]);

  /** Passpunkterna att rita (kryss där det ligger, ring där det ska ligga) och de flyttade objekten i förhandsvisningen. */
  const markers = useMemo(() => [...pairs.map(pair => ({ image: pair.from, map: pair.to as Point | undefined })),
    ...(pending ? [{ image: pending, map: undefined }] : [])], [pairs, pending]);
  const shown = useMemo(() => result ? result.changes.slice(0, 3000).map(change => change.object) : [], [result]);

  return { picking, pairs, pending: !!pending, kind, chosen, fit, result, busy, message, markers, shown,
    start, stop, clear, undo, remove, choose, click, preview, edits, propose, canPropose: view.viewer.canPropose };
}
