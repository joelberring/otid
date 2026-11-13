"use client";

import { mapPointToProjected, type MapGeoreference } from "@o-tid/map-file";
import type { SourceData } from "@o-tid/map-revision";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { mapSavedChoiceEn } from "../../i18n/map-knolls-en";
import { mapSavedChoiceSv } from "../../i18n/map-knolls-sv";
import type { PhotoPixels } from "@o-tid/map-revision/base-map";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

export interface RasterPanelTexts {
  readonly heading: string; readonly help: string; readonly none: string; readonly layer: string; readonly run: string;
  readonly name: (layer: string) => string; readonly nothing: string; readonly failed: string;
}

/**
 * Ägaren 2026-11-11 («dra i» lagren, «itereringar … efter första körning»): ett underlag från laserkörningen (bilden med
 * fuktdjupet eller vegetationens klasser) läses i webbläsaren och gränserna dras med reglage. Efter första «Visa som
 * kandidater» räknas kandidaterna om en kort stund efter att ett reglage flyttats. `compute` ger kandidaterna och ett besked.
 */
export function MapProjectRasterPanel<S>({ layers, georeference, importer, match, own, text, testId, initial, controls, compute, atLevel }: {
  /** Inställningarna för en mängd på skalan 1–10 (5 = förvalen, ägaren 2026-11-12); `current` är det som är finjusterat. */
  atLevel: (level: number, current: S) => S;
  layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference; importer: ReturnType<typeof useMapProjectImport>;
  /** Lagren som panelen ger: de byts i det som visas, resten står kvar. */
  match: RegExp; own: RegExp; text: RasterPanelTexts; testId: string; initial: S;
  controls: (settings: S, change: (patch: Partial<S>) => void) => ReactNode;
  compute: (pixels: PhotoPixels, settings: S, toSource: (column: number, row: number) => [number, number], crs: number, cellMeters: number)
    => { data: SourceData; message: string };
}) {
  const [chosen, setChosen] = useState("");
  const [settings, setSettings] = useState<S>(initial);
  const [level, setLevel] = useState(5);
  const shared = useTexts(mapSavedChoiceSv, mapSavedChoiceEn);
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const pixels = useRef<{ layerId: string; data: ImageData } | undefined>(undefined);
  const shown = layers.loaded.map(drawn => ({ drawn, name: layers.layers.find(row => row.layerId === drawn.layerId)?.name ?? drawn.layerId }))
    .filter(row => match.test(row.name));
  const current = shown.find(row => row.drawn.layerId === chosen) ?? shown[0];
  const crs = georeference.crs.kind === "EPSG" ? georeference.crs.code : undefined;

  // De inställningar som senast räknats: att slå på omräkningen ska inte räkna samma sak en gång till (och då ersätta en
  // annan inläsning som gjorts under tiden).
  const ran = useRef<S | undefined>(undefined);
  function run(next: S) {
    ran.current = next;
    if (!current || crs === undefined) return;
    try {
      const { image, toMap } = current.drawn;
      if (pixels.current?.layerId !== current.drawn.layerId) {
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) { setMessage({ tone: "error", text: text.failed }); return; }
        context.drawImage(image, 0, 0);
        pixels.current = { layerId: current.drawn.layerId, data: context.getImageData(0, 0, image.width, image.height) };
      }
      const cellMeters = Math.hypot(toMap.a, toMap.d) * georeference.scale / 1000;
      const result = compute(pixels.current.data, next, (column, row) => {
        const at = mapPointToProjected(georeference, { x: toMap.a * column + toMap.b * row + toMap.c, y: toMap.d * column + toMap.e * row + toMap.f });
        return [at.easting, at.northing];
      }, crs, cellMeters);
      if (result.data.features.length === 0) { setMessage({ tone: "error", text: text.nothing }); return; }
      importer.refine(text.name(current.name), result.data, own);
      setMessage({ tone: "ok", text: result.message });
    } catch (error) {
      console.error("Underlaget kunde inte läsas", error);
      setMessage({ tone: "error", text: text.failed });
    }
  }

  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!live || ran.current === settings) return;
    const timer = setTimeout(() => latest.current(settings), 250);
    return () => clearTimeout(timer);
  }, [live, settings]);

  if (!importer.canImport || crs === undefined) return null;
  const change = (patch: Partial<S>) => setSettings(previous => ({ ...previous, ...patch }));
  return <details className={styles.settings} data-testid={testId}>
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {!current ? <p className={styles.muted}>{text.none}</p> : <>
      <label>{text.layer}<select value={current.drawn.layerId} onChange={event => { setChosen(event.target.value); setLive(false); }}>
        {shown.map(row => <option key={row.drawn.layerId} value={row.drawn.layerId}>{row.name}</option>)}
      </select></label>
      <label>{shared.amount(level)}
        <input type="range" min={1} max={10} step={1} value={level} data-testid={`${testId}-amount`}
          onChange={event => { const next = Number(event.target.value); setLevel(next); setSettings(previous => atLevel(next, previous)); }} /></label>
      <p className={styles.muted}>{shared.amountHelp}</p>
      <details><summary>{shared.fine}</summary>{controls(settings, change)}</details>
      <span className={styles.actions}><Button variant="secondary" onClick={() => { setLive(true); run(settings); }} data-testid={`${testId}-run`}>{text.run}</Button></span>
    </>}
    {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? styles.problem : undefined}
      data-testid={`${testId}-message`}>{message.text}</p>}
  </details>;
}
