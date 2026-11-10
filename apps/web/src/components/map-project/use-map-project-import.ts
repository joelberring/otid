"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { mapProjectImportEn } from "../../i18n/map-project-tools-en";
import { useTexts } from "../language-provider";
import { MAP_PROJECT_SYNC_MAX_EDITS, type MapLayerProfileView, type MapProjectView } from "@o-tid/contracts";
import { isSupportedEpsg, type MapGeoreference, type MapObject } from "@o-tid/map-file";
import {
  guessCrs, importLayers, importObjects, newKey, sourcePointToMap, suggestSymbol, VectorParseError, WGS84_EPSG,
  type ImportLayer, type SourceData, type TargetKind
} from "@o-tid/map-revision";
import { clubRequest, csrf } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { mapProjectBase } from "../../lib/map-project-client";
import { readVectorFiles } from "../../lib/map-project-vector-files";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { mapProjectImportSv } from "../../i18n/map-project-import-sv";

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
  const text = useTexts(mapProjectImportSv, mapProjectImportEn);
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
  /** K6b: DWG-ritningen som skickats till geo-servern. */
  const [dwgSent, setDwgSent] = useState<string>();
  const mapEpsg = georeference?.crs.kind === "EPSG" ? georeference.crs.code : undefined;

  /** K6b: sparade lagermappningsprofiler (kontots och klubbens) och den som passade filen. */
  const [profiles, setProfiles] = useState<readonly MapLayerProfileView[]>([]);
  const [profile, setProfile] = useState<{ name: string; matched: number; layers: number }>();
  const loadProfiles = useCallback(async () => {
    if (!view.viewer.canPropose) return;
    const response = await clubRequest(`${base}/layer-profiles`, "GET").catch(() => undefined);
    if (response?.status === 200) setProfiles((response.json as { profiles: MapLayerProfileView[] }).profiles);
  }, [base, view.viewer.canPropose]);
  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  const show = useCallback((fileName: string, data: SourceData, area?: Bounds) => {
    const found = importLayers(data);
    const list = [...symbols.values()].map(symbol => ({ id: symbol.id, code: symbol.code, kind: symbol.kind }));
    setFile({ name: fileName, data });
    setClip(area);
    setLayers(found);
    const suggested = new Map(found.flatMap(layer => { const id = suggestSymbol(layer, list); return id ? [[layer.name, id] as const] : []; }));
    // En profil vars lager täcker minst hälften av filens lager används; dess val går före förslagen ur namnen.
    const names = new Set(found.map(layer => layer.name));
    const best = profiles.map(row => ({ row, matched: row.rules.filter(rule => names.has(rule.layer)).length }))
      .sort((a, b) => b.matched - a.matched)[0];
    if (best && best.matched > 0 && best.matched * 2 >= found.length) {
      for (const rule of best.row.rules) {
        if (!names.has(rule.layer)) continue;
        const symbol = list.find(row => row.kind === rule.kind && (row.code === rule.code || row.code === `${rule.code}.0`));
        if (symbol) suggested.set(rule.layer, symbol.id);
      }
      setProfile({ name: best.row.name, matched: best.matched, layers: found.length });
    } else setProfile(undefined);
    setMapping(suggested);
    setCrs(data.crs ?? guessCrs(data, georeference) ?? mapEpsg);
  }, [symbols, mapEpsg, profiles, georeference]);

  /** Spara lagrens val som en profil (ersätter samma namn); symbolerna sparas som nummer så att profilen gäller andra kartor. */
  const saveProfile = useCallback(async (name: string, shareWithClub: boolean): Promise<boolean> => {
    const rules = [...mapping].flatMap(([layer, id]) => {
      const symbol = symbols.get(id);
      const code = symbol?.code.replace(/\.0$/, "");
      return symbol && code && /^\d{3}(\.\d{1,2})?$/.test(code) && symbol.kind !== "text" ? [{ layer, code, kind: symbol.kind }] : [];
    });
    if (rules.length === 0 || !name.trim()) return false;
    const response = await clubRequest(`${base}/layer-profiles`, "POST", { formatVersion: 1, requestId: crypto.randomUUID(), name: name.trim(), shareWithClub, rules })
      .catch(() => ({ status: 0, json: undefined }));
    if (response.status !== 201) { setProblem(response.status); return false; }
    setProfile({ name: name.trim(), matched: rules.length, layers: layers.length });
    await loadProfiles();
    return true;
  }, [mapping, symbols, base, layers.length, loadProfiles]);

  const open = useCallback(async (files: readonly File[]) => {
    setProblem(undefined); setSent(undefined); setDwgSent(undefined);
    // K6b: en DWG-ritning görs om till DXF på geo-servern (LibreDWG) och läses in därifrån.
    const dwg = files.find(file => /\.dwg$/i.test(file.name));
    if (dwg) {
      const token = csrf();
      if (!token) { setProblem(401); return; }
      setFetching(true);
      try {
        const response = await fetch(`${base}/geo-jobs/dwg`, { method: "POST", credentials: "same-origin", cache: "no-store", body: dwg,
          headers: { "content-type": "application/octet-stream", "x-otid-csrf": token, "x-otid-request-id": crypto.randomUUID(),
            "x-otid-file-name": encodeURIComponent(dwg.name.slice(0, 200)) } }).catch(() => undefined);
        if (response?.status === 200 || response?.status === 201) { setDwgSent(dwg.name); return; }
        const body = await response?.json().catch(() => undefined) as { error?: string } | undefined;
        setProblem(body?.error ?? response?.status ?? 0);
      } finally { setFetching(false); }
      return;
    }
    try {
      const read = await readVectorFiles(files);
      if (!read) { setProblem("unsupported"); return; }
      show(read.name, read.data);
    } catch (error) {
      setProblem(error instanceof VectorParseError ? error.message : "unsupported");
    }
  }, [show, base]);

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
      // Trappan (532) byggs av baskartornas steglinjer.
      const stairSymbols = new Set([...symbols.values()].filter(symbol => symbol.code.replace(/\.0+$/, "") === "532").map(symbol => symbol.id));
      return importObjects(file.data.features, { mapping: targets, toMap: (x, y) => sourcePointToMap(georeference, crs, x, y), bounds: clip ?? bounds,
        stairSymbols });
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

  /** K5: geo-arbetarens kurvor (DXF) som kandidater. */
  const openData = useCallback((fileName: string, data: SourceData) => { setProblem(undefined); setSent(undefined); show(fileName, data); }, [show]);
  return { file, layers, mapping, choose, crs, setCrs, result, problem, setProblem, progress, sent, dwgSent, open, openData, fetchOsm, fetching, propose, cancel,
    profile, saveProfile, canShareProfile: !!view.club,
    candidates: result?.objects ?? [], canImport: view.viewer.canPropose };
}
