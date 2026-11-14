"use client";

import { GEO_WORKER_VERSION } from "@o-tid/contracts";
import { swedishToday } from "@o-tid/domain";
import { mapMarkingEn } from "../../i18n/map-marking-en";
import { mapMarkingSv } from "../../i18n/map-marking-sv";
import { baseMapMarking, type BaseMapOrigin } from "../../lib/map-project-marking";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapProjectImportEn } from "../../i18n/map-project-tools-en";
import { useTexts } from "../language-provider";
import { MAP_PROJECT_SYNC_MAX_EDITS, type MapLayerProfileView, type MapProjectView } from "@o-tid/contracts";
import { isSupportedEpsg, type MapGeoreference, type MapObject, type PathCommand } from "@o-tid/map-file";
import {
  fitClassOf, guessCrs, importLayers, isSprintNorm, mapNorm, newKey, samplePath, sourcePointToMap, suggestSymbol, VectorParseError, WGS84_EPSG,
  type FitPoint, type ImportLayer, type SourceData, type SourceFeature, type VectorFit
} from "@o-tid/map-revision";
import { clubRequest, csrf } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { mapProjectBase } from "../../lib/map-project-client";
import type { BaseMapStep, CalmOutcome, ClearOutcome, CandidateInput, CandidateResult } from "../../lib/map-project-candidates";
import { CandidateSession } from "../../lib/map-project-candidates-client";
import { controlledWorker } from "../../lib/course-setting-worker";
import { calmFlatContours, clearContours, flatLimitsAt, mergeCandidates, restoreFlatContours, sprintOsm, suggestedMapping, type ClearSettings, type HeightField } from "@o-tid/map-revision/base-map";
import { readVectorFiles } from "../../lib/map-project-vector-files";
import type { CatalogSymbol, MapProjectSession } from "../../lib/map-project-protocol";
import type { ObjectChange } from "./use-map-project-editor";
import { mapProjectImportSv } from "../../i18n/map-project-import-sv";

const createCandidateWorker = () => controlledWorker(() => new Worker(new URL("../../lib/map-project-candidates-worker.ts", import.meta.url), { type: "module" }));
/** Ett förslag hålls under synkens gränser (antal och storlek). */
const MAX_PROPOSAL_BYTES = 3 * 1024 * 1024;
/** "unsupported", "crs", ett meddelande från läsningen eller en HTTP-status. */
type Problem = string | number;

/**
 * ADR-0219 tillägget om vektorunderlagen (K4b): en vektorfil läses i webbläsaren, lagren får symboler (förslag ur namnen),
 * kandidaterna visas på kartan och lämnas som förslag med källan IMPORT (högst 200 ändringar per förslag).
 */
/** Samma tomma lista varje gång, så att kartan inte ritas om i onödan när det inte finns några kandidater. */
const NO_CANDIDATES: readonly MapObject[] = [];

export function useMapProjectImport(view: MapProjectView, georeference: MapGeoreference | undefined, bounds: Bounds | undefined,
  symbols: ReadonlyMap<string, CatalogSymbol>, onSent: () => void, session?: MapProjectSession,
  /** Lägger många nya objekt direkt i kartan som ett steg (editorns `commitMany`); utan den går det bara att lämna förslag. */
  commitMany?: (changes: readonly ObjectChange[]) => number) {
  const text = useTexts(mapProjectImportSv, mapProjectImportEn);
  const markingText = useTexts(mapMarkingSv, mapMarkingEn);
  const base = mapProjectBase(view.projectId);
  const [file, setFile] = useState<{ name: string; data: SourceData }>();
  /** K4c: hämtat för en etapp klipps mot etappens ruta i stället för kartans. */
  const [clip, setClip] = useState<Bounds>();
  /** Etappens gräns (kartans mm) när ett laserjobb för en etapp läses in: kandidaterna klipps mot den också. */
  const [stage, setStage] = useState<readonly (readonly { x: number; y: number }[])[]>();
  const [fetching, setFetching] = useState(false);
  const [layers, setLayers] = useState<readonly ImportLayer[]>([]);
  const [mapping, setMapping] = useState<ReadonlyMap<string, string>>(new Map());
  const [crs, setCrs] = useState<number>();
  /** Kartans bebyggda ytor (hämtas ur Workern när en fil öppnas) och om kandidaterna ska hållas utanför dem. */
  const [built, setBuilt] = useState<readonly [number, number][][][]>([]);
  const [maskBuiltOn, setMaskBuiltOn] = useState(true);
  /** Ägaren 2026-11-10: inpassningen mot kartan (efter koordinatsystemet), "running" medan den räknas, null om den inte gick. */
  const [fit, setFit] = useState<VectorFit | "running" | null>();
  const [problem, setProblem] = useState<Problem>();
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [sent, setSent] = useState<number>();
  /** Lager som inte ska läggas in (ägaren 2026-11-11: gå igenom lagren ett och ett innan de flyttar till kartan). */
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  /** Kandidaterna gömda på kartan för en stund, för att jämföra med kartan som den är. */
  const [hideOnMap, setHideOnMap] = useState(false);
  /** Grundkartan G2b: så många objekt lades direkt i kartan senast. */
  const [accepted, setAccepted] = useState<number>();
  /** K6b: DWG-ritningen som skickats till geo-servern. */
  const [dwgSent, setDwgSent] = useState<string>();
  const mapEpsg = georeference?.crs.kind === "EPSG" ? georeference.crs.code : undefined;
  /**
   * Ägaren 2026-11-13 (sprintnormen som egen variant): kartans norm ur skalan och symbolerna. På en sprintkarta följer
   * förslagen lager → symbol sprintnormen, och OpenStreetMaps belagda vägar blir ytor med antagen bredd.
   */
  const symbolList = useMemo(() => [...symbols.values()].map(symbol => ({ id: symbol.id, code: symbol.code, kind: symbol.kind, name: symbol.name })), [symbols]);
  const norm = useMemo(() => mapNorm({ scale: georeference?.scale, symbols: symbolList }), [georeference?.scale, symbolList]);
  const sprint = isSprintNorm(norm);

  /** K6b: sparade lagermappningsprofiler (kontots och klubbens) och den som passade filen. */
  const [profiles, setProfiles] = useState<readonly MapLayerProfileView[]>([]);
  const [profile, setProfile] = useState<{ name: string; matched: number; layers: number }>();
  const loadProfiles = useCallback(async () => {
    if (!view.viewer.canPropose) return;
    const response = await clubRequest(`${base}/layer-profiles`, "GET").catch(() => undefined);
    if (response?.status === 200) setProfiles((response.json as { profiles: MapLayerProfileView[] }).profiles);
  }, [base, view.viewer.canPropose]);
  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  /** Ägaren 2026-11-11: kandidaterna ur lasern och tolkningarna generaliseras efter normen (förval); andra filer inte. */
  const [normed, setNormed] = useState(false);
  /**
   * «Lugna kurvor på flack mark» (ägaren 2026-11-13): det som reglaget har tagit bort och satt dit i kandidaterna som visas,
   * så att en annan nivå utgår från kurvorna som de var. Glöms när andra kandidater öppnas.
   */
  const [calm, setCalm] = useState<CalmOutcome>();
  /**
   * «Tydligare kurvbild» (ägaren 2026-11-14): det reglagen har bytt ut, ovanpå de lugnade kurvorna. Inställningarna och höjden
   * sparas så att de läggs på igen när «Lugna kurvor» ändras.
   */
  const [clear, setClear] = useState<ClearOutcome>();
  /** Grundkartan ur ett laserjobb (ägaren 2026-11-14, kartans märkning): jobbets inställningar, till rutan i kartans hörn. */
  const [origin, setOrigin] = useState<BaseMapOrigin>();
  const [marked, setMarked] = useState<string>();
  const clearWith = useRef<{ settings: ClearSettings; field: HeightField } | undefined>(undefined);
  const show = useCallback((fileName: string, data: SourceData, area?: Bounds, general = false, within?: readonly (readonly { x: number; y: number }[])[]) => {
    setNormed(general); setStage(within); setCalm(undefined); setClear(undefined); clearWith.current = undefined; setOrigin(undefined);
    const found = importLayers(data);
    const list = symbolList;
    setFile({ name: fileName, data });
    setHideOnMap(false);
    setSkipped(new Set());
    setFit(undefined);
    setClip(area);
    setLayers(found);
    const suggested = suggestedMapping(found, list, norm);
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
  }, [symbolList, norm, mapEpsg, profiles, georeference]);

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
      show(area ? text.osmName(area.name) : text.osmName(), sprint ? sprintOsm(body.data) : body.data, area ? box : undefined);
    } finally { setFetching(false); }
  }, [georeference, bounds, base, show, sprint]);

  /**
   * Ägaren 2026-11-12 («sidan svarar inte» på ett helt kartblad): kandidaterna räknas i en egen Worker
   * (`map-project-candidates-worker.ts`). Medan en ny uträkning pågår står den förra kvar (samma fil) och `computing` är sann.
   */
  const workerRef = useRef<CandidateSession | undefined>(undefined);
  const worker = useCallback(() => workerRef.current ??= new CandidateSession(createCandidateWorker), []);
  useEffect(() => () => { workerRef.current?.close(); workerRef.current = undefined; }, []);
  const fitted = fit && fit !== "running" ? fit : undefined;
  const input = useMemo((): CandidateInput | undefined => {
    if (!georeference || crs === undefined || !(crs === WGS84_EPSG || isSupportedEpsg(crs))) return undefined;
    return { georeference, crs, mapping: [...mapping], skipped: [...skipped], bounds, clip, area: view.area ?? undefined, stage, fit: fitted, normed,
      built, maskBuilt: maskBuiltOn, symbols: [...symbols.values()].map(symbol => [symbol.id, symbol.code, symbol.kind] as const) };
  }, [georeference, crs, mapping, symbols, bounds, clip, stage, fitted, skipped, normed, view.area, built, maskBuiltOn]);
  const [computed, setComputed] = useState<{ name: string; features: readonly SourceFeature[]; input: CandidateInput; result: CandidateResult | undefined }>();
  useEffect(() => {
    if (!file || !input) return;
    const { name, data: { features } } = file;
    worker().compute(features, input, result => setComputed({ name, features, input, result }));
  }, [file, input, worker]);
  const computing = !!file && !!input && (computed?.features !== file.data.features || computed.input !== input);
  // Den förra uträkningen visas medan den nya räknas, men bara för samma fil (en annan fil visar inget förrän den är klar).
  const result = file && input && computed?.name === file.name ? computed.result : undefined;

  /** Grundkartans filer (text) tolkas och sätts ihop i samma Worker; `onStep` får var den är. */
  const readBaseMap = useCallback((request: Parameters<CandidateSession["baseMap"]>[0], onStep: (step: BaseMapStep) => void) =>
    worker().baseMap({ ...request, norm }, onStep), [worker, norm]);

  // Ytorna hämtas på nytt för varje fil, så att det som ritats sedan sist är med.
  useEffect(() => { if (file && session) session.built(setBuilt); }, [file, session]);

  /**
   * "Passa in mot kartan": lagren som fått hus, vägar, vatten, murar eller järnväg som punkter i kartans mm, inpassade mot
   * kartans objekt med samma sorts symbol (i Workern). Förskjutning, vridning och skala läggs sedan på alla objekt.
   */
  const fitToMap = useCallback(() => {
    if (!file || !georeference || !session || crs === undefined || !(crs === WGS84_EPSG || isSupportedEpsg(crs))) return;
    const source: FitPoint[] = [];
    try {
      for (const { layer, geometry } of file.data.features) {
        const code = symbols.get(mapping.get(layer) ?? "")?.code;
        const kind = code ? fitClassOf(Number(code.split(".")[0])) : undefined;
        if (!kind || geometry.kind === "point") continue;
        for (const ring of geometry.kind === "line" ? [geometry.points] : geometry.rings) {
          const path: PathCommand[] = ring.map(([x, y], index) => ({ type: index ? "L" : "M", ...sourcePointToMap(georeference, crs, x, y) }));
          for (const at of samplePath(path, 1)) source.push({ at, kind });
        }
        if (source.length > 200_000) break;
      }
    } catch { setFit(null); return; }
    if (source.length < 10) { setFit(null); return; }
    setFit("running");
    session.fit(source, result => setFit(result));
  }, [file, georeference, session, crs, mapping, symbols]);

  const propose = useCallback(async () => {
    if (!file || !result || result.objects.length === 0 || computing) return;
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
  }, [file, result, computing, base, onSent]);

  /**
   * Ägaren 2026-11-10 («godkännas i ett svep»): alla kandidater läggs i kartan som egna ändringar i ett steg (Ångra tar bort
   * alla igen). Den som bara får föreslå får dem som förslag, som med allt annat den ritar.
   */
  const accept = useCallback(() => {
    if (!file || !result || result.objects.length === 0 || !commitMany || computing) return;
    setProblem(undefined); setSent(undefined);
    // En karta gjord ny i O-Tid (den har märkningens symboler) får ramen, loggan och rutan med grundkartan, en gång.
    const marking = origin && georeference ? baseMapMarking({ symbols, objects: result.objects, bounds, scale: georeference.scale, text: markingText,
      facts: { host: window.location.host, date: swedishToday(new Date()), worker: GEO_WORKER_VERSION, scale: georeference.scale, scannedAt: origin.scannedAt ?? undefined,
        settings: Object.entries(origin.settings), calm: calm?.level, clear: clear && [clear.settings.smooth, clear.settings.formlines, clear.settings.rings] } }) : undefined;
    const count = commitMany([...result.objects, ...(marking?.objects ?? [])].map((object: MapObject) => ({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD" as const,
      after: { kind: "OBJECT" as const, object } })));
    setMarked(marking?.paper);
    setAccepted(count); setFile(undefined); setLayers([]); setMapping(new Map());
  }, [file, result, computing, commitMany, origin, georeference, symbols, bounds, markingText, calm, clear]);

  const choose = useCallback((layer: string, symbolId: string) => setMapping(current => {
    const next = new Map(current);
    if (symbolId) next.set(layer, symbolId); else next.delete(layer);
    return next;
  }), []);
  const cancel = useCallback(() => { setFile(undefined); setLayers([]); setMapping(new Map()); setProblem(undefined); setPendingReplace(undefined); }, []);

  /** Nya kandidater som väntar på svar: de som visas är inte införda (frågan i kandidaternas rad). */
  const [pendingReplace, setPendingReplace] = useState<{ fileName: string; open: () => void }>();
  /** K5: geo-arbetarens kurvor (DXF) som kandidater. */
  const openData = useCallback((fileName: string, data: SourceData, general = false, within?: readonly (readonly { x: number; y: number }[])[], calmed?: CalmOutcome,
    cleared?: { outcome: ClearOutcome; field: HeightField }, from?: BaseMapOrigin) => {
    const open = () => {
      setProblem(undefined); setSent(undefined); setAccepted(undefined); show(fileName, data, undefined, general, within); setCalm(calmed); setOrigin(from);
      setClear(cleared?.outcome); clearWith.current = cleared && { settings: cleared.outcome.settings, field: cleared.field };
    };
    // Ägaren 2026-11-12 («försvinner kartan … om den inte är nersparad»): andra kandidater som inte är införda byts inte ut utan
    // fråga. Frågan står i kandidaternas rad under kartan (ingen dialogruta; ägaren 2026-11-13 fick den som webbläsarens ruta).
    if (file && file.name !== fileName && file.data.features.length > 0) { setPendingReplace({ fileName, open }); return; }
    setPendingReplace(undefined); open();
  }, [show, file]);
  /** En panel med reglage byter sina egna lager (`own`) i det som visas; utan något som visas öppnas datan som vanligt. */
  const refine = useCallback((fileName: string, data: SourceData, own: RegExp) => {
    if (!file) { openData(fileName, data, true); return; }
    const merged = mergeCandidates(file.data, data, own);
    const found = importLayers(merged);
    setFile({ name: file.name, data: merged });
    setLayers(found);
    // Nya lager får förslag ur namnen; de som redan hade en symbol behåller den.
    setMapping(current => new Map([...found.flatMap(layer => { const id = suggestSymbol(layer, symbolList, norm); return id ? [[layer.name, id] as const] : []; }),
      ...[...current].filter(([layer]) => found.some(row => row.name === layer))]));
  }, [file, openData, symbolList, norm]);
  /**
   * Reglaget «Lugna kurvor på flack mark»: kurvorna och hjälpkurvorna i det som visas byts mot de lugnade (inga dubbletter),
   * räknade från kurvorna som de var före förra nivån. `slopeAt` ger markens medellutning i kandidaternas koordinatsystem.
   */
  const calmContours = useCallback((level: number, slopeAt: (x: number, y: number) => number | undefined): CalmOutcome | undefined => {
    if (!file) return undefined;
    // «Tydligare kurvbild» ligger ovanpå: den tas bort först och läggs på igen efteråt.
    const before = clear ? restoreFlatContours(file.data.features, clear) : file.data.features;
    const result = calmFlatContours(calm ? restoreFlatContours(before, calm) : before, slopeAt, flatLimitsAt(level));
    const outcome = { removed: result.removed, added: result.added, formlineMeters: result.formlineMeters, rings: result.rings, level };
    const again = clear && clearWith.current ? clearContours(result.features, clearWith.current.field, clearWith.current.settings) : undefined;
    const data = { ...file.data, features: again?.features ?? result.features };
    setFile({ name: file.name, data }); setLayers(importLayers(data)); setCalm(outcome);
    setClear(again && clearWith.current ? { ...again, settings: clearWith.current.settings } : undefined);
    return outcome;
  }, [file, calm, clear]);
  /** Reglagen «Tydligare kurvbild»: kurvorna i det som visas byts mot de utjämnade och gallrade, räknade från de lugnade. */
  const clearCurves = useCallback((settings: ClearSettings, field: HeightField): ClearOutcome | undefined => {
    if (!file) return undefined;
    const result = clearContours(clear ? restoreFlatContours(file.data.features, clear) : file.data.features, field, settings);
    const outcome = { ...result, settings };
    const data = { ...file.data, features: result.features };
    clearWith.current = { settings, field };
    setFile({ name: file.name, data }); setLayers(importLayers(data)); setClear(outcome);
    return outcome;
  }, [file, clear]);
  return { file, calm, calmContours, clear, clearCurves, /** Pappret som märkningens ram gjordes för när grundkartan lades in. */ marked, /** Höjden som «Tydligare kurvbild» senast räknades med. */ clearField: () => clearWith.current?.field,
    /** Nya kandidater väntar på svar (de som visas är inte införda): läs in dem ändå, eller behåll de som visas. */
    pendingReplace: pendingReplace?.fileName,
    replaceAnyway: () => { const pending = pendingReplace; setPendingReplace(undefined); pending?.open(); },
    keepCurrent: () => setPendingReplace(undefined), sprint, layers, mapping, choose, crs, setCrs: (value: number | undefined) => { setCrs(value); setFit(undefined); }, result, computing, readBaseMap,
    fit, fitToMap, clearFit: () => setFit(undefined), canFit: !!session,
    /** Meter i terrängen per mm på kartan (för att visa inpassningen i meter). */
    metersPerMm: georeference ? georeference.scale / 1000 : 1, problem, setProblem, progress, sent, dwgSent, open, openData, refine, fetchOsm, fetching, propose, cancel,
    accept, accepted, canAccept: !!commitMany && view.viewer.canEdit,
    profile, saveProfile, canShareProfile: !!view.club,
    hideOnMap, setHideOnMap, skipped,
    toggleLayer: (layer: string) => setSkipped(current => { const next = new Set(current); if (next.has(layer)) next.delete(layer); else next.add(layer); return next; }),
    normed, setNormed, maskBuiltOn, setMaskBuiltOn, candidates: hideOnMap ? NO_CANDIDATES : result?.objects ?? NO_CANDIDATES, canImport: view.viewer.canPropose };
}
