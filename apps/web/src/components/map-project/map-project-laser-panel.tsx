"use client";

import { clipCenter, laserClip, sampleClip } from "../../lib/map-project-clip";
import { useEffect, useState } from "react";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { useTexts } from "../language-provider";
import {
  GEO_JOB_ENGINES, GEO_JOB_MAX_TILES, newestLaserTiles, PULLAUTIN_SETTINGS,
  type GeoExtraKind, type GeoJobEngine, type GeoJobView, type MapProjectView
} from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { defaultLaserInterval, LASER_FORM_DEFAULTS, laserIntervals, laserJobBody, type LaserExtra as ExtraItem, type LaserItem } from "../../lib/map-project-laser-request";
import {
  choiceSettings, choicesOf, cliffChoicesOf, CLIFF_STYLES, CONTOUR_STYLES, contourStyleOf, LASER_CHOICES, typedOf,
  VEG_SMOOTH_LEVELS, vegSmoothOf, type ChoiceLevel, type CliffStyle, type ContourStyle, type LaserChoices, type VegSmoothLevel
} from "../../lib/map-project-laser-choices";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import type { Bounds } from "../../lib/course-setting-viewport";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import { MapProjectLaserDownload } from "./map-project-laser-download";
import { MapProjectRawLaserChoice, MapProjectRawLaserLinks } from "./map-project-raw-laser";
import { lantmaterietGap, lantmaterietProblem } from "../../lib/lantmateriet-status";
import { LantmaterietNotice } from "../lantmateriet-connection";
import { LaserServerStatus } from "./map-project-laser-shared";
import { LASER_ACTIVE as ACTIVE, type LaserArea as Area, type useMapProjectLaser } from "./use-map-project-laser";
import styles from "./map-project-editor.module.css";

/** Fysikaliska finjusteringsfält för O-Tids egen motor (`otidgeo`). */
export const OTIDGEO_MORE_SETTINGS = [
  "smooth_m", "taubin", "min_loop_area", "min_clearance", "curviness", "formline_gap", "formline_max_slope",
  "veg_smooth", "greenscale", "topweight", "undergrowth"
] as const satisfies readonly (keyof typeof PULLAUTIN_SETTINGS)[];

/** Ägaren 2026-11-10: Karttapullautins inställningar (`pullauta.ini`), utöver ekvidistansen och stödkurvorna. */
export const PULLAUTIN_MORE_SETTINGS = [
  "smoothing", "curviness", "knolls", "formlinesteepness", "cliff1", "cliff2", "cliffsteepfactor", "yellowheight", "greenground", "greenhigh",
  "topweight", "greenscale", "undergrowth"
] as const satisfies readonly (keyof typeof PULLAUTIN_SETTINGS)[];

const ALL_MORE_SETTINGS = [...new Set([...OTIDGEO_MORE_SETTINGS, ...PULLAUTIN_MORE_SETTINGS])] as readonly (keyof typeof PULLAUTIN_SETTINGS)[];

/** Fälten som tal inom gränserna; tomma och ogiltiga fält hoppas över (motorns förval gäller). */
export function moreSettings(fields: Readonly<Record<string, string>>, keys: readonly (keyof typeof PULLAUTIN_SETTINGS)[] = ALL_MORE_SETTINGS): Record<string, number> {
  return Object.fromEntries(keys.flatMap(key => {
    const raw = fields[key]?.trim().replace(",", "."), value = raw ? Number(raw) : NaN, [low, high] = PULLAUTIN_SETTINGS[key];
    return Number.isFinite(value) && value >= low && value <= high ? [[key, value]] : [];
  }));
}

/**
 * ADR-0219 K5 & Etapp G4B: laserdata från Lantmäteriet med O-Tids egen motor (`otidgeo`) eller bildmotorfri Karttapullautin
 * på geo-servern. Rutorna söks för kartan eller en etapp; jobbet körs på geo-servern och underlagen + vektorfilerna kan läsas
 * in som kandidater (K4b). Sökningen, starten, listan och inläsningen ligger i `useMapProjectLaser`, som delas med guiden.
 */
export function MapProjectLaserPanel({ view, laser, importer, georeference, bounds, areas }: { view: MapProjectView;
  laser: ReturnType<typeof useMapProjectLaser>; importer: ReturnType<typeof useMapProjectImport>; georeference: MapGeoreference | undefined;
  bounds: Bounds | undefined; areas: readonly Area[] }) {
  const mapSourcesText = useTexts(mapSourcesSv, mapSourcesEn);
  const text = useTexts(mapSourcesSv.laser, mapSourcesEn.laser);
  const { credential, list, ready } = laser, busy = laser.busy, message = laser.messageFor("panel");
  const connection = message?.tone === "error" ? lantmaterietProblem(message.code, credential) : undefined;
  const [where, setWhere] = useState("");
  const [items, setItems] = useState<LaserItem[]>();
  // G8: Lantmäteriets Marktäcke och Byggnad för rutan (när kontot kommer åt dem), och vilka som ska läsas.
  const [extras, setExtras] = useState<readonly ExtraItem[]>([]);
  const [skippedExtras, setSkippedExtras] = useState<ReadonlySet<GeoExtraKind>>(new Set());
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [engine, setEngine] = useState<GeoJobEngine>(LASER_FORM_DEFAULTS.engine);
  const [name, setName] = useState("");
  // Ekvidistansen följer kartans norm (sprint 2,5 m, skog 5 m) tills någon väljer en annan.
  const [intervalChoice, setInterval_] = useState<number>();
  const interval = intervalChoice ?? defaultLaserInterval(!!importer.sprint);
  const [formline, setFormline] = useState<number>(LASER_FORM_DEFAULTS.formline);
  const [contours, setContours] = useState<ContourStyle>(LASER_FORM_DEFAULTS.contours);
  const [more, setMore] = useState<Readonly<Record<string, string>>>({});
  const [choices, setChoices] = useState<LaserChoices>(LASER_FORM_DEFAULTS.choices);
  const [cliffStyle, setCliffStyle] = useState<CliffStyle>(LASER_FORM_DEFAULTS.cliffStyle);
  const [cliffTags, setCliffTags] = useState(LASER_FORM_DEFAULTS.cliffTags);
  const [overview, setOverview] = useState(LASER_FORM_DEFAULTS.overview);
  const [rawTicks, setRawTicks] = useState(false);
  const [rawLaser, setRawLaser] = useState(false);
  // G6 (ägaren 2026-11-11: «itereringar av olika lager, t.ex. grönt, efter första körning»): ett klart jobb körs om med samma
  // rutor och område men nya inställningar, och resultaten jämförs innan något läggs in i kartan.
  const [rerun, setRerun] = useState<GeoJobView>();
  // Provrutan: «» hela området, «middle» mitten av jobbets område, annars en etapps mitt.
  const [sample, setSample] = useState("");
  // Ägaren 2026-11-11: fuktigheten och vegetationen är förvalda, så att kärr och grönt alltid kommer med i grundkartan.
  const [moisture, setMoisture] = useState(LASER_FORM_DEFAULTS.moisture);
  const [channelHa, setChannelHa] = useState<number>(LASER_FORM_DEFAULTS.channelHa);
  const [wetMeters, setWetMeters] = useState<number>(LASER_FORM_DEFAULTS.wetMeters);
  const [vegetation, setVegetation] = useState(LASER_FORM_DEFAULTS.vegetation);
  const [minAreaM2, setMinAreaM2] = useState<number>(LASER_FORM_DEFAULTS.minAreaM2);
  const [vegSmooth, setVegSmooth] = useState<VegSmoothLevel>(LASER_FORM_DEFAULTS.vegSmooth);
  const area = areas.find(row => row.areaId === where);
  const stagesFor = (job: GeoJobView) => laser.stagesOf(job);
  useEffect(() => { setItems(undefined); setExtras([]); setChosen(new Set()); setName(text.defaultName(area?.name)); }, [where, area?.name]);

  if (!view.viewer.canPropose || !georeference || !bounds) return null;

  async function search() {
    const found = await laser.search(area, "panel");
    if (!found) return;
    setItems(found.items); setExtras(found.extras);
    setChosen(new Set(newestLaserTiles(found.items).map(item => item.id)));
  }

  // Utan etapp klipps laserdatan till kartans eget område (polygonen), se `clipOf`.
  const clip = laser.clipOf(area);
  const sampleArea = areas.find(row => row.areaId === sample);
  const sampleCenter = !rerun?.clip || !sample ? undefined : sample === "middle" ? clipCenter(rerun.clip)
    : sampleArea ? (box => box && clipCenter(box))(laserClip(bounds, georeference, 0, sampleArea)) : undefined;
  const sampled = rerun && sampleCenter ? sampleClip(sampleCenter, rerun.clip) : undefined;
  const moreKeys = engine === "otidgeo" ? OTIDGEO_MORE_SETTINGS : PULLAUTIN_MORE_SETTINGS;

  async function start() {
    const tiles = (items ?? []).filter(item => chosen.has(item.id));
    const ok = await laser.start(laserJobBody({
      name: (name.trim() || text.defaultName(area?.name)).slice(0, sampled ? 68 : 80) + (sampled ? text.sampleSuffix : ""),
      engine, interval, formline, sprint: !!importer.sprint,
      chosen: choiceSettings(choices, moreSettings(more, moreKeys), cliffStyle, cliffTags, engine === "pullautin" && rawTicks,
        { engine, contours, sprint: interval <= 3, vegSmooth: vegetation ? vegSmooth : "normal", overview }),
      // Kör om: rutorna, området och Lantmäteriets produkter tas från jobbet; annars de valda rutorna och kartans område.
      target: rerun ? { rerunOf: rerun.jobId, clip: sampled } : { tiles, clip, areaId: area?.areaId, extras: extras.filter(extra => !skippedExtras.has(extra.kind)) },
      moisture: moisture ? { channelHa, wetMeters } : undefined, vegetation: vegetation ? { minAreaM2 } : undefined,
      rawLaser: rawLaser && list?.rawLaserAvailable === true
    }), "panel");
    if (ok) { setItems(undefined); setRerun(undefined); setSample(""); setRawLaser(false); }
  }

  /** Formuläret med jobbets inställningar och motor, för att köra om det med andra. */
  function startRerun(job: GeoJobView) {
    const settings = job.settings;
    const jobEngine: GeoJobEngine = job.engine ?? "pullautin";
    const jobInterval = settings.contour_interval ?? 5;
    const jobSprint = jobInterval <= 3;
    const picked = choicesOf(settings, jobEngine);
    const pickedContours = contourStyleOf(settings, jobEngine, jobSprint);
    const pickedVegSmooth = vegSmoothOf(settings);
    const pickedOverview = settings.overview !== 0;
    const jobMoreKeys = jobEngine === "otidgeo" ? OTIDGEO_MORE_SETTINGS : PULLAUTIN_MORE_SETTINGS;
    setRerun(job); setItems(undefined); laser.clear();
    setEngine(jobEngine);
    setName(text.rerunName(job.name));
    setInterval_(jobInterval); setFormline(settings.formline ?? 2);
    setContours(pickedContours); setVegSmooth(pickedVegSmooth); setOverview(pickedOverview);
    const cliffs = cliffChoicesOf(job.cliffs);
    setChoices({ ...picked, cliffs: cliffs.level }); setCliffStyle(cliffs.style); setCliffTags(cliffs.tags); setRawTicks(cliffs.rawTicks);
    setMore(typedOf(settings, picked, jobMoreKeys, { engine: jobEngine, contours: pickedContours, sprint: jobSprint, vegSmooth: pickedVegSmooth, overview: pickedOverview }));
    setMoisture(!!job.moisture); setVegetation(!!job.vegetation);
    if (job.moisture) { setChannelHa(job.moisture.channelHa); setWetMeters(job.moisture.wetMeters); }
    if (job.vegetation) setMinAreaM2(job.vegetation.minAreaM2);
  }

  const selected = (items ?? []).filter(item => chosen.has(item.id)).length;
  return <details className={styles.settings} data-testid="map-project-laser">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {list && <LaserServerStatus list={list} testId="map-project-laser" />}
    {credential && !ready ? <LantmaterietNotice problem={lantmaterietGap(credential) ?? "missing"} product="laser" /> : <>
      <label>{mapSourcesText.ortho.where}<select value={where} onChange={event => setWhere(event.target.value)} data-testid="map-project-laser-area">
        <option value="">{mapSourcesText.ortho.whole}</option>
        {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
      </select></label>
      <span className={styles.actions}>
        <Button variant="secondary" disabled={busy} onClick={() => void search()} data-testid="map-project-laser-search">{text.search}</Button>
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
        <label>{text.engine}<select value={engine} onChange={event => setEngine(event.target.value as GeoJobEngine)} data-testid="map-project-laser-engine">
          {GEO_JOB_ENGINES.map(value => <option key={value} value={value}>{text.engineOptions[value]}</option>)}
        </select></label>
        {engine === "pullautin" && <small className={styles.muted} data-testid="map-project-laser-pullautin-note">{text.pullautinNoOverview}</small>}
        <label>{text.name}<input value={name} maxLength={80} onChange={event => setName(event.target.value)} data-testid="map-project-laser-name" /></label>
        <label>{text.interval}<select value={interval} onChange={event => setInterval_(Number(event.target.value))}>
          {laserIntervals(!!importer.sprint).map(value => <option key={value} value={value}>{text.intervalOption(value)}</option>)}
        </select></label>
        <label>{text.formlines}<select value={formline} onChange={event => setFormline(Number(event.target.value))} data-testid="map-project-laser-formline">
          {[0, 1, 2, 3].map(value => <option key={value} value={value}>{text.formlineOptions[value]}</option>)}
        </select></label>
        <fieldset className={styles.importLayers} data-testid="map-project-laser-choices">
          <legend>{text.choicesHeading}</legend>
          <label>{text.contours}
            <select value={contours} data-testid="map-project-laser-contours" onChange={event => setContours(event.target.value as ContourStyle)}>
              {CONTOUR_STYLES.map(style => <option key={style} value={style}>{text.contourStyles[style]}</option>)}
            </select></label>
          {LASER_CHOICES.map(choice => <label key={choice}>{text.choiceLabels[choice]}
            <select value={choices[choice]} data-testid={`map-project-laser-choice-${choice}`}
              onChange={event => setChoices(current => ({ ...current, [choice]: event.target.value as ChoiceLevel }))}>
              {(["less", "default", "more"] as const).map(level => <option key={level} value={level}>{text.choiceLevels[choice]?.[level] ?? level}</option>)}
            </select></label>)}
          <label>{text.cliffStyle}
            <select value={cliffStyle} data-testid="map-project-laser-cliff-style" onChange={event => setCliffStyle(event.target.value as CliffStyle)}>
              {CLIFF_STYLES.map(style => <option key={style} value={style}>{text.cliffStyles[style]}</option>)}
            </select></label>
          <label><input type="checkbox" checked={cliffTags} data-testid="map-project-laser-cliff-tags" onChange={event => setCliffTags(event.target.checked)} /> {text.cliffTags}</label>
          <small className={styles.muted}>{text.choicesHelp}</small>
        </fieldset>
        <details className={styles.settings} data-testid="map-project-laser-more">
          <summary>{text.more[engine]}</summary>
          <p className={styles.muted}>{text.moreHelp[engine]}</p>
          {engine === "otidgeo" ? <>
            <label><input type="checkbox" checked={overview} data-testid="map-project-laser-overview" onChange={event => setOverview(event.target.checked)} /> {text.overview}</label>
            <small className={styles.muted}>{text.overviewHelp}</small>
          </> : <>
            <label><input type="checkbox" checked={rawTicks} data-testid="map-project-laser-raw-ticks" onChange={event => setRawTicks(event.target.checked)} /> {text.rawTicks}</label>
            <small className={styles.muted}>{text.rawTicksHelp}</small>
          </>}
          {moreKeys.map(key => <label key={key}>{text.settingField(text.settingLabels[key] ?? key, key, PULLAUTIN_SETTINGS[key][0], PULLAUTIN_SETTINGS[key][1])}
            <input inputMode="decimal" value={more[key] ?? ""} placeholder={text.settingDefault} data-testid={`map-project-laser-setting-${key}`}
              onChange={event => setMore(current => ({ ...current, [key]: event.target.value }))} />
            <small className={styles.muted}>{engine === "otidgeo" ? text.otidgeoSettingHints[key] ?? text.settingHints[key] : text.settingHints[key]}</small></label>)}
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
        {vegetation && <>
          <label>{text.minArea}<select value={minAreaM2} onChange={event => setMinAreaM2(Number(event.target.value))}>
            {[100, 300, 600, 1000].map(value => <option key={value} value={value}>{text.minAreaOption(value)}</option>)}
          </select></label>
          <label>{text.vegSmooth}<select value={vegSmooth} onChange={event => setVegSmooth(event.target.value as VegSmoothLevel)} data-testid="map-project-laser-veg-smooth">
            {VEG_SMOOTH_LEVELS.map(level => <option key={level} value={level}>{text.vegSmoothOptions[level]}</option>)}
          </select></label>
        </>}
        <MapProjectRawLaserChoice available={list?.rawLaserAvailable === true} checked={rawLaser} onChange={setRawLaser} />
        <span className={styles.actions}>
          <Button disabled={busy || (!rerun && (selected === 0 || selected > GEO_JOB_MAX_TILES))} onClick={() => void start()} data-testid="map-project-laser-start">
            {rerun ? text.rerunStart : text.start(selected, engine)}</Button>
          {!rerun && selected > GEO_JOB_MAX_TILES && <span role="alert" className={styles.problem}>{text.tooManyTiles(selected, GEO_JOB_MAX_TILES)}</span>}
        </span>
      </fieldset>}
    </>}
    {(laser.busyFor("panel") || importer.computing) && <p role="status" className={styles.muted} data-testid="map-project-laser-status">{laser.busyFor("panel") ?? text.steps.candidates}</p>}
    {connection ? <LantmaterietNotice problem={connection} product="laser" />
      : message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
        data-testid="map-project-laser-message">{message.text}</p>}
    {list && list.jobs.length > 0 && <div data-testid="map-project-laser-jobs">
      <h4>{text.jobs}</h4>
      <ul>
        {list.jobs.map(job => <li key={job.jobId} data-testid="map-project-laser-job">
          <strong>{job.name}</strong> · {job.kind === "DWG" ? text.dwgJob : text.tiles(job.tiles)} · {text.status[job.status]}
          {job.kind === "PULLAUTIN" && <span className={styles.muted} data-testid="map-project-laser-job-engine"> · {text.engineShort[job.engine ?? "pullautin"]}</span>}
          {job.progress && <> · {text.progress(job.progress.step, job.progress.done, job.progress.total)}</>}
          {job.status === "QUEUED" && list.queue?.ahead[job.jobId] !== undefined && <> · {text.ahead(list.queue.ahead[job.jobId]!)}</>}
          {job.error && <span className={styles.problem}> · {job.error}</span>}
          {job.kind === "PULLAUTIN" && <span className={styles.muted}> · {job.clip
            ? text.clipped(Math.round(job.clip.maxX - job.clip.minX), Math.round(job.clip.maxY - job.clip.minY)) : text.unclipped}</span>}
          {Object.keys(job.settings).length > 0 && <span className={styles.muted}> · {text.settingsUsed(Object.entries(job.settings)
            .map(([key, value]) => `${key} ${value}`).join(", "))}</span>}
          {job.mergedStages !== undefined && <span className={styles.muted} data-testid="map-project-laser-merged"> · {(job.status === "DONE" ? text.mergedFrom : text.mergingFrom)(job.mergedStages)}</span>}
          {job.layerId && <span className={styles.muted}> · {text.layerAdded}</span>}
          {job.moistureLayerId && <span className={styles.muted}> · {text.moistureAdded}</span>}
          {job.skippedSteps.length > 0 && <span className={styles.muted} data-testid="map-project-laser-skipped"> · {text.skippedSteps(job.skippedSteps.map(step => text.stepNames[step] ?? step).join(", "))}</span>}
          {job.status === "DONE" && importer.canImport && <span className={styles.actions}>
            {stagesFor(job) && <Button disabled={busy} data-testid="map-project-laser-stages"
              onClick={() => void laser.loadStages(job, stagesFor(job)!, "panel")}>{text.loadStages(stagesFor(job)!.length)}</Button>}
            {stagesFor(job) && <Button variant="secondary" disabled={busy} data-testid="map-project-laser-merge"
              onClick={() => void laser.mergeStages(job, "panel")}>{text.mergeStages}</Button>}
            {laser.baseMapFiles(job).length > 1 && <Button variant={stagesFor(job) ? "secondary" : "primary"} disabled={busy} data-testid="map-project-laser-base-map"
              onClick={() => void laser.loadBaseMap(job, "panel")}>{text.loadBaseMap}</Button>}
            {job.outputs.filter(output => output.name in text.outputs).map(output => <Button key={output.name} variant="secondary" disabled={busy}
              onClick={() => void laser.candidates(job, [output.name], text.outputs[output.name]!, false, "panel")}>{text.load(text.outputs[output.name]!)}</Button>)}
          </span>}
          {job.status === "DONE" && job.outputs.length > 0 && <MapProjectLaserDownload projectId={view.projectId} job={job} />}
          <MapProjectRawLaserLinks job={job} />
          {job.kind === "PULLAUTIN" && !ACTIVE.has(job.status) && importer.canImport && ready && <span className={styles.actions}>
            <Button variant="secondary" disabled={busy} onClick={() => startRerun(job)} data-testid="map-project-laser-rerun-start">{text.rerun}</Button>
          </span>}
          {(job.own || view.viewer.canManage) && <span className={styles.actions}>
            <Button variant="secondary" onClick={() => void laser.remove(job, "panel")}>{ACTIVE.has(job.status) ? text.cancel : text.remove}</Button>
          </span>}
        </li>)}
      </ul>
      <p className={styles.muted}>{text.attribution}</p>
    </div>}
  </details>;
}
