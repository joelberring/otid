"use client";

import { useCallback, useEffect, useState } from "react";
import { GEO_CLIP_MARGIN_M, type GeoClip, type GeoJobList, type GeoJobView, type MapProjectClearCutList, type MapProjectView, type MapSourceCredentialView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { VectorParseError, type SourceData } from "@o-tid/map-revision";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { accountRequest } from "../../lib/account-client";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { baseMapOutputs, clearCutFeatures, clipWgs84 } from "@o-tid/map-revision/base-map";
import { mapProjectBase } from "../../lib/map-project-client";
import { laserClip } from "../../lib/map-project-clip";
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
  async function candidates(job: GeoJobView, outputs: readonly string[], label: string, baseMap: boolean, from: LaserAsker) {
    setMessage(undefined);
    const box = baseMap && job.clip ? clipWgs84(job.clip) : undefined;
    const total = outputs.length + (box ? 2 : 0);
    const step = (stepText: string) => setBusy({ from, text: stepText });
    step(text.steps.fetching(1, total));
    try {
      const parts: { name: string; body: string }[] = [];
      for (const output of outputs) {
        step(text.steps.fetching(parts.length + 1, total));
        const body = await read(job, output);
        if (typeof body === "number") { say(from, body); return; }
        parts.push({ name: output, body });
      }
      // G8: OpenStreetMap (stigar, vägar, hus, ledningar) för jobbets ruta följer med i grundkartan; går det inte sägs det.
      let osm: SourceData | undefined, osmMissing = false;
      if (box) {
        step(text.steps.fetching(outputs.length + 1, total));
        const response = await clubRequest(`${base}/sources/osm`, "POST", { formatVersion: 1, box }).catch(() => ({ status: 0, json: undefined }));
        osm = response.status === 200 ? (response.json as { data?: SourceData } | undefined)?.data : undefined;
        osmMissing = !osm;
      }
      // Skogsstyrelsens hyggen (ägaren 2026-11-11) efter ålder i dag och jämfört med laserskanningen.
      let cuts: ReturnType<typeof clearCutFeatures> | undefined;
      if (box) {
        step(text.steps.fetching(total, total));
        const response = await clubRequest(`${base}/sources/avverkningar`, "POST", { formatVersion: 1, box }).catch(() => ({ status: 0, json: undefined }));
        const found = response.status === 200 ? response.json as MapProjectClearCutList | undefined : undefined;
        if (found) cuts = clearCutFeatures(found.cuts, new Date().toISOString().slice(0, 10), job.scannedAt);
      }
      const data = await importer.readBaseMap({ parts, merge: baseMap, osm, scale: georeference?.scale,
        cuts: cuts && { features: cuts.features, afterScan: cuts.afterScan } },
        at => step(at.step === "read" ? text.steps.reading(at.done, at.total) : text.steps.merging));
      // Karttapullautins filer är i laserns SWEREF 99 TM; en DWG-ritnings koordinatsystem gissas eller anges i importen.
      importer.openData(candidateName(job, label), job.kind === "DWG" ? data : { ...data, crs: data.crs ?? 3006 }, job.kind !== "DWG",
        // Ägaren 2026-11-12: en etapps resultat klipps mot etappens gräns, så att grannetapperna inte får dubbla linjer.
        areas.find(row => row.areaId === job.areaId)?.polygon);
      const cutText = cuts ? ` ${text.clearCuts(cuts.counts.fresh, cuts.counts.scrub, cuts.counts.young, job.scannedAt)}` : "";
      setMessage({ from, tone: "ok", text: `${osmMissing ? `${text.loaded(label)} ${text.osmMissing}` : text.loaded(label)}${cutText}` });
    } catch (error) {
      setMessage({ from, tone: "error", text: error instanceof VectorParseError ? error.message : text.problems.generic("DXF") });
    } finally { setBusy(undefined); }
  }
  const candidateName = (job: GeoJobView, label: string) => `${job.name} – ${label}`;
  /** Grundkartans filer i jobbet; färre än två = jobbet har ingen grundkarta att läsa in. */
  const baseMapFiles = (job: GeoJobView) => job.kind === "PULLAUTIN" ? baseMapOutputs(job.outputs.map(output => output.name)) : [];

  return {
    credential, ready: !!credential?.saved?.readable, list, active,
    /** Något pågår (sökning, start eller inläsning), vem som än bad om det. */
    busy: !!busy, busyFor: (from: LaserAsker) => busy?.from === from ? busy.text : undefined,
    messageFor: (from: LaserAsker) => message?.from === from ? message : undefined,
    tell: (from: LaserAsker, tone: "ok" | "error", told: string) => setMessage({ from, tone, text: told }), clear: () => setMessage(undefined),
    clipOf, boxOf, search, start, remove, candidates, baseMapFiles,
    /** Hela grundkartan som kandidater (samma som laserpanelens «Läs in grundkartan»). */
    loadBaseMap: (job: GeoJobView, from: LaserAsker) => candidates(job, baseMapFiles(job), text.baseMap, true, from),
    /** Namnet kandidaterna får när jobbets grundkarta visas (så känns de igen i importen). */
    baseMapName: (job: GeoJobView) => candidateName(job, text.baseMap)
  };
}
