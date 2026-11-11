"use client";

import { mapPointToProjected, type MapGeoreference } from "@o-tid/map-file";
import { useEffect, useRef, useState } from "react";
import { mapSourcesEn } from "../../i18n/map-sources-en";
import { mapSourcesSv } from "../../i18n/map-sources-sv";
import { DEFAULT_DEPTH, depthCandidates, type DepthSettings } from "../../lib/map-project-moisture-depth";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

const decimal = (value: number) => String(Math.round(value * 100) / 100).replace(".", ",");

/**
 * Ägaren 2026-11-11 («bra att kunna dra i markfuktighetslagren»): laserkörningens fuktdjup (underlaget som slutar på
 * «fuktdjup») läses i webbläsaren, och gränserna för blött och fuktigt dras med reglage. Efter första «Visa som kandidater»
 * räknas kandidaterna om direkt när ett reglage flyttas.
 */
export function MapProjectDepthPanel({ layers, georeference, importer }: { layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference;
  importer: ReturnType<typeof useMapProjectImport> }) {
  const text = useTexts(mapSourcesSv.depth, mapSourcesEn.depth);
  const [chosen, setChosen] = useState("");
  const [settings, setSettings] = useState<DepthSettings>(DEFAULT_DEPTH);
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const pixels = useRef<{ layerId: string; data: ImageData } | undefined>(undefined);
  const shown = layers.drawn.map(drawn => ({ drawn, name: layers.layers.find(row => row.layerId === drawn.layerId)?.name ?? drawn.layerId }))
    .filter(row => /fuktdjup$/.test(row.name));
  const current = shown.find(row => row.drawn.layerId === chosen) ?? shown[0];
  const crs = georeference.crs.kind === "EPSG" ? georeference.crs.code : undefined;

  function run(next: DepthSettings) {
    if (!current || crs === undefined) return;
    try {
      const { image, toMap } = current.drawn;
      if (pixels.current?.layerId !== current.drawn.layerId) {
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
        if (!context) { setMessage({ tone: "error", text: text.failed }); return; }
        context.drawImage(image, 0, 0);
        pixels.current = { layerId: current.drawn.layerId, data: context.getImageData(0, 0, image.width, image.height) };
      }
      const cellMeters = Math.hypot(toMap.a, toMap.d) * georeference.scale / 1000;
      const result = depthCandidates(pixels.current.data, next, (column, row) => {
        const at = mapPointToProjected(georeference, { x: toMap.a * column + toMap.b * row + toMap.c, y: toMap.d * column + toMap.e * row + toMap.f });
        return [at.easting, at.northing];
      }, crs, cellMeters);
      if (result.data.features.length === 0) { setMessage({ tone: "error", text: text.nothing }); return; }
      importer.openData(text.name(current.name), result.data);
      setMessage({ tone: "ok", text: text.done(decimal(result.wetHa), decimal(result.moistHa)) });
    } catch (error) {
      console.error("Fuktdjupet kunde inte läsas", error);
      setMessage({ tone: "error", text: text.failed });
    }
  }

  // Reglagen räknar om kandidaterna en kort stund efter att de släppts.
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!live) return;
    const timer = setTimeout(() => latest.current(settings), 250);
    return () => clearTimeout(timer);
  }, [live, settings]);

  if (!importer.canImport || crs === undefined) return null;
  const change = (patch: Partial<DepthSettings>) => setSettings(current => {
    const next = { ...current, ...patch };
    return { ...next, moistMeters: Math.max(next.moistMeters, next.wetMeters + 0.1) };
  });
  return <details className={styles.settings} data-testid="map-project-depth">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {!current ? <p className={styles.muted}>{text.none}</p> : <>
      <label>{text.layer}<select value={current.drawn.layerId} onChange={event => { setChosen(event.target.value); setLive(false); }}>
        {shown.map(row => <option key={row.drawn.layerId} value={row.drawn.layerId}>{row.name}</option>)}
      </select></label>
      <label>{text.wet(decimal(settings.wetMeters))}<input type="range" min={0.1} max={2} step={0.05} value={settings.wetMeters}
        onChange={event => change({ wetMeters: Number(event.target.value) })} data-testid="map-project-depth-wet" /></label>
      <label>{text.moist(decimal(settings.moistMeters))}<input type="range" min={0.2} max={3} step={0.05} value={settings.moistMeters}
        onChange={event => change({ moistMeters: Number(event.target.value) })} data-testid="map-project-depth-moist" /></label>
      <label>{text.minArea(settings.minAreaM2)}<input type="range" min={100} max={2000} step={50} value={settings.minAreaM2}
        onChange={event => change({ minAreaM2: Number(event.target.value) })} /></label>
      <span className={styles.actions}><Button variant="secondary" onClick={() => { setLive(true); run(settings); }} data-testid="map-project-depth-run">{text.run}</Button></span>
    </>}
    {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? styles.problem : undefined}
      data-testid="map-project-depth-message">{message.text}</p>}
  </details>;
}
