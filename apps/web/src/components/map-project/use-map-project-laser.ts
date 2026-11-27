"use client";

import { useCallback, useEffect, useState } from "react";
import { GEO_CLIP_MARGIN_M, type GeoClip, type GeoJobList, type GeoJobView, type MapProjectClearCutList, type MapProjectSoilArea, type MapProjectLandCover, type MapProjectSoilList, type MapProjectView, type MapSourceCredentialView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { VectorParseError, type SourceData } from "@o-tid/map-revision";
import { DEFAULT_ROCK_LEVEL, heightFieldFrom } from "@o-tid/map-revision/base-map";
import { mapClearContoursEn, mapFlatContoursEn, mapHillsEn, mapPitsEn } from "../../i18n/map-knolls-en";
import { mapClearContoursSv, mapFlatContoursSv, mapHillsSv, mapPitsSv } from "../../i18n/map-knolls-sv";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { accountRequest } from "../../lib/account-client";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { baseMapOutputs, clearCutFeatures, clipWgs84, landCoverCodesFromBase64, landCoverFeatures, soilForMarsh } from "@o-tid/map-revision/base-map";
import { mapProjectBase } from "../../lib/map-project-client";
import { laserClip } from "../../lib/map-project-clip";
import { HEIGHT_IMAGE, jobHeights, type HeightPart } from "../../lib/map-project-clear-contours";
import { jobSlope } from "../../lib/map-project-flat-contours";
import { jobRock } from "../../lib/map-project-rock";
import { mapRockEn } from "../../i18n/map-rock-en";
import { mapRockSv } from "../../i18n/map-rock-sv";
import { completeStages, stageOf } from "../../lib/map-project-stages";
import type { laserJobBody, LaserExtra, LaserItem } from "../../lib/map-project-laser-request";
import { useTexts } from "../language-provider";
import { mapPrimaryEn } from "../../i18n/map-primary-en";
import { mapPrimarySv } from "../../i18n/map-primary-sv";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";

export type LaserArea = BoxArea & { areaId: string };
/** Vem som bad om något: laserpanelen eller guiden «Ny grundkarta». Var och en visar sina egna besked. */
export type LaserAsker = "panel" | "guide";
export const LASER_ACTIVE: ReadonlySet<string> = new Set(["QUEUED", "RUNNING"]);
const LASER_FETCH_CONCURRENCY = 5;

/** Kör oberoende asynkrona uppgifter med begränsad parallellitet (bevarar resultatens ordning). */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

type GeoResponse = { readonly status: number; readonly json: unknown };

/**
 * Hämtar laserkörningens resultatfiler och rasterbilder (fuktdjup, berg, höjd) med begränsad parallellitet samtidigt
 * som de fyra oberoende geokällorna (OSM, Skogsstyrelsen, SGU, NMD) körs i `Promise.all`.
 */
export async function fetchLaserCandidateSources(input: {
  readonly jobsToRead: readonly GeoJobView[];
  readonly filesOf: (row: GeoJobView) => readonly string[];
  readonly depths: readonly GeoJobView[];
  readonly rocks: readonly GeoJobView[];
  readonly heights: readonly GeoJobView[];
  readonly hasBox: boolean;
  readonly readOutput: (row: GeoJobView, output: string) => Promise<string | number>;
  readonly readSlope: (row: GeoJobView) => Promise<Awaited<ReturnType<typeof jobSlope>>>;
  readonly readRock: (row: GeoJobView) => Promise<Awaited<ReturnType<typeof jobRock>>>;
  readonly readHeight: (row: GeoJobView) => Promise<Awaited<ReturnType<typeof jobHeights>>>;
  readonly fetchGeo: (path: "osm" | "avverkningar" | "jordarter" | "marktacke-nmd") => Promise<GeoResponse>;
  readonly onProgress?: () => void;
  readonly concurrency?: number;
}): Promise<
  | { readonly kind: "failed"; readonly status: number }
  | {
      readonly kind: "ok";
      readonly read: { readonly job: GeoJobView; readonly parts: { readonly name: string; readonly body: string }[] }[];
      readonly slopes: Map<string, Awaited<ReturnType<typeof jobSlope>>>;
      readonly rockImages: Map<string, Awaited<ReturnType<typeof jobRock>>>;
      readonly heightParts: HeightPart[];
      readonly geo?: { readonly osm: GeoResponse; readonly cuts: GeoResponse; readonly soil: GeoResponse; readonly landCover: GeoResponse } | undefined;
    }
> {
  type Task =
    | { readonly kind: "output"; readonly jobIndex: number; readonly outputIndex: number; readonly row: GeoJobView; readonly output: string }
    | { readonly kind: "slope"; readonly order: number; readonly row: GeoJobView }
    | { readonly kind: "rock"; readonly order: number; readonly row: GeoJobView }
    | { readonly kind: "height"; readonly order: number; readonly row: GeoJobView };
  const tasks: Task[] = [];
  const outputCounts = input.jobsToRead.map(row => input.filesOf(row).length);
  input.jobsToRead.forEach((row, jobIndex) => {
    input.filesOf(row).forEach((output, outputIndex) => tasks.push({ kind: "output", jobIndex, outputIndex, row, output }));
  });
  input.depths.forEach((row, order) => tasks.push({ kind: "slope", order, row }));
  input.rocks.forEach((row, order) => tasks.push({ kind: "rock", order, row }));
  input.heights.forEach((row, order) => tasks.push({ kind: "height", order, row }));

  const safeGeo = (path: "osm" | "avverkningar" | "jordarter" | "marktacke-nmd") =>
    input.fetchGeo(path).catch(() => ({ status: 0, json: undefined })).then(response => { input.onProgress?.(); return response; });
  const geoPromise = input.hasBox
    ? Promise.all([safeGeo("osm"), safeGeo("avverkningar"), safeGeo("jordarter"), safeGeo("marktacke-nmd")])
    : undefined;

  const partGrid = outputCounts.map(count => new Array<{ readonly name: string; readonly body: string }>(count));
  const slopeSlots = new Array<Awaited<ReturnType<typeof jobSlope>>>(input.depths.length);
  const rockSlots = new Array<Awaited<ReturnType<typeof jobRock>>>(input.rocks.length);
  const heightSlots = new Array<Awaited<ReturnType<typeof jobHeights>>>(input.heights.length);
  let failedStatus: number | undefined;

  await mapWithConcurrency(tasks, input.concurrency ?? LASER_FETCH_CONCURRENCY, async task => {
    if (failedStatus !== undefined) return;
    if (task.kind === "output") {
      const body = await input.readOutput(task.row, task.output);
      input.onProgress?.();
      if (typeof body === "number") { if (failedStatus === undefined) failedStatus = body; return; }
      partGrid[task.jobIndex]![task.outputIndex] = { name: task.output, body };
    } else if (task.kind === "slope") {
      slopeSlots[task.order] = await input.readSlope(task.row);
      input.onProgress?.();
    } else if (task.kind === "rock") {
      rockSlots[task.order] = await input.readRock(task.row);
      input.onProgress?.();
    } else {
      heightSlots[task.order] = await input.readHeight(task.row);
      input.onProgress?.();
    }
  });
  if (failedStatus !== undefined) return { kind: "failed", status: failedStatus };

  const geoTuple = geoPromise ? await geoPromise : undefined;
  const read = input.jobsToRead.map((job, index) => ({ job, parts: partGrid[index]! }));
  const slopes = new Map<string, Awaited<ReturnType<typeof jobSlope>>>();
  input.depths.forEach((row, index) => slopes.set(row.jobId, slopeSlots[index]));
  const rockImages = new Map<string, Awaited<ReturnType<typeof jobRock>>>();
  input.rocks.forEach((row, index) => rockImages.set(row.jobId, rockSlots[index]));
  const heightParts: HeightPart[] = [];
  for (const part of heightSlots) if (part && part !== "failed") heightParts.push(part);
  return {
    kind: "ok", read, slopes, rockImages, heightParts,
    ...(geoTuple ? { geo: { osm: geoTuple[0], cuts: geoTuple[1], soil: geoTuple[2], landCover: geoTuple[3] } } : {})
  };
}

/**
 * ADR-0219 K5, utbrutet ur laserpanelen (ägaren 2026-11-13, guiden «Ny grundkarta»): uppgifterna till Lantmäteriet, listan
 * med körningar (läses om var tionde sekund medan något väntar eller pågår), sökningen efter laserrutor, starten av en
 * körning och inläsningen av grundkartan som kandidater. Laserpanelen och guiden delar samma hook, så att en körning som
 * den ena startar syns i den andra, och bara en sak i taget pågår.
 */
export function useMapProjectLaser({ view, layers, importer, georeference, bounds, areas }: { view: MapProjectView;
  layers: ReturnType<typeof useMapProjectLayers>; importer: ReturnType<typeof useMapProjectImport>; georeference: MapGeoreference | undefined;
  bounds: Bounds | undefined; areas: readonly LaserArea[] }) {
  const text = useTexts(mapSourcesSv.laser, mapSourcesEn.laser);
  const flatText = useTexts(mapFlatContoursSv, mapFlatContoursEn);
  const clearText = useTexts(mapClearContoursSv, mapClearContoursEn);
  const pitText = useTexts(mapPitsSv, mapPitsEn);
  const hillText = useTexts(mapHillsSv, mapHillsEn);
  const rockText = useTexts(mapRockSv, mapRockEn);
  const primaryText = useTexts(mapPrimarySv, mapPrimaryEn);
  const base = mapProjectBase(view.projectId);
  const [credential, setCredential] = useState<MapSourceCredentialView>();
  const [list, setList] = useState<GeoJobList>();
  const [busy, setBusy] = useState<{ from: LaserAsker; text: string }>();
  /** `code` är serverns felkod när det finns en, så att guiden kan säga vad man gör härnäst med egna ord. */
  const [message, setMessage] = useState<{ from: LaserAsker; tone: "ok" | "error"; text: string; code?: string | undefined }>();
  const say = (from: LaserAsker, error: string | number | undefined) => setMessage({ from, tone: "error", code: typeof error === "string" ? error : undefined,
    text: typeof error === "string" && error in text.problems ? (text.problems as unknown as Record<string, string>)[error]! : text.problems.generic(error ?? 0) });

  const load = useCallback(async () => {
    const result = await clubRequest(`${base}/geo-jobs`, "GET").catch(() => undefined);
    if (result?.status === 200) setList(result.json as GeoJobList);
  }, [base]);
  useEffect(() => {
    void accountRequest("/api/account/map-sources/lantmateriet").then(result => {
      if (result.status === 200) setCredential(result.json as MapSourceCredentialView);
    }, () => undefined);
    void load();
  }, [load]);
  // K6b: en DWG-ritning som just skickats från importen syns här som ett jobb.
  const dwgSent = importer.dwgSent;
  useEffect(() => { if (dwgSent) void load(); }, [dwgSent, load]);
  // Medan ett jobb väntar eller pågår: läget var tionde sekund, och underlagen när det blivit klart.
  const active = list?.jobs.some(job => LASER_ACTIVE.has(job.status)) ?? false;
  useEffect(() => {
    if (!active) return;
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(onVisible, 10_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [active, load]);
  const doneCount = list?.jobs.filter(job => job.status === "DONE").length ?? 0;
  const reloadLayers = layers.reload;
  useEffect(() => { if (doneCount > 0) void reloadLayers(); }, [doneCount, reloadLayers]);

  /**
   * Rutan laserdatan klipps till (SWEREF 99 TM). Ägaren 2026-11-11: utan etapp klipps den till kartans eget område
   * (polygonen), inte till kartbladets ruta som är ungefär 1,5 gånger så stor per sida (drygt dubbla ytan att bearbeta).
   */
  function clipOf(area: LaserArea | undefined, marginM = GEO_CLIP_MARGIN_M): GeoClip | undefined {
    if (!bounds || !georeference) return undefined;
    const mapArea = !area && view.area?.[0] && view.area[0].length >= 3 ? { name: "", polygon: view.area } : undefined;
    return laserClip(bounds, georeference, marginM, area ?? mapArea);
  }
  /** Sökrutan (WGS84) för kartan eller en etapp. */
  const boxOf = (area: LaserArea | undefined) => bounds && georeference ? areaBox(bounds, georeference, area).wgs84 : undefined;

  /** Laserrutorna (och Lantmäteriets marktäcke och byggnader) för kartan eller en etapp; inget svar = felet står i beskedet. */
  async function search(area: LaserArea | undefined, from: LaserAsker): Promise<{ items: LaserItem[]; extras: LaserExtra[] } | undefined> {
    const box = boxOf(area);
    if (!box) return undefined;
    setBusy({ from, text: text.searching }); setMessage(undefined);
    try {
      const result = await clubRequest(`${base}/sources/lantmateriet/laser`, "POST", { formatVersion: 1, box }).catch(() => ({ status: 0, json: undefined }));
      const body = result.json as { items?: LaserItem[]; extras?: LaserExtra[]; error?: string } | undefined;
      if (result.status !== 200 || !body?.items) { say(from, body?.error ?? result.status); return undefined; }
      return { items: body.items, extras: body.extras ?? [] };
    } finally { setBusy(undefined); }
  }

  /** Lägger en körning i kön (`laserJobBody`) och läser om listan. */
  async function start(body: ReturnType<typeof laserJobBody>, from: LaserAsker, busyText = text.searching): Promise<boolean> {
    setBusy({ from, text: busyText }); setMessage(undefined);
    try {
      const result = await clubRequest(`${base}/geo-jobs`, "POST", { ...body, requestId: crypto.randomUUID() }).catch(() => ({ status: 0, json: undefined }));
      if (result.status !== 201 && result.status !== 200) { say(from, (result.json as { error?: string } | undefined)?.error ?? result.status); return false; }
      const parts = (result.json as { split?: { total?: number } } | undefined)?.split?.total;
      setMessage({ from, tone: "ok", text: typeof parts === "number" && parts > 1 ? text.startedSplit(parts) : text.started });
      await load();
      return true;
    } finally { setBusy(undefined); }
  }

  /** Ägaren 2026-11-14: etapperna i jobbets omgång läggs ihop till en körning på geo-servern (för körningar som delades före det). */
  async function mergeStages(job: GeoJobView, from: LaserAsker) {
    setMessage(undefined);
    const result = await clubRequest(`${base}/geo-jobs/${job.jobId}/merge`, "POST").catch(() => ({ status: 0, json: undefined }));
    if (result.status === 201) setMessage({ from, tone: "ok", text: text.mergeQueued });
    else if (result.status === 409) setMessage({ from, tone: "error", text: text.mergeBusy });
    else say(from, (result.json as { error?: string } | undefined)?.error ?? result.status);
    await load();
  }

  async function remove(job: GeoJobView, from: LaserAsker) {
    const result = await clubRequest(`${base}/geo-jobs/${job.jobId}`, "DELETE").catch(() => ({ status: 0, json: undefined }));
    if (result.status !== 200) say(from, (result.json as { error?: string } | undefined)?.error ?? result.status);
    await load();
  }

  /** En resultatfil som text, eller statusen när den inte gick att hämta. */
  async function read(job: GeoJobView, output: string): Promise<string | number> {
    const response = await fetch(`${base}/geo-jobs/${job.jobId}/outputs/${output}`, { credentials: "same-origin" }).catch(() => undefined);
    if (!response?.ok) return response?.status ?? 0;
    return response.text();
  }

  /**
   * En fil, eller hela grundkartan (jobbets delar och OpenStreetMap för samma ruta), som kandidater i importen. Ägaren
   * 2026-11-12 («nu vet man inte om datorn hängt sig»): filerna tolkas och sätts ihop i kandidaternas Worker, och
   * statusraden säger vilket steg som pågår.
   */
  async function candidates(job: GeoJobView, outputs: readonly string[], label: string, baseMap: boolean, from: LaserAsker,
    /** Ägaren 2026-11-13 (Ornö södra): alla etapper i en delad körning läses in som en grundkarta, klippta kant i kant. */
    stages?: readonly GeoJobView[]) {
    setMessage(undefined);
    const jobsToRead = stages ?? [job];
    const clips = jobsToRead.flatMap(row => row.clip ? [row.clip] : []);
    const union = clips.length > 0 ? { minX: Math.min(...clips.map(c => c.minX)), minY: Math.min(...clips.map(c => c.minY)),
      maxX: Math.max(...clips.map(c => c.maxX)), maxY: Math.max(...clips.map(c => c.maxY)) } : undefined;
    const box = baseMap && union ? clipWgs84(union) : undefined;
    // Ägaren 2026-11-13 («Lugna kurvor på flack mark»): med grundkartan läses körningens fuktdjup, för lutningen.
    const depths = jobsToRead.filter(row => baseMap && row.outputs.some(output => output.name === "fuktdjup.png"));
    // Ägaren 2026-11-13 («Berg i dagen med reglage»): med grundkartan läses körningens bergbild, för berg i dagen med förvalets nivå.
    const rocks = jobsToRead.filter(row => baseMap && row.outputs.some(output => output.name === "berg.png"));
    // Ägaren 2026-11-14 («Tydligare kurvbild»): med grundkartan läses körningens höjd, och reglagens förval läggs på direkt.
    const heights = jobsToRead.filter(row => baseMap && row.outputs.some(output => output.name === HEIGHT_IMAGE));
    const filesOf = (row: GeoJobView) => stages ? baseMapFiles(row) : outputs;
    const total = jobsToRead.reduce((sum, row) => sum + filesOf(row).length, 0) + depths.length + rocks.length + heights.length + (box ? 4 : 0);
    let fetched = 0;
    const step = (stepText: string) => setBusy({ from, text: stepText });
    step(text.steps.fetching(1, Math.max(1, total)));
    try {
      const loaded = await fetchLaserCandidateSources({
        jobsToRead, filesOf, depths, rocks, heights, hasBox: Boolean(box),
        readOutput: read,
        readSlope: row => jobSlope(base, row),
        readRock: row => jobRock(base, row),
        readHeight: row => jobHeights(base, row),
        fetchGeo: path => clubRequest(`${base}/sources/${path}`, "POST", { formatVersion: 1, box }),
        onProgress: () => step(text.steps.fetching(Math.min(++fetched, Math.max(1, total)), Math.max(1, total)))
      });
      if (loaded.kind === "failed") { say(from, loaded.status); return; }
      const { read: read_, slopes, rockImages, heightParts, geo } = loaded;
      const parts = read_[0]!.parts;
      const rock = rockImages.get(job.jobId);
      const found = [...slopes.values()].find(value => value && value !== "failed");
      const slope = found ?? (slopes.size > 0 ? "failed" as const : undefined);
      // G8: OpenStreetMap (stigar, vägar, hus, ledningar) för jobbets ruta följer med i grundkartan; går det inte sägs det.
      let osm: SourceData | undefined, osmMissing = false;
      if (geo) {
        osm = geo.osm.status === 200 ? (geo.osm.json as { data?: SourceData } | undefined)?.data : undefined;
        osmMissing = !osm;
      }
      // Skogsstyrelsens hyggen (ägaren 2026-11-11) efter ålder i dag och jämfört med laserskanningen.
      let cuts: ReturnType<typeof clearCutFeatures> | undefined;
      if (geo) {
        const listed = geo.cuts.status === 200 ? geo.cuts.json as MapProjectClearCutList | undefined : undefined;
        if (listed) cuts = clearCutFeatures(listed.cuts, new Date().toISOString().slice(0, 10), job.scannedAt);
      }
      // SGU:s jordartskarta (ägaren 2026-11-13): ingen sankmark på sand och grus. Går hämtningen fel läses grundkartan in som förut.
      let soil: MapProjectSoilArea[] | undefined;
      if (geo) {
        const listed = geo.soil.status === 200 ? geo.soil.json as MapProjectSoilList | undefined : undefined;
        if (listed && Array.isArray(listed.areas)) soil = soilForMarsh(listed.areas);
      }
      // Naturvårdsverkets marktäckedata (ägaren 2026-11-17): öppen våtmark som sankmark där lasern inte har någon. Går
      // hämtningen fel läses grundkartan in utan den.
      let landCover: ReturnType<typeof landCoverFeatures> | undefined;
      if (geo) {
        const grid = geo.landCover.status === 200 ? geo.landCover.json as MapProjectLandCover | undefined : undefined;
        const codes = grid && typeof grid.codes === "string" ? landCoverCodesFromBase64(grid.codes, grid.width * grid.height) : undefined;
        if (grid && codes) landCover = landCoverFeatures({ minX: grid.minX, maxY: grid.maxY, cell: grid.cell, width: grid.width, height: grid.height, codes }, georeference?.scale || 15_000);
      }
      const stageParts = stages && read_.map(({ job: row, parts: rowParts }) => {
        const own = slopes.get(row.jobId);
        const ownRock = rockImages.get(row.jobId);
        return { box: row.clip!, parts: rowParts, ...(own && own !== "failed" ? { slope: { grid: own.grid, affine: own.affine } } : {}),
          ...(ownRock && ownRock !== "failed" ? { rock: ownRock } : {}) };
      });
      const { data, calm, clear, rock: rocky, soil: soiled, pits, hills, primary } = await importer.readBaseMap({ parts: stageParts ? [] : parts, stages: stageParts, joined: !stages && !!job.mergedStages, merge: baseMap, osm, scale: georeference?.scale,
        // K4c: inom projektets huvudkällor hoppas OpenStreetMaps objekt av källornas slag över.
        primary: baseMap ? importer.primary.forBaseMap() : undefined,
        cuts: cuts && { features: cuts.features, afterScan: cuts.afterScan }, soil, landCover, calm: slope === "failed" ? undefined : slope,
        clear: heightParts.length > 0 ? { parts: heightParts } : undefined,
        rock: !stages && rock && rock !== "failed" ? { ...rock, level: DEFAULT_ROCK_LEVEL } : undefined },
        at => step(at.step === "read" ? text.steps.reading(at.done, at.total) : text.steps.merging));
      // Karttapullautins filer är i laserns SWEREF 99 TM; en DWG-ritnings koordinatsystem gissas eller anges i importen.
      importer.openData(stages ? stagesName(job, label) : candidateName(job, label), job.kind === "DWG" ? data : { ...data, crs: data.crs ?? 3006 }, job.kind !== "DWG",
        // Ägaren 2026-11-12: en etapps resultat klipps mot etappens gräns, så att grannetapperna inte får dubbla linjer.
        stages ? undefined : areas.find(row => row.areaId === job.areaId)?.polygon, calm,
        clear && { outcome: clear, field: heightFieldFrom(heightParts) },
        // Kartans märkning (ägaren 2026-11-14): laserjobbets inställningar följer med grundkartan till rutan i hörnet.
        baseMap && job.kind !== "DWG" ? { scannedAt: job.scannedAt, settings: job.settings } : undefined, pits, hills, job.kind === "DWG");
      const calmText = calm ? ` ${flatText.loaded(calm.level, calm.formlineMeters.toLocaleString("sv-SE"), calm.rings)}` : slope === "failed" ? ` ${flatText.failed}` : "";
      const clearMessage = clear ? ` ${clearText.loaded(clear.smoothedMeters.toLocaleString("sv-SE"), clear.formlineMeters.toLocaleString("sv-SE"), clear.rings)}` : "";
      const rockMessage = rocky ? ` ${rockText.loaded(rocky.level, rocky.areas, String(rocky.hectares).replace(".", ","))}`
        : [...rockImages.values()].includes("failed") ? ` ${rockText.loadFailed}` : "";
      const pitMessage = pits && pits.points + pits.rings + pits.byHeight > 0 ? ` ${pitText.loaded(pits.points, pits.rings, pits.byHeight)}` : "";
      const hillMessage = hills && hills.rings > 0 ? ` ${hillText.loaded(hills.rings, hills.hidden.length)}` : "";
      const cutText = cuts ? ` ${text.clearCuts(cuts.counts.fresh, cuts.counts.scrub, cuts.counts.young, job.scannedAt)}` : "";
      const soilMessage = soiled && soiled.removedHa > 0 ? ` ${text.soilRemoved(String(soiled.removedHa).replace(".", ","))}` : "";
      const primaryMessage = (primary ?? []).map(row => ` ${primaryText.skipped(primaryText.list(row.kinds.map(kind => primaryText.kinds[kind])), row.name)}`).join("");
      setMessage({ from, tone: "ok", text: `${osmMissing ? `${text.loaded(label)} ${text.osmMissing}` : text.loaded(label)}${cutText}${soilMessage}${primaryMessage}${calmText}${clearMessage}${hillMessage}${pitMessage}${rockMessage}` });
    } catch (error) {
      setMessage({ from, tone: "error", text: error instanceof VectorParseError ? error.message : text.problems.generic("DXF") });
    } finally { setBusy(undefined); }
  }
  const candidateName = (job: GeoJobView, label: string) => `${job.name} – ${label}`;
  const stagesName = (job: GeoJobView, label: string) => `${stageOf(job.name)?.base ?? job.name} – ${text.allStages} – ${label}`;
  /** Grundkartans filer i jobbet; färre än två = jobbet har ingen grundkarta att läsa in. */
  const baseMapFiles = (job: GeoJobView) => job.kind === "PULLAUTIN" ? baseMapOutputs(job.outputs.map(output => output.name)) : [];

  return {
    credential, ready: !!credential?.saved?.readable, list, active,
    /** Något pågår (sökning, start eller inläsning), vem som än bad om det. */
    busy: !!busy, busyFor: (from: LaserAsker) => busy?.from === from ? busy.text : undefined,
    messageFor: (from: LaserAsker) => message?.from === from ? message : undefined,
    tell: (from: LaserAsker, tone: "ok" | "error", told: string) => setMessage({ from, tone, text: told }), clear: () => setMessage(undefined),
    clipOf, boxOf, search, start, remove, mergeStages, candidates, baseMapFiles,
    /** Hela grundkartan som kandidater (samma som laserpanelens «Läs in grundkartan»). */
    loadBaseMap: (job: GeoJobView, from: LaserAsker) => candidates(job, baseMapFiles(job), text.baseMap, true, from),
    /** Alla etapper i jobbets omgång, när alla är klara och har grundkartans filer; annars `undefined`. */
    stagesOf: (job: GeoJobView) => {
      const all = list ? completeStages(job, list.jobs) : undefined;
      return all && all.every(row => baseMapFiles(row).length > 1) ? all : undefined;
    },
    /** Grundkartan ur alla etapper på en gång (ägaren 2026-11-13: «så att alla remsor ses samtidigt»). */
    loadStages: (job: GeoJobView, stages: readonly GeoJobView[], from: LaserAsker) => candidates(job, [], text.baseMap, true, from, stages),
    stagesName: (job: GeoJobView) => stagesName(job, text.baseMap),
    /** Namnet kandidaterna får när jobbets grundkarta visas (så känns de igen i importen). */
    baseMapName: (job: GeoJobView) => candidateName(job, text.baseMap)
  };
}
