"use client";

import { useCallback, useEffect, useState } from "react";
import { GEO_CLIP_MARGIN_M, type GeoClip, type GeoJobList, type GeoJobView, type MapProjectClearCutList, type MapProjectSoilArea, type MapProjectSoilList, type MapProjectView, type MapSourceCredentialView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { VectorParseError, type SourceData } from "@o-tid/map-revision";
import { DEFAULT_ROCK_LEVEL, heightFieldFrom } from "@o-tid/map-revision/base-map";
import { mapClearContoursEn, mapFlatContoursEn } from "../../i18n/map-knolls-en";
import { mapClearContoursSv, mapFlatContoursSv } from "../../i18n/map-knolls-sv";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { accountRequest } from "../../lib/account-client";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { baseMapOutputs, clearCutFeatures, clipWgs84, soilForMarsh } from "@o-tid/map-revision/base-map";
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
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";

export type LaserArea = BoxArea & { areaId: string };
/** Vem som bad om något: laserpanelen eller guiden «Ny grundkarta». Var och en visar sina egna besked. */
export type LaserAsker = "panel" | "guide";
export const LASER_ACTIVE: ReadonlySet<string> = new Set(["QUEUED", "RUNNING"]);

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
  const rockText = useTexts(mapRockSv, mapRockEn);
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
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
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
    const total = jobsToRead.reduce((sum, row) => sum + filesOf(row).length, 0) + depths.length + rocks.length + heights.length + (box ? 2 : 0);
    let fetched = 0;
    const step = (stepText: string) => setBusy({ from, text: stepText });
    step(text.steps.fetching(1, total));
    try {
      const read_: { job: GeoJobView; parts: { name: string; body: string }[] }[] = [];
      for (const row of jobsToRead) {
        const parts: { name: string; body: string }[] = [];
        for (const output of filesOf(row)) {
          step(text.steps.fetching(++fetched, total));
          const body = await read(row, output);
          if (typeof body === "number") { say(from, body); return; }
          parts.push({ name: output, body });
        }
        read_.push({ job: row, parts });
      }
      const parts = read_[0]!.parts;
      // Hjälpkurvor och små ringar på flack mark tas bort med förvalet när körningen har fuktdjupet; reglaget ändrar det sedan.
      const slopes = new Map<string, Awaited<ReturnType<typeof jobSlope>>>();
      for (const row of depths) { step(text.steps.fetching(++fetched, total)); slopes.set(row.jobId, await jobSlope(base, row)); }
      const rockImages = new Map<string, Awaited<ReturnType<typeof jobRock>>>();
      for (const row of rocks) { step(text.steps.fetching(++fetched, total)); rockImages.set(row.jobId, await jobRock(base, row)); }
      const heightParts: HeightPart[] = [];
      for (const row of heights) { step(text.steps.fetching(++fetched, total)); const part = await jobHeights(base, row); if (part && part !== "failed") heightParts.push(part); }
      const rock = rockImages.get(job.jobId);
      const found = [...slopes.values()].find(value => value && value !== "failed");
      const slope = found ?? (slopes.size > 0 ? "failed" as const : undefined);
      // G8: OpenStreetMap (stigar, vägar, hus, ledningar) för jobbets ruta följer med i grundkartan; går det inte sägs det.
      let osm: SourceData | undefined, osmMissing = false;
      if (box) {
        step(text.steps.fetching(total - 1, total));
        const response = await clubRequest(`${base}/sources/osm`, "POST", { formatVersion: 1, box }).catch(() => ({ status: 0, json: undefined }));
        osm = response.status === 200 ? (response.json as { data?: SourceData } | undefined)?.data : undefined;
        osmMissing = !osm;
      }
      // Skogsstyrelsens hyggen (ägaren 2026-11-11) efter ålder i dag och jämfört med laserskanningen.
      let cuts: ReturnType<typeof clearCutFeatures> | undefined;
      if (box) {
        step(text.steps.fetching(total, total));
        const response = await clubRequest(`${base}/sources/avverkningar`, "POST", { formatVersion: 1, box }).catch(() => ({ status: 0, json: undefined }));
        const listed = response.status === 200 ? response.json as MapProjectClearCutList | undefined : undefined;
        if (listed) cuts = clearCutFeatures(listed.cuts, new Date().toISOString().slice(0, 10), job.scannedAt);
      }
      // SGU:s jordartskarta (ägaren 2026-11-13): ingen sankmark på sand och grus. Går hämtningen fel läses grundkartan in som förut.
      let soil: MapProjectSoilArea[] | undefined;
      if (box) {
        const response = await clubRequest(`${base}/sources/jordarter`, "POST", { formatVersion: 1, box }).catch(() => ({ status: 0, json: undefined }));
        const listed = response.status === 200 ? response.json as MapProjectSoilList | undefined : undefined;
        if (listed && Array.isArray(listed.areas)) soil = soilForMarsh(listed.areas);
      }
      const stageParts = stages && read_.map(({ job: row, parts: rowParts }) => {
        const own = slopes.get(row.jobId);
        const ownRock = rockImages.get(row.jobId);
        return { box: row.clip!, parts: rowParts, ...(own && own !== "failed" ? { slope: { grid: own.grid, affine: own.affine } } : {}),
          ...(ownRock && ownRock !== "failed" ? { rock: ownRock } : {}) };
      });
      const { data, calm, clear, rock: rocky, soil: soiled } = await importer.readBaseMap({ parts: stageParts ? [] : parts, stages: stageParts, joined: !stages && !!job.mergedStages, merge: baseMap, osm, scale: georeference?.scale,
        cuts: cuts && { features: cuts.features, afterScan: cuts.afterScan }, soil, calm: slope === "failed" ? undefined : slope,
        clear: heightParts.length > 0 ? { parts: heightParts } : undefined,
        rock: !stages && rock && rock !== "failed" ? { ...rock, level: DEFAULT_ROCK_LEVEL } : undefined },
        at => step(at.step === "read" ? text.steps.reading(at.done, at.total) : text.steps.merging));
      // Karttapullautins filer är i laserns SWEREF 99 TM; en DWG-ritnings koordinatsystem gissas eller anges i importen.
      importer.openData(stages ? stagesName(job, label) : candidateName(job, label), job.kind === "DWG" ? data : { ...data, crs: data.crs ?? 3006 }, job.kind !== "DWG",
        // Ägaren 2026-11-12: en etapps resultat klipps mot etappens gräns, så att grannetapperna inte får dubbla linjer.
        stages ? undefined : areas.find(row => row.areaId === job.areaId)?.polygon, calm,
        clear && { outcome: clear, field: heightFieldFrom(heightParts) },
        // Kartans märkning (ägaren 2026-11-14): laserjobbets inställningar följer med grundkartan till rutan i hörnet.
        baseMap && job.kind !== "DWG" ? { scannedAt: job.scannedAt, settings: job.settings } : undefined);
      const calmText = calm ? ` ${flatText.loaded(calm.level, calm.formlineMeters.toLocaleString("sv-SE"), calm.rings)}` : slope === "failed" ? ` ${flatText.failed}` : "";
      const clearMessage = clear ? ` ${clearText.loaded(clear.smoothedMeters.toLocaleString("sv-SE"), clear.formlineMeters.toLocaleString("sv-SE"), clear.rings)}` : "";
      const rockMessage = rocky ? ` ${rockText.loaded(rocky.level, rocky.areas, String(rocky.hectares).replace(".", ","))}`
        : [...rockImages.values()].includes("failed") ? ` ${rockText.loadFailed}` : "";
      const cutText = cuts ? ` ${text.clearCuts(cuts.counts.fresh, cuts.counts.scrub, cuts.counts.young, job.scannedAt)}` : "";
      const soilMessage = soiled && soiled.removedHa > 0 ? ` ${text.soilRemoved(String(soiled.removedHa).replace(".", ","))}` : "";
      setMessage({ from, tone: "ok", text: `${osmMissing ? `${text.loaded(label)} ${text.osmMissing}` : text.loaded(label)}${cutText}${soilMessage}${calmText}${clearMessage}${rockMessage}` });
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
