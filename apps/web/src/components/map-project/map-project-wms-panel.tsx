"use client";

import { useEffect, useState } from "react";
import type { MapProjectView, MapProjectWmsCapabilitiesResponse } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { GOTHENBURG_WMS, mapWmsSv } from "../../i18n/map-wms-sv";
import { mapWmsEn } from "../../i18n/map-wms-en";
import { csrf } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import { areaBox, type BoxArea } from "../../lib/map-project-area-box";
import { mapProjectBase } from "../../lib/map-project-client";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

type Area = BoxArea & { areaId: string };
const STORAGE_URL = "otid.wms.url", STORAGE_LAYER = "otid.wms.layer";
const RESOLUTIONS = ["0.25", "0.5", "1", "2"] as const;
const remembered = (key: string) => { try { return window.localStorage.getItem(key) ?? ""; } catch { return ""; } };
const remember = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* Kommer inte ihåg; inget fel. */ } };

const hostOf = (address: string) => { try { return new URL(address).hostname; } catch { return ""; } };

/**
 * Ortofoto från en öppen WMS-tjänst (t.ex. en kommuns) för kartan eller en etapp. Servern läser lagren och hämtar bildrutorna
 * (en per anrop, högst 16); varje ruta läggs som ett vanligt underlag med världsfil och kan tolkas med «Tolka flygbild».
 * Tillskrivningen (förvalet eller tjänstens titel) står i underlagets namn.
 */
export function MapProjectWmsPanel({ view, layers, georeference, bounds, areas }: { view: MapProjectView;
  layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference | undefined; bounds: Bounds | undefined; areas: readonly Area[] }) {
  const text = useTexts(mapWmsSv, mapWmsEn);
  const [url, setUrl] = useState(GOTHENBURG_WMS);
  const [capabilities, setCapabilities] = useState<MapProjectWmsCapabilitiesResponse>();
  const [layer, setLayer] = useState("");
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>("0.5");
  const [where, setWhere] = useState("");
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  // Senast använda adress och lager (per webbläsare); läses först efter första ritningen.
  useEffect(() => { setUrl(remembered(STORAGE_URL) || GOTHENBURG_WMS); }, []);
  if (!layers.canAdd || !georeference || !bounds) return null;
  const area = areas.find(row => row.areaId === where);
  const mapEpsg = georeference.crs.kind === "EPSG" ? georeference.crs.code : undefined;
  const base = `${mapProjectBase(view.projectId)}/sources/wms`;
  const usable = capabilities?.layers.filter(row => row.epsg !== null) ?? [];
  const attribution = text.attribution(url === GOTHENBURG_WMS ? text.presetAttribution : capabilities?.title || hostOf(url));

  async function post(path: string, body: unknown): Promise<Response | { error: string }> {
    const token = csrf();
    const response = await fetch(`${base}/${path}`, { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json", ...(token ? { "x-otid-csrf": token } : {}) }, body: JSON.stringify(body) }).catch(() => undefined);
    if (response?.ok) return response;
    const failed = await response?.json().catch(() => undefined) as { error?: string } | undefined;
    const problems = text.problems as unknown as Record<string, string>;
    return { error: failed?.error && failed.error in problems ? problems[failed.error]! : text.problems.generic(response?.status ?? 0) };
  }

  async function read() {
    setBusy(text.reading); setMessage(undefined); setCapabilities(undefined);
    try {
      const response = await post("capabilities", { formatVersion: 1, url: url.trim(), ...(mapEpsg ? { mapEpsg } : {}) });
      if ("error" in response) { setMessage({ tone: "error", text: response.error }); return; }
      const found = await response.json() as MapProjectWmsCapabilitiesResponse;
      setCapabilities(found); remember(STORAGE_URL, url.trim());
      const choices = found.layers.filter(row => row.epsg !== null);
      setLayer(choices.find(row => row.name === remembered(STORAGE_LAYER))?.name ?? choices[0]?.name ?? "");
    } finally { setBusy(undefined); }
  }

  async function fetchImages() {
    const chosen = capabilities?.layers.find(row => row.name === layer);
    if (!chosen) return;
    setMessage(undefined);
    let added = 0, total = 1;
    try {
      for (let tile = 0; tile < total; tile += 1) {
        setBusy(text.fetching(tile + 1, total));
        const response = await post("image", { formatVersion: 1, url: url.trim(), layer, metersPerPixel: Number(resolution), box: areaBox(bounds!, georeference!, area).wgs84,
          tile, ...(mapEpsg ? { mapEpsg } : {}) });
        if ("error" in response) { setMessage({ tone: "error", text: `${added > 0 ? `${text.failedAfter(added)} ` : ""}${response.error}` }); return; }
        total = Number(response.headers.get("x-otid-tiles") ?? 1) || 1;
        const jpeg = (response.headers.get("content-type") ?? "").includes("jpeg");
        const world = decodeURIComponent(response.headers.get("x-otid-world") ?? "");
        const files = [new File([await response.blob()], jpeg ? "ortofoto.jpg" : "ortofoto.png", { type: jpeg ? "image/jpeg" : "image/png" }),
          new File([world], jpeg ? "ortofoto.jgw" : "ortofoto.pgw", { type: "text/plain" })];
        const name = text.name(chosen.title, area?.name, total > 1 ? `(${tile + 1}/${total})` : undefined, attribution);
        if (!await layers.upload(files, name, Number(response.headers.get("x-otid-crs") ?? 3006))) return;
        added += 1;
      }
      remember(STORAGE_LAYER, layer);
      setMessage({ tone: "ok", text: text.added(added) });
    } finally { setBusy(undefined); }
  }

  return <details className={styles.settings} data-testid="map-project-wms">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    <label>{text.preset}<select value={url === GOTHENBURG_WMS ? "goteborg" : ""} onChange={event => { setUrl(event.target.value === "goteborg" ? GOTHENBURG_WMS : ""); setCapabilities(undefined); }}>
      <option value="">{text.custom}</option>
      <option value="goteborg">{text.presets.goteborg}</option>
    </select></label>
    <label>{text.url}<input type="url" value={url} maxLength={500} onChange={event => { setUrl(event.target.value); setCapabilities(undefined); }} data-testid="map-project-wms-url" /></label>
    <span className={styles.actions}>
      <Button variant="secondary" disabled={!!busy || !url.trim()} onClick={() => void read()} data-testid="map-project-wms-read">{text.readLayers}</Button>
    </span>
    {capabilities && usable.length === 0 && <p className={styles.problem} role="alert">{text.noSweref}</p>}
    {capabilities && usable.length > 0 && <>
      <label>{text.layer}<select value={layer} onChange={event => setLayer(event.target.value)} data-testid="map-project-wms-layer">
        {usable.map(row => <option key={row.name} value={row.name}>{row.title}</option>)}
      </select></label>
      <label>{text.resolution}<select value={resolution} onChange={event => setResolution(event.target.value as typeof resolution)}>
        {RESOLUTIONS.map(value => <option key={value} value={value}>{text.resolutions[value]}</option>)}
      </select></label>
      <label>{text.where}<select value={where} onChange={event => setWhere(event.target.value)}>
        <option value="">{text.whole}</option>
        {areas.map(row => <option key={row.areaId} value={row.areaId}>{row.name}</option>)}
      </select></label>
      <span className={styles.actions}>
        <Button variant="secondary" disabled={!!busy || !layer} onClick={() => void fetchImages()} data-testid="map-project-wms-fetch">{text.fetch}</Button>
      </span>
    </>}
    {busy && <p role="status" className={styles.muted}>{busy}</p>}
    {message && <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? styles.muted : styles.problem}
      data-testid="map-project-wms-message">{message.text}</p>}
    <p className={styles.muted}>{attribution}. {text.responsibility}</p>
  </details>;
}
