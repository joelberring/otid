"use client";

import { clipCenter, laserClip, sampleClip } from "../../lib/map-project-clip";
import { useCallback, useEffect, useState } from "react";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { useTexts } from "../language-provider";
import { GEO_CLIP_MARGIN_M, PULLAUTIN_SETTINGS, type GeoExtraKind, type GeoJobList, type GeoJobView, type MapProjectView, type MapSourceCredentialView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { parseDxf, parseGeoJson, VectorParseError, type SourceData } from "@o-tid/map-revision";
import { baseMapOutputs, clipWgs84, mergeBaseMap } from "../../lib/map-project-base-map";
import { choiceSettings, choicesOf, DEFAULT_CHOICES, LASER_CHOICES, typedOf, type ChoiceLevel, type LaserChoices } from "../../lib/map-project-laser-choices";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { accountRequest } from "../../lib/account-client";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { mapProjectBase } from "../../lib/map-project-client";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

interface ExtraItem { kind: GeoExtraKind; id: string; href: string }
interface LaserItem { id: string; datetime: string | null; href: string; bbox: [number, number, number, number] | null; bytes: number | null; epsg: number | null }
type Area = BoxArea & { areaId: string };
const INTERVALS = [2.5, 5] as const;
const ACTIVE = new Set(["QUEUED", "RUNNING"]);
/** Ägaren 2026-11-10: Karttapullautins övriga inställningar (kurvor, branter, grönt), utöver ekvidistansen och formlinjerna. */
const MORE_SETTINGS = ["smoothing", "curviness", "knolls", "formlinesteepness", "cliff1", "cliff2", "cliffsteepfactor", "yellowheight", "greenground", "greenhigh",
  "topweight", "greenscale", "undergrowth"] as const satisfies readonly (keyof typeof PULLAUTIN_SETTINGS)[];
/** Fälten som tal inom gränserna; tomma och ogiltiga fält hoppas över (Karttapullautins förval gäller). */
export function moreSettings(fields: Readonly<Record<string, string>>): Record<string, number> {
  return Object.fromEntries(MORE_SETTINGS.flatMap(key => {
    const raw = fields[key]?.trim().replace(",", "."), value = raw ? Number(raw) : NaN, [low, high] = PULLAUTIN_SETTINGS[key];
    return Number.isFinite(value) && value >= low && value <= high ? [[key, value]] : [];
  }));
}

/**
 * ADR-0219 K5: laserdata från Lantmäteriet och Karttapullautin på geo-servern. Rutorna söks för kartan eller en etapp; jobbet
 * körs på geo-servern och resultatet (bilden) blir ett underlag. Kurvor och de andra linjerna läses in som kandidater (K4b).
 */
export function MapProjectLaserPanel({ view, layers, importer, georeference, bounds, areas }: { view: MapProjectView;
  layers: ReturnType<typeof useMapProjectLayers>; importer: ReturnType<typeof useMapProjectImport>; georeference: MapGeoreference | undefined;
  bounds: Bounds | undefined; areas: readonly Area[] }) {
  const mapSourcesText = useTexts(mapSourcesSv, mapSourcesEn);
  const text = useTexts(mapSourcesSv.laser, mapSourcesEn.laser);
  const base = mapProjectBase(view.projectId);
  const [credential, setCredential] = useState<MapSourceCredentialView>();
  const [list, setList] = useState<GeoJobList>();
  const [where, setWhere] = useState("");
  const [items, setItems] = useState<LaserItem[]>();
  // G8: Lantmäteriets Marktäcke och Byggnad för rutan (när kontot kommer åt dem), och vilka som ska läsas.
  const [extras, setExtras] = useState<readonly ExtraItem[]>([]);
  const [skippedExtras, setSkippedExtras] = useState<ReadonlySet<GeoExtraKind>>(new Set());
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  const [interval, setInterval_] = useState<number>(5);
  const [formline, setFormline] = useState(2);
  const [more, setMore] = useState<Readonly<Record<string, string>>>({});
  const [choices, setChoices] = useState<LaserChoices>(DEFAULT_CHOICES);
  // G6 (ägaren 2026-11-11: «itereringar av olika lager, t.ex. grönt, efter första körning»): ett klart jobb körs om med samma
  // rutor och område men nya inställningar, och resultaten jämförs innan något läggs in i kartan.
  const [rerun, setRerun] = useState<GeoJobView>();
  // Provrutan: «» hela området, «middle» mitten av jobbets område, annars en etapps mitt.
  const [sample, setSample] = useState("");
  // Ägaren 2026-11-11: fuktigheten och vegetationen är förvalda, så att kärr och grönt alltid kommer med i grundkartan.
  const [moisture, setMoisture] = useState(true);
  const [channelHa, setChannelHa] = useState(1);
  const [wetMeters, setWetMeters] = useState(0.5);
  const [vegetation, setVegetation] = useState(true);
  const [minAreaM2, setMinAreaM2] = useState(300);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const area = areas.find(row => row.areaId === where);
  const say = (error: string | number | undefined) => setMessage({ tone: "error", text: typeof error === "string" && error in text.problems
    ? (text.problems as unknown as Record<string, string>)[error]! : text.problems.generic(error ?? 0) });

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
  const active = list?.jobs.some(job => ACTIVE.has(job.status)) ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [active, load]);
  const doneCount = list?.jobs.filter(job => job.status === "DONE").length ?? 0;
  const reloadLayers = layers.reload;
  useEffect(() => { if (doneCount > 0) void reloadLayers(); }, [doneCount, reloadLayers]);
  useEffect(() => { setItems(undefined); setExtras([]); setChosen(new Set()); setName(text.defaultName(area?.name)); }, [where, area?.name]);

  if (!view.viewer.canPropose || !georeference || !bounds) return null;

  async function search() {
    setBusy(text.searching); setMessage(undefined);
    try {
      const result = await clubRequest(`${base}/sources/lantmateriet/laser`, "POST", { formatVersion: 1, box: areaBox(bounds!, georeference!, area).wgs84 })
        .catch(() => ({ status: 0, json: undefined }));
      const body = result.json as { items?: LaserItem[]; extras?: ExtraItem[]; error?: string } | undefined;
      if (result.status !== 200 || !body?.items) { say(body?.error ?? result.status); return; }
      setItems(body.items); setExtras(body.extras ?? []);
      setChosen(new Set(newestPerTile(body.items).map(item => item.id)));
    } finally { setBusy(undefined); }
  }

  const clip = laserClip(bounds, georeference, GEO_CLIP_MARGIN_M, area);
  const sampleArea = areas.find(row => row.areaId === sample);
  const sampleCenter = !rerun?.clip || !sample ? undefined : sample === "middle" ? clipCenter(rerun.clip)
    : sampleArea ? (box => box && clipCenter(box))(laserClip(bounds, georeference, 0, sampleArea)) : undefined;
  const sampled = rerun && sampleCenter ? sampleClip(sampleCenter, rerun.clip) : undefined;
  async function start() {
    const tiles = (items ?? []).filter(item => chosen.has(item.id)).map(item => ({ id: item.id, href: item.href, bbox: item.bbox, epsg: item.epsg }));
    const chosenSettings = choiceSettings(choices, moreSettings(more));
    setBusy(text.searching); setMessage(undefined);
    try {
      const result = await clubRequest(`${base}/geo-jobs`, "POST", { formatVersion: 1, requestId: crypto.randomUUID(), kind: "PULLAUTIN",
        name: (name.trim() || text.defaultName(area?.name)).slice(0, sampled ? 68 : 80) + (sampled ? text.sampleSuffix : ""), settings: { contour_interval: interval, formline, ...chosenSettings.settings },
        ...(chosenSettings.cliffs ? { cliffs: chosenSettings.cliffs } : {}),
        // Kör om: rutorna, området och Lantmäteriets produkter tas från jobbet; annars de valda rutorna och kartans område.
        ...(rerun ? { rerunOf: rerun.jobId, ...(sampled ? { clip: sampled } : {}) } : { tiles,
          // Grundkartan G1: bara kartans område (eller etappen) med marginal bearbetas.
          ...(clip ? { clip } : {}),
          ...(clip && extras.some(extra => !skippedExtras.has(extra.kind)) ? { extras: extras.filter(extra => !skippedExtras.has(extra.kind)) } : {}) }),
        ...(moisture ? { moisture: { channelHa, wetMeters, moistMeters: Math.max(1, wetMeters * 2) } } : {}),
        ...(vegetation ? { vegetation: { minAreaM2 } } : {}) }).catch(() => ({ status: 0, json: undefined }));
      const body = result.json as { error?: string } | undefined;
      if (result.status !== 201 && result.status !== 200) { say(body?.error ?? result.status); return; }
      setItems(undefined); setRerun(undefined); setSample(""); setMessage({ tone: "ok", text: text.started });
      await load();
    } finally { setBusy(undefined); }
  }

  /** Formuläret med jobbets inställningar, för att köra om det med andra. */
  function startRerun(job: GeoJobView) {
    const settings = job.settings;
    const picked = choicesOf(settings);
    setRerun(job); setItems(undefined); setMessage(undefined);
    setName(text.rerunName(job.name));
    setInterval_(settings.contour_interval ?? 5); setFormline(settings.formline ?? 2);
    setChoices(job.cliffs ? { ...picked, cliffs: job.cliffs.minDrop > 1.3 ? "less" : "more" } : picked);
    setMore(typedOf(settings, picked, MORE_SETTINGS));
    setMoisture(!!job.moisture); setVegetation(!!job.vegetation);
    if (job.moisture) { setChannelHa(job.moisture.channelHa); setWetMeters(job.moisture.wetMeters); }
    if (job.vegetation) setMinAreaM2(job.vegetation.minAreaM2);
  }

  async function remove(job: GeoJobView) {
    const result = await clubRequest(`${base}/geo-jobs/${job.jobId}`, "DELETE").catch(() => ({ status: 0, json: undefined }));
    if (result.status !== 200) say((result.json as { error?: string } | undefined)?.error ?? result.status);
    await load();
  }

  /** En resultatfil läst som vektordata, eller statusen när den inte gick att hämta. */
  async function read(job: GeoJobView, output: string): Promise<SourceData | number> {
    const response = await fetch(`${base}/geo-jobs/${job.jobId}/outputs/${output}`, { credentials: "same-origin" }).catch(() => undefined);
    if (!response?.ok) return response?.status ?? 0;
    const body = await response.text();
    return output.endsWith(".geojson") ? parseGeoJson(body) : parseDxf(body);
  }

  /** En fil, eller hela grundkartan (jobbets delar och OpenStreetMap för samma ruta), som kandidater i importen. */
  async function candidates(job: GeoJobView, outputs: readonly string[], label: string, baseMap = false) {
    setBusy(label); setMessage(undefined);
    try {
      const parts: { name: string; data: SourceData }[] = [];
      for (const output of outputs) {
        const data = await read(job, output);
        if (typeof data === "number") { say(data); return; }
        parts.push({ name: output, data });
      }
      // G8: OpenStreetMap (stigar, vägar, hus, ledningar) för jobbets ruta följer med i grundkartan; går det inte sägs det.
      let osm: SourceData | undefined, osmMissing = false;
      const box = baseMap && job.clip ? clipWgs84(job.clip) : undefined;
      if (box) {
        const response = await clubRequest(`${base}/sources/osm`, "POST", { formatVersion: 1, box }).catch(() => ({ status: 0, json: undefined }));
        osm = response.status === 200 ? (response.json as { data?: SourceData } | undefined)?.data : undefined;
        osmMissing = !osm;
      }
      const data: SourceData = baseMap ? mergeBaseMap(parts, osm, georeference?.scale) : { ...parts[0]!.data };
      // Karttapullautins filer är i laserns SWEREF 99 TM; en DWG-ritnings koordinatsystem gissas eller anges i importen.
      importer.openData(`${job.name} – ${label}`, job.kind === "DWG" ? data : { ...data, crs: data.crs ?? 3006 }, job.kind !== "DWG");
      setMessage({ tone: "ok", text: osmMissing ? `${text.loaded(label)} ${text.osmMissing}` : text.loaded(label) });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof VectorParseError ? error.message : text.problems.generic("DXF") });
    } finally { setBusy(undefined); }
  }

  const ready = credential?.saved?.readable;
  const selected = (items ?? []).filter(item => chosen.has(item.id)).length;
  return <details className={styles.settings} data-testid="map-project-laser">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {list && <p className={styles.muted} role="status" data-testid="map-project-laser-server">{text.server[list.server.state]}
      {list.server.detail ? ` ${list.server.detail}` : ""}</p>}
    {credential && !ready ? <p className={styles.muted}>{mapSourcesText.ortho.noCredential} <a href="/konto#konto-lantmateriet">{mapSourcesText.ortho.account}</a></p> : <>
      <label>{mapSourcesText.ortho.where}<select value={where} onChange={event => setWhere(event.target.value)} data-testid="map-project-laser-area">
        <option value="">{mapSourcesText.ortho.whole}</option>
        {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
      </select></label>
      <span className={styles.actions}>
        <Button variant="secondary" disabled={!!busy} onClick={() => void search()} data-testid="map-project-laser-search">{text.search}</Button>
      </span>
      {items && items.length === 0 && <p className={styles.muted}>{text.none}</p>}
      {((items && items.length > 0) || rerun) && <fieldset className={styles.importLayers} data-testid="map-project-laser-items">
        {rerun && <p data-testid="map-project-laser-rerun">{text.rerunHeading(rerun.name)}{" "}
          <Button variant="quiet" onClick={() => setRerun(undefined)}>{text.cancel}</Button></p>}
        {rerun?.clip && <label>{text.sample}<select value={sample} onChange={event => setSample(event.target.value)} data-testid="map-project-laser-sample">
          <option value="">{text.sampleWhole}</option>
          <option value="middle">{text.sampleMiddle}</option>
          {areas.map(row => <option key={row.areaId} value={row.areaId}>{text.sampleArea(row.name)}</option>)}
        </select></label>}
        {!rerun && items?.map(item => <label key={item.id} className={styles.check}>
          <input type="checkbox" checked={chosen.has(item.id)} onChange={() => setChosen(current => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
            return next;
          })} />{text.item(item.datetime, item.id, item.bytes)}</label>)}
        {!rerun && clip && extras.length > 0 && [...new Set(extras.map(extra => extra.kind))].map(kind => <label key={kind} className={styles.check}>
          <input type="checkbox" checked={!skippedExtras.has(kind)} data-testid={`map-project-laser-extra-${kind}`} onChange={() => setSkippedExtras(current => {
            const next = new Set(current);
            if (next.has(kind)) next.delete(kind); else next.add(kind);
            return next;
          })} />{text.extras[kind]}</label>)}
        <label>{text.name}<input value={name} maxLength={80} onChange={event => setName(event.target.value)} data-testid="map-project-laser-name" /></label>
        <label>{text.interval}<select value={interval} onChange={event => setInterval_(Number(event.target.value))}>
          {INTERVALS.map(value => <option key={value} value={value}>{text.intervalOption(value)}</option>)}
        </select></label>
        <label>{text.formlines}<select value={formline} onChange={event => setFormline(Number(event.target.value))}>
          {[0, 1, 2].map(value => <option key={value} value={value}>{text.formlineOptions[value]}</option>)}
        </select></label>
        <fieldset className={styles.importLayers} data-testid="map-project-laser-choices">
          <legend>{text.choicesHeading}</legend>
          {LASER_CHOICES.map(choice => <label key={choice}>{text.choiceLabels[choice]}
            <select value={choices[choice]} data-testid={`map-project-laser-choice-${choice}`}
              onChange={event => setChoices(current => ({ ...current, [choice]: event.target.value as ChoiceLevel }))}>
              {(["less", "default", "more"] as const).map(level => <option key={level} value={level}>{text.choiceLevels[choice]?.[level] ?? level}</option>)}
            </select></label>)}
          <small className={styles.muted}>{text.choicesHelp}</small>
        </fieldset>
        <details className={styles.settings} data-testid="map-project-laser-more">
          <summary>{text.more}</summary>
          <p className={styles.muted}>{text.moreHelp}</p>
          {MORE_SETTINGS.map(key => <label key={key}>{text.settingField(text.settingLabels[key] ?? key, key, PULLAUTIN_SETTINGS[key][0], PULLAUTIN_SETTINGS[key][1])}
            <input inputMode="decimal" value={more[key] ?? ""} placeholder={text.settingDefault} data-testid={`map-project-laser-setting-${key}`}
              onChange={event => setMore(current => ({ ...current, [key]: event.target.value }))} />
            <small className={styles.muted}>{text.settingHints[key]}</small></label>)}
        </details>
        <label className={styles.check}><input type="checkbox" checked={moisture} onChange={event => setMoisture(event.target.checked)}
          data-testid="map-project-laser-moisture" />{text.moisture}</label>
        {moisture && <>
          <label>{text.channel}<select value={channelHa} onChange={event => setChannelHa(Number(event.target.value))}>
            {[0.5, 1, 2, 4].map(value => <option key={value} value={value}>{text.channelOption(value)}</option>)}
          </select></label>
          <label>{text.wet}<select value={wetMeters} onChange={event => setWetMeters(Number(event.target.value))}>
            {[0.3, 0.5, 1].map(value => <option key={value} value={value}>{text.wetOption(value)}</option>)}
          </select></label>
        </>}
        <label className={styles.check}><input type="checkbox" checked={vegetation} onChange={event => setVegetation(event.target.checked)}
          data-testid="map-project-laser-vegetation" />{text.vegetation}</label>
        {vegetation && <label>{text.minArea}<select value={minAreaM2} onChange={event => setMinAreaM2(Number(event.target.value))}>
          {[100, 300, 600, 1000].map(value => <option key={value} value={value}>{text.minAreaOption(value)}</option>)}
        </select></label>}
        <span className={styles.actions}>
          <Button disabled={!!busy || (!rerun && (selected === 0 || selected > 16))} onClick={() => void start()} data-testid="map-project-laser-start">
            {rerun ? text.rerunStart : text.start(selected)}</Button>
        </span>
      </fieldset>}
    </>}
    {busy && <p role="status" className={styles.muted}>{busy}</p>}
    {message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
      data-testid="map-project-laser-message">{message.text}</p>}
    {list && list.jobs.length > 0 && <div data-testid="map-project-laser-jobs">
      <h4>{text.jobs}</h4>
      <ul>
        {list.jobs.map(job => <li key={job.jobId} data-testid="map-project-laser-job">
          <strong>{job.name}</strong> · {job.kind === "DWG" ? text.dwgJob : text.tiles(job.tiles)} · {text.status[job.status]}
          {job.progress && <> · {text.progress(job.progress.step, job.progress.done, job.progress.total)}</>}
          {job.error && <span className={styles.problem}> · {job.error}</span>}
          {job.kind === "PULLAUTIN" && <span className={styles.muted}> · {job.clip
            ? text.clipped(Math.round(job.clip.maxX - job.clip.minX), Math.round(job.clip.maxY - job.clip.minY)) : text.unclipped}</span>}
          {Object.keys(job.settings).length > 0 && <span className={styles.muted}> · {text.settingsUsed(Object.entries(job.settings)
            .map(([key, value]) => `${key} ${value}`).join(", "))}</span>}
          {job.layerId && <span className={styles.muted}> · {text.layerAdded}</span>}
          {job.moistureLayerId && <span className={styles.muted}> · {text.moistureAdded}</span>}
          {job.status === "DONE" && importer.canImport && <span className={styles.actions}>
            {job.kind === "PULLAUTIN" && baseMapOutputs(job.outputs.map(output => output.name)).length > 1 && <Button disabled={!!busy} data-testid="map-project-laser-base-map"
              onClick={() => void candidates(job, baseMapOutputs(job.outputs.map(output => output.name)), text.baseMap, true)}>{text.loadBaseMap}</Button>}
            {job.outputs.filter(output => output.name in text.outputs).map(output => <Button key={output.name} variant="secondary" disabled={!!busy}
              onClick={() => void candidates(job, [output.name], text.outputs[output.name]!)}>{text.load(text.outputs[output.name]!)}</Button>)}
          </span>}
          {job.kind === "PULLAUTIN" && !ACTIVE.has(job.status) && importer.canImport && ready && <span className={styles.actions}>
            <Button variant="secondary" disabled={!!busy} onClick={() => startRerun(job)} data-testid="map-project-laser-rerun-start">{text.rerun}</Button>
          </span>}
          {(job.own || view.viewer.canManage) && <span className={styles.actions}>
            <Button variant="secondary" onClick={() => void remove(job)}>{ACTIVE.has(job.status) ? text.cancel : text.remove}</Button>
          </span>}
        </li>)}
      </ul>
      <p className={styles.muted}>{text.attribution}</p>
    </div>}
  </details>;
}

/** Förval: den nyaste skanningen för varje ruta (samma rutnamn kan finnas från flera år). */
function newestPerTile(items: readonly LaserItem[]): LaserItem[] {
  const best = new Map<string, LaserItem>();
  for (const item of items) {
    const key = item.bbox ? item.bbox.map(value => value.toFixed(3)).join(",") : item.id;
    const prior = best.get(key);
    if (!prior || (item.datetime ?? "") > (prior.datetime ?? "")) best.set(key, item);
  }
  return [...best.values()];
}
