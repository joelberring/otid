"use client";

import { useCallback, useMemo, useState } from "react";
import { mapProjectRectifyEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import { MAP_PROJECT_SYNC_MAX_EDITS, type GeoJobList, type MapProjectView } from "@o-tid/contracts";
import { mapPointToProjected, projectedToMapPoint, type MapGeoreference, type Point } from "@o-tid/map-file";
import { heightFieldFrom, terrainFitPlan, terrainFitSolve, terrainNodeCost } from "@o-tid/map-revision/base-map";
import {
  fitWarp, proposalBase, samplePath, type ObjectKey, type ObjectRef, type RevisionClientState, type RevisionEdit, type WarpChange, type WarpKind, type WarpPair
} from "@o-tid/map-revision";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import { HEIGHT_IMAGE, HEIGHT_WORLD, jobHeights } from "../../lib/map-project-clear-contours";
import type { CatalogSymbol, MapProjectSession, SymbolObject } from "../../lib/map-project-protocol";
import { stageChoices } from "../../lib/map-project-stages";
import type { ObjectChange } from "./use-map-project-editor";
import { mapProjectRectifySv } from "../../i18n/map-project-rectify-sv";

const MAX_PROPOSAL_BYTES = 3 * 1024 * 1024;
/** Kartans höjdkurvor (inte hjälpkurvor eller lutningsstreck) passas in mot lasern. */
const CONTOUR_CODE = /^10[12](\.0+)?$/;
const pause = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });
type Box = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * ADR-0219 K6b: rätta en äldre karta med passpunkter. Ett klick där något ligger på kartan nu och ett klick där det ska ligga
 * (t.ex. på ett ortofoto eller laserns skuggning) ger en passpunkt. Workern flyttar alla objekt (eller de i ett delområde)
 * likformigt, affint eller som gummiduk, och ändringarna lämnas som förslag (källan PROCESS) i delar om högst 200.
 */
export function useMapProjectRectify(view: MapProjectView, session: MapProjectSession | undefined, state: RevisionClientState | undefined,
  onSent: () => void, georeference?: MapGeoreference, symbols?: ReadonlyMap<string, CatalogSymbol>,
  /** Flyttar objekten direkt som ett steg (ägaren och ritare); utan den går det bara att lämna förslag. */
  commitMany?: (changes: readonly ObjectChange[]) => number) {
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

  /** Den som får rita flyttar objekten direkt (ett steg att ångra) i stället för att lämna hundratals förslag. */
  const apply = useCallback(() => {
    if (!result || !commitMany) return;
    const count = commitMany(result.changes.flatMap((change): ObjectChange[] => {
      const ref = result.refs.get(change.key) ?? null;
      return change.key.startsWith("b:") && !ref ? [] : [{ key: change.key, ref, kind: "MOVE", after: { kind: "OBJECT", object: change.object }, point: change.at }];
    }));
    setResult(undefined); setPairs([]); setPicking(false);
    setMessage({ tone: "ok", text: text.applied(count) });
  }, [result, commitMany]);

  /**
   * Ägaren 2026-11-14 (Lida, Arboga: en äldre karta som är skev mot lasern): passpunkter ur lasern. Kartans höjdkurvor passas
   * in mot markens höjd del för del (`terrainFitPlan` m.fl.), och varje del blir en passpunkt för gummiduken.
   */
  type Job = Pick<GeoJobList["jobs"][number], "jobId" | "name" | "status" | "createdAt" | "clip">;
  const [jobs, setJobs] = useState<readonly Job[]>();
  const loadJobs = useCallback(async () => {
    if (jobs) return;
    const response = await clubRequest(`${base}/geo-jobs`).catch(() => ({ status: 0, json: undefined }));
    const list = response.status === 200 ? (response.json as GeoJobList).jobs : [];
    setJobs(list.filter(job => job.status === "DONE" && [HEIGHT_IMAGE, HEIGHT_WORLD].every(name => job.outputs.some(output => output.name === name)))
      .map(job => ({ jobId: job.jobId, name: job.name, status: job.status, createdAt: job.createdAt, clip: job.clip })));
  }, [jobs, base]);
  const laserChoices = useMemo(() => jobs ? stageChoices(jobs) : undefined, [jobs]);
  const fromLaser = useCallback(async (choiceId: string) => {
    const choice = laserChoices?.find(row => row.id === choiceId) ?? laserChoices?.[0];
    if (!session || !georeference || georeference.crs.kind !== "EPSG" || !symbols || !choice) return;
    const crs = georeference.crs.code;
    setBusy(text.laser.reading); setMessage(undefined); setResult(undefined);
    try {
      const parts = (await Promise.all(choice.jobs.map(row => jobHeights(base, { jobId: row.jobId, outputs: [{ name: HEIGHT_IMAGE }, { name: HEIGHT_WORLD }] }, crs))))
        .filter(part => part !== undefined && part !== "failed");
      if (parts.length === 0) { setMessage({ tone: "error", text: text.laser.failed }); return; }
      const field = heightFieldFrom(parts);
      // Kartans höjdkurvor, symbol för symbol (Workern svarar på en fråga i taget), som punkter med 10 m emellan i terrängen.
      const step = 10_000 / georeference.scale, contours: (readonly [number, number])[][] = [];
      for (const symbol of [...symbols.values()].filter(row => row.kind === "line" && CONTOUR_CODE.test(row.code))) {
        const objects = await new Promise<readonly SymbolObject[]>(resolve => session.bySymbol(symbol.id, resolve));
        for (const { object } of objects) {
          if (object.kind !== "line") continue;
          contours.push(samplePath(object.path, step).map(point => { const at = mapPointToProjected(georeference, point); return [at.easting, at.northing] as const; }));
        }
      }
      if (contours.length === 0) { setMessage({ tone: "error", text: text.laser.noContours }); return; }
      const plan = terrainFitPlan(contours);
      if (plan.nodes.length < 3) { setMessage({ tone: "error", text: text.laser.noNodes }); return; }
      const costs: Float32Array[] = [];
      for (let index = 0; index < plan.nodes.length; index += 1) {
        setBusy(text.laser.fitting(index + 1, plan.nodes.length));
        await pause();
        costs.push(terrainNodeCost(plan, index, field.heightAt));
      }
      const fitted = terrainFitSolve(plan, costs);
      const toMap = (x: number, y: number) => projectedToMapPoint(georeference, { easting: x, northing: y });
      setPairs(fitted.nodes.map(node => ({ from: toMap(node.at[0], node.at[1]), to: toMap(node.at[0] + node.shift[0], node.at[1] + node.shift[1]) })));
      setPending(undefined); setChosen("rubber");
      const number = (value: number, digits: number) => value.toLocaleString("sv-SE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
      setMessage({ tone: "ok", text: text.laser.done(fitted.nodes.length, number(fitted.before, 2), number(fitted.after, 2), number(fitted.medianShift, 0), number(fitted.maxShift, 0)) });
    } catch (error) {
      console.error("Kartan kunde inte passas in mot lasern", error);
      setMessage({ tone: "error", text: text.laser.failed });
    } finally { setBusy(undefined); }
  }, [session, georeference, symbols, laserChoices, base]);

  /** Passpunkterna att rita (kryss där det ligger, ring där det ska ligga) och de flyttade objekten i förhandsvisningen. */
  const markers = useMemo(() => [...pairs.map(pair => ({ image: pair.from, map: pair.to as Point | undefined })),
    ...(pending ? [{ image: pending, map: undefined }] : [])], [pairs, pending]);
  const shown = useMemo(() => result ? result.changes.slice(0, 3000).map(change => change.object) : [], [result]);

  return { picking, pairs, pending: !!pending, kind, chosen, fit, result, busy, message, markers, shown,
    start, stop, clear, undo, remove, choose, click, preview, edits, propose, canPropose: view.viewer.canPropose,
    apply, canApply: !!commitMany && view.viewer.canEdit, loadJobs, laserChoices, fromLaser, canLaser: !!georeference && georeference.crs.kind === "EPSG" };
}
