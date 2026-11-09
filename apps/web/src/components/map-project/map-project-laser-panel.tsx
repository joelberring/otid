"use client";

import { useCallback, useEffect, useState } from "react";
import type { GeoJobList, GeoJobView, MapProjectView, MapSourceCredentialView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { parseDxf, VectorParseError } from "@o-tid/map-revision";
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

const text = mapSourcesSv.laser;
interface LaserItem { id: string; datetime: string | null; href: string; bbox: [number, number, number, number] | null; bytes: number | null; epsg: number | null }
type Area = BoxArea & { areaId: string };
const INTERVALS = [2.5, 5] as const;
const ACTIVE = new Set(["QUEUED", "RUNNING"]);

/**
 * ADR-0219 K5: laserdata från Lantmäteriet och Karttapullautin på geo-servern. Rutorna söks för kartan eller en etapp; jobbet
 * körs på geo-servern och resultatet (bilden) blir ett underlag. Kurvor och de andra linjerna läses in som kandidater (K4b).
 */
export function MapProjectLaserPanel({ view, layers, importer, georeference, bounds, areas }: { view: MapProjectView;
  layers: ReturnType<typeof useMapProjectLayers>; importer: ReturnType<typeof useMapProjectImport>; georeference: MapGeoreference | undefined;
  bounds: Bounds | undefined; areas: readonly Area[] }) {
  const base = mapProjectBase(view.projectId);
  const [credential, setCredential] = useState<MapSourceCredentialView>();
  const [list, setList] = useState<GeoJobList>();
  const [where, setWhere] = useState("");
  const [items, setItems] = useState<LaserItem[]>();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  const [interval, setInterval_] = useState<number>(5);
  const [formline, setFormline] = useState(2);
  const [moisture, setMoisture] = useState(false);
  const [channelHa, setChannelHa] = useState(1);
  const [wetMeters, setWetMeters] = useState(0.5);
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
  useEffect(() => { setItems(undefined); setChosen(new Set()); setName(text.defaultName(area?.name)); }, [where, area?.name]);

  if (!view.viewer.canPropose || !georeference || !bounds) return null;

  async function search() {
    setBusy(text.searching); setMessage(undefined);
    try {
      const result = await clubRequest(`${base}/sources/lantmateriet/laser`, "POST", { formatVersion: 1, box: areaBox(bounds!, georeference!, area).wgs84 })
        .catch(() => ({ status: 0, json: undefined }));
      const body = result.json as { items?: LaserItem[]; error?: string } | undefined;
      if (result.status !== 200 || !body?.items) { say(body?.error ?? result.status); return; }
      setItems(body.items);
      setChosen(new Set(newestPerTile(body.items).map(item => item.id)));
    } finally { setBusy(undefined); }
  }

  async function start() {
    const tiles = (items ?? []).filter(item => chosen.has(item.id)).map(item => ({ id: item.id, href: item.href, bbox: item.bbox, epsg: item.epsg }));
    setBusy(text.searching); setMessage(undefined);
    try {
      const result = await clubRequest(`${base}/geo-jobs`, "POST", { formatVersion: 1, requestId: crypto.randomUUID(), kind: "PULLAUTIN",
        name: name.trim() || text.defaultName(area?.name), tiles, settings: { contour_interval: interval, formline },
        ...(moisture ? { moisture: { channelHa, wetMeters, moistMeters: Math.max(1, wetMeters * 2) } } : {}) }).catch(() => ({ status: 0, json: undefined }));
      const body = result.json as { error?: string } | undefined;
      if (result.status !== 201 && result.status !== 200) { say(body?.error ?? result.status); return; }
      setItems(undefined); setMessage({ tone: "ok", text: text.started });
      await load();
    } finally { setBusy(undefined); }
  }

  async function remove(job: GeoJobView) {
    const result = await clubRequest(`${base}/geo-jobs/${job.jobId}`, "DELETE").catch(() => ({ status: 0, json: undefined }));
    if (result.status !== 200) say((result.json as { error?: string } | undefined)?.error ?? result.status);
    await load();
  }

  async function candidates(job: GeoJobView, output: string) {
    const label = text.outputs[output] ?? output;
    setBusy(label); setMessage(undefined);
    try {
      const response = await fetch(`${base}/geo-jobs/${job.jobId}/outputs/${output}`, { credentials: "same-origin" }).catch(() => undefined);
      if (!response?.ok) { say(response?.status); return; }
      const data = parseDxf(await response.text());
      importer.openData(`${job.name} – ${label}`, { ...data, crs: data.crs ?? 3006 });
      setMessage({ tone: "ok", text: text.loaded(label) });
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
    {credential && !ready ? <p className={styles.muted}>{mapSourcesSv.ortho.noCredential} <a href="/konto#konto-lantmateriet">{mapSourcesSv.ortho.account}</a></p> : <>
      <label>{mapSourcesSv.ortho.where}<select value={where} onChange={event => setWhere(event.target.value)} data-testid="map-project-laser-area">
        <option value="">{mapSourcesSv.ortho.whole}</option>
        {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
      </select></label>
      <span className={styles.actions}>
        <Button variant="secondary" disabled={!!busy} onClick={() => void search()} data-testid="map-project-laser-search">{text.search}</Button>
      </span>
      {items && items.length === 0 && <p className={styles.muted}>{text.none}</p>}
      {items && items.length > 0 && <fieldset className={styles.importLayers} data-testid="map-project-laser-items">
        {items.map(item => <label key={item.id} className={styles.check}>
          <input type="checkbox" checked={chosen.has(item.id)} onChange={() => setChosen(current => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
            return next;
          })} />{text.item(item.datetime, item.id, item.bytes)}</label>)}
        <label>{text.name}<input value={name} maxLength={80} onChange={event => setName(event.target.value)} data-testid="map-project-laser-name" /></label>
        <label>{text.interval}<select value={interval} onChange={event => setInterval_(Number(event.target.value))}>
          {INTERVALS.map(value => <option key={value} value={value}>{text.intervalOption(value)}</option>)}
        </select></label>
        <label>{text.formlines}<select value={formline} onChange={event => setFormline(Number(event.target.value))}>
          {[0, 1, 2].map(value => <option key={value} value={value}>{text.formlineOptions[value]}</option>)}
        </select></label>
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
        <span className={styles.actions}>
          <Button disabled={!!busy || selected === 0 || selected > 16} onClick={() => void start()} data-testid="map-project-laser-start">{text.start(selected)}</Button>
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
          <strong>{job.name}</strong> · {text.tiles(job.tiles)} · {text.status[job.status]}
          {job.progress && <> · {text.progress(job.progress.step, job.progress.done, job.progress.total)}</>}
          {job.error && <span className={styles.problem}> · {job.error}</span>}
          {job.layerId && <span className={styles.muted}> · {text.layerAdded}</span>}
          {job.moistureLayerId && <span className={styles.muted}> · {text.moistureAdded}</span>}
          {job.status === "DONE" && importer.canImport && <span className={styles.actions}>
            {job.outputs.filter(output => output.name in text.outputs).map(output => <Button key={output.name} variant="secondary" disabled={!!busy}
              onClick={() => void candidates(job, output.name)}>{text.load(text.outputs[output.name]!)}</Button>)}
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
