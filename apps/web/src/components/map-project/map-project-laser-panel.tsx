"use client";

import { clipCenter, laserClip, sampleClip } from "../../lib/map-project-clip";
import { useEffect, useState } from "react";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { useTexts } from "../language-provider";
import { GEO_JOB_MAX_TILES, newestLaserTiles, PULLAUTIN_SETTINGS, type GeoExtraKind, type GeoJobView, type MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { defaultLaserInterval, LASER_FORM_DEFAULTS, laserIntervals, laserJobBody, type LaserExtra as ExtraItem, type LaserItem } from "../../lib/map-project-laser-request";
import { choiceSettings, choicesOf, cliffChoicesOf, CLIFF_STYLES, LASER_CHOICES, typedOf, type ChoiceLevel, type CliffStyle, type LaserChoices } from "../../lib/map-project-laser-choices";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import type { Bounds } from "../../lib/course-setting-viewport";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import { LaserCredentialHint, LaserServerStatus } from "./map-project-laser-shared";
import { LASER_ACTIVE as ACTIVE, type LaserArea as Area, type useMapProjectLaser } from "./use-map-project-laser";
import styles from "./map-project-editor.module.css";

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
 * Sökningen, starten, listan och inläsningen ligger i `useMapProjectLaser`, som delas med guiden «Ny grundkarta».
 */
export function MapProjectLaserPanel({ view, laser, importer, georeference, bounds, areas }: { view: MapProjectView;
  laser: ReturnType<typeof useMapProjectLaser>; importer: ReturnType<typeof useMapProjectImport>; georeference: MapGeoreference | undefined;
  bounds: Bounds | undefined; areas: readonly Area[] }) {
  const mapSourcesText = useTexts(mapSourcesSv, mapSourcesEn);
  const text = useTexts(mapSourcesSv.laser, mapSourcesEn.laser);
  const { credential, list, ready } = laser, busy = laser.busy, message = laser.messageFor("panel");
  const [where, setWhere] = useState("");
  const [items, setItems] = useState<LaserItem[]>();
  // G8: Lantmäteriets Marktäcke och Byggnad för rutan (när kontot kommer åt dem), och vilka som ska läsas.
  const [extras, setExtras] = useState<readonly ExtraItem[]>([]);
  const [skippedExtras, setSkippedExtras] = useState<ReadonlySet<GeoExtraKind>>(new Set());
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  // Ekvidistansen följer kartans norm (sprint 2,5 m, skog 5 m) tills någon väljer en annan.
  const [intervalChoice, setInterval_] = useState<number>();
  const interval = intervalChoice ?? defaultLaserInterval(!!importer.sprint);
  const [formline, setFormline] = useState<number>(LASER_FORM_DEFAULTS.formline);
  const [more, setMore] = useState<Readonly<Record<string, string>>>({});
  const [choices, setChoices] = useState<LaserChoices>(LASER_FORM_DEFAULTS.choices);
  const [cliffStyle, setCliffStyle] = useState<CliffStyle>(LASER_FORM_DEFAULTS.cliffStyle);
  const [cliffTags, setCliffTags] = useState(LASER_FORM_DEFAULTS.cliffTags);
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
  async function start() {
    const tiles = (items ?? []).filter(item => chosen.has(item.id));
    const ok = await laser.start(laserJobBody({ name: (name.trim() || text.defaultName(area?.name)).slice(0, sampled ? 68 : 80) + (sampled ? text.sampleSuffix : ""),
      interval, formline, sprint: !!importer.sprint, chosen: choiceSettings(choices, moreSettings(more), cliffStyle, cliffTags),
      // Kör om: rutorna, området och Lantmäteriets produkter tas från jobbet; annars de valda rutorna och kartans område.
      target: rerun ? { rerunOf: rerun.jobId, clip: sampled } : { tiles, clip, areaId: area?.areaId, extras: extras.filter(extra => !skippedExtras.has(extra.kind)) },
      moisture: moisture ? { channelHa, wetMeters } : undefined, vegetation: vegetation ? { minAreaM2 } : undefined }), "panel");
    if (ok) { setItems(undefined); setRerun(undefined); setSample(""); }
  }

  /** Formuläret med jobbets inställningar, för att köra om det med andra. */
  function startRerun(job: GeoJobView) {
    const settings = job.settings;
    const picked = choicesOf(settings);
    setRerun(job); setItems(undefined); laser.clear();
    setName(text.rerunName(job.name));
    setInterval_(settings.contour_interval ?? 5); setFormline(settings.formline ?? 2);
    const cliffs = cliffChoicesOf(job.cliffs);
    setChoices({ ...picked, cliffs: cliffs.level }); setCliffStyle(cliffs.style); setCliffTags(cliffs.tags);
    setMore(typedOf(settings, picked, MORE_SETTINGS));
    setMoisture(!!job.moisture); setVegetation(!!job.vegetation);
    if (job.moisture) { setChannelHa(job.moisture.channelHa); setWetMeters(job.moisture.wetMeters); }
    if (job.vegetation) setMinAreaM2(job.vegetation.minAreaM2);
  }

  const selected = (items ?? []).filter(item => chosen.has(item.id)).length;
  return <details className={styles.settings} data-testid="map-project-laser">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {list && <LaserServerStatus list={list} testId="map-project-laser" />}
    {credential && !ready ? <LaserCredentialHint /> : <>
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
        <label>{text.name}<input value={name} maxLength={80} onChange={event => setName(event.target.value)} data-testid="map-project-laser-name" /></label>
        <label>{text.interval}<select value={interval} onChange={event => setInterval_(Number(event.target.value))}>
          {laserIntervals(!!importer.sprint).map(value => <option key={value} value={value}>{text.intervalOption(value)}</option>)}
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
          <label>{text.cliffStyle}
            <select value={cliffStyle} data-testid="map-project-laser-cliff-style" onChange={event => setCliffStyle(event.target.value as CliffStyle)}>
              {CLIFF_STYLES.map(style => <option key={style} value={style}>{text.cliffStyles[style]}</option>)}
            </select></label>
          <label><input type="checkbox" checked={cliffTags} data-testid="map-project-laser-cliff-tags" onChange={event => setCliffTags(event.target.checked)} /> {text.cliffTags}</label>
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
          <Button disabled={busy || (!rerun && (selected === 0 || selected > GEO_JOB_MAX_TILES))} onClick={() => void start()} data-testid="map-project-laser-start">
            {rerun ? text.rerunStart : text.start(selected)}</Button>
          {!rerun && selected > GEO_JOB_MAX_TILES && <span role="alert" className={styles.problem}>{text.tooManyTiles(selected, GEO_JOB_MAX_TILES)}</span>}
        </span>
      </fieldset>}
    </>}
    {(laser.busyFor("panel") || importer.computing) && <p role="status" className={styles.muted} data-testid="map-project-laser-status">{laser.busyFor("panel") ?? text.steps.candidates}</p>}
    {message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
      data-testid="map-project-laser-message">{message.text}</p>}
    {list && list.jobs.length > 0 && <div data-testid="map-project-laser-jobs">
      <h4>{text.jobs}</h4>
      <ul>
        {list.jobs.map(job => <li key={job.jobId} data-testid="map-project-laser-job">
          <strong>{job.name}</strong> · {job.kind === "DWG" ? text.dwgJob : text.tiles(job.tiles)} · {text.status[job.status]}
          {job.progress && <> · {text.progress(job.progress.step, job.progress.done, job.progress.total)}</>}
          {job.status === "QUEUED" && list.queue?.ahead[job.jobId] !== undefined && <> · {text.ahead(list.queue.ahead[job.jobId]!)}</>}
          {job.error && <span className={styles.problem}> · {job.error}</span>}
          {job.kind === "PULLAUTIN" && <span className={styles.muted}> · {job.clip
            ? text.clipped(Math.round(job.clip.maxX - job.clip.minX), Math.round(job.clip.maxY - job.clip.minY)) : text.unclipped}</span>}
          {Object.keys(job.settings).length > 0 && <span className={styles.muted}> · {text.settingsUsed(Object.entries(job.settings)
            .map(([key, value]) => `${key} ${value}`).join(", "))}</span>}
          {job.layerId && <span className={styles.muted}> · {text.layerAdded}</span>}
          {job.moistureLayerId && <span className={styles.muted}> · {text.moistureAdded}</span>}
          {job.skippedSteps.length > 0 && <span className={styles.muted} data-testid="map-project-laser-skipped"> · {text.skippedSteps(job.skippedSteps.map(step => text.stepNames[step] ?? step).join(", "))}</span>}
          {job.status === "DONE" && importer.canImport && <span className={styles.actions}>
            {stagesFor(job) && <Button disabled={busy} data-testid="map-project-laser-stages"
              onClick={() => void laser.loadStages(job, stagesFor(job)!, "panel")}>{text.loadStages(stagesFor(job)!.length)}</Button>}
            {laser.baseMapFiles(job).length > 1 && <Button variant={stagesFor(job) ? "secondary" : "primary"} disabled={busy} data-testid="map-project-laser-base-map"
              onClick={() => void laser.loadBaseMap(job, "panel")}>{text.loadBaseMap}</Button>}
            {job.outputs.filter(output => output.name in text.outputs).map(output => <Button key={output.name} variant="secondary" disabled={busy}
              onClick={() => void laser.candidates(job, [output.name], text.outputs[output.name]!, false, "panel")}>{text.load(text.outputs[output.name]!)}</Button>)}
          </span>}
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
