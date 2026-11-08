"use client";

import { useCallback, useMemo, useState } from "react";
import { MAP_PROJECT_SYNC_MAX_EDITS, type MapProjectView } from "@o-tid/contracts";
import { isSupportedEpsg, type MapGeoreference, type MapObject } from "@o-tid/map-file";
import {
  guessCrs, importLayers, importObjects, newKey, sourcePointToMap, suggestSymbol, VectorParseError, WGS84_EPSG,
  type ImportLayer, type SourceData, type TargetKind
} from "@o-tid/map-revision";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { mapProjectBase } from "../../lib/map-project-client";
import { readVectorFiles } from "../../lib/map-project-vector-files";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { mapProjectImportSv } from "../../i18n/map-project-import-sv";

const text = mapProjectImportSv;
/** Ett förslag hålls under synkens gränser (antal och storlek). */
const MAX_PROPOSAL_BYTES = 3 * 1024 * 1024;
/** "unsupported", "crs", ett meddelande från läsningen eller en HTTP-status. */
type Problem = string | number;

/**
 * ADR-0219 tillägget om vektorunderlagen (K4b): en vektorfil läses i webbläsaren, lagren får symboler (förslag ur namnen),
 * kandidaterna visas på kartan och lämnas som förslag med källan IMPORT (högst 200 ändringar per förslag).
 */
export function useMapProjectImport(view: MapProjectView, georeference: MapGeoreference | undefined, bounds: Bounds | undefined,
  symbols: ReadonlyMap<string, CatalogSymbol>, onSent: () => void) {
  const base = mapProjectBase(view.projectId);
  const [file, setFile] = useState<{ name: string; data: SourceData }>();
  /** K4c: hämtat för en etapp klipps mot etappens ruta i stället för kartans. */
  const [clip, setClip] = useState<Bounds>();
  const [fetching, setFetching] = useState(false);
  const [layers, setLayers] = useState<readonly ImportLayer[]>([]);
  const [mapping, setMapping] = useState<ReadonlyMap<string, string>>(new Map());
  const [crs, setCrs] = useState<number>();
  const [problem, setProblem] = useState<Problem>();
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [sent, setSent] = useState<number>();
  const mapEpsg = georeference?.crs.kind === "EPSG" ? georeference.crs.code : undefined;

  const show = useCallback((fileName: string, data: SourceData, area?: Bounds) => {
    const found = importLayers(data);
    const list = [...symbols.values()].map(symbol => ({ id: symbol.id, code: symbol.code, kind: symbol.kind }));
    setFile({ name: fileName, data });
    setClip(area);
    setLayers(found);
    setMapping(new Map(found.flatMap(layer => { const id = suggestSymbol(layer, list); return id ? [[layer.name, id] as const] : []; })));
    setCrs(data.crs ?? guessCrs(data) ?? mapEpsg);
  }, [symbols, mapEpsg]);

  const open = useCallback(async (files: readonly File[]) => {
    setProblem(undefined); setSent(undefined);
    try {
      const read = await readVectorFiles(files);
      if (!read) { setProblem("unsupported"); return; }
      show(read.name, read.data);
    } catch (error) {
      setProblem(error instanceof VectorParseError ? error.message : "unsupported");
    }
  }, [show]);

  /** K4c: OpenStreetMap för kartans område eller en etapp (delområdets polygon i kartans mm), hämtat av servern. */
  const fetchOsm = useCallback(async (area?: BoxArea) => {
    if (!georeference || !bounds) return;
    setProblem(undefined); setSent(undefined); setFetching(true);
    const { box, wgs84 } = areaBox(bounds, georeference, area);
    const request = { formatVersion: 1, box: wgs84 };
    try {
      const response = await clubRequest(`${base}/sources/osm`, "POST", request).catch(() => ({ status: 0, json: undefined }));
      const body = response.json as { data?: SourceData; error?: string } | undefined;
      if (response.status !== 200 || !body?.data) { setProblem(body?.error ?? response.status); return; }
      show(area ? text.osmName(area.name) : text.osmName(), body.data, area ? box : undefined);
    } finally { setFetching(false); }
  }, [georeference, bounds, base, show]);

  const result = useMemo(() => {
    if (!file || !georeference || crs === undefined || !(crs === WGS84_EPSG || isSupportedEpsg(crs))) return undefined;
    const targets = new Map<string, { symbol: string; kind: TargetKind }>();
    for (const [layer, id] of mapping) {
      const kind = symbols.get(id)?.kind;
      if (kind === "point" || kind === "line" || kind === "area") targets.set(layer, { symbol: id, kind });
    }
    try {
      return importObjects(file.data.features, { mapping: targets, toMap: (x, y) => sourcePointToMap(georeference, crs, x, y), bounds: clip ?? bounds });
    } catch { return undefined; }
  }, [file, georeference, crs, mapping, symbols, bounds, clip]);

  const propose = useCallback(async () => {
    if (!file || !result || result.objects.length === 0) return;
    setProblem(undefined);
    const at = new Date().toISOString();
    const edits = result.objects.map((object: MapObject) => ({ editId: crypto.randomUUID(), key: newKey(crypto.randomUUID()), ref: null, base: null,
      state: { kind: "OBJECT", object }, kind: "ADD", at }));
    // Delarna: högst 200 ändringar och 3 MB per förslag.
    const parts: (typeof edits)[] = [];
    let current: typeof edits = [], size = 0;
    for (const edit of edits) {
      const bytes = JSON.stringify(edit).length;
      if (current.length && (current.length >= MAP_PROJECT_SYNC_MAX_EDITS || size + bytes > MAX_PROPOSAL_BYTES)) { parts.push(current); current = []; size = 0; }
      current.push(edit); size += bytes;
    }
    if (current.length) parts.push(current);
    setProgress({ done: 0, total: parts.length });
    for (const [index, part] of parts.entries()) {
      const response = await clubRequest(`${base}/proposals`, "POST", { formatVersion: 1, requestId: crypto.randomUUID(), source: "IMPORT",
        note: text.note(file.name, index + 1, parts.length), edits: part }).catch(() => ({ status: 0, json: undefined }));
      if (response.status !== 200 && response.status !== 201) { setProblem(response.status); setProgress(undefined); return; }
      setProgress({ done: index + 1, total: parts.length });
    }
    setProgress(undefined); setSent(parts.length); setFile(undefined); setLayers([]); setMapping(new Map());
    onSent();
  }, [file, result, base, onSent]);

  const choose = useCallback((layer: string, symbolId: string) => setMapping(current => {
    const next = new Map(current);
    if (symbolId) next.set(layer, symbolId); else next.delete(layer);
    return next;
  }), []);
  const cancel = useCallback(() => { setFile(undefined); setLayers([]); setMapping(new Map()); setProblem(undefined); }, []);

  return { file, layers, mapping, choose, crs, setCrs, result, problem, setProblem, progress, sent, open, fetchOsm, fetching, propose, cancel,
    candidates: result?.objects ?? [], canImport: view.viewer.canPropose };
}
