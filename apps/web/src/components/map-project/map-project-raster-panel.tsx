"use client";

import { mapPointToProjected, type MapGeoreference } from "@o-tid/map-file";
import type { SourceData } from "@o-tid/map-revision";
import type { Affine } from "../../lib/map-project-layers";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { mapSavedChoiceEn } from "../../i18n/map-knolls-en";
import { mapSavedChoiceSv } from "../../i18n/map-knolls-sv";
import type { PhotoPixels } from "@o-tid/map-revision/base-map";
import { choicePixels, rasterChoices } from "../../lib/map-project-raster-mosaic";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import type { useMapProjectLayers } from "./use-map-project-layers";
import styles from "./map-project-editor.module.css";

export interface RasterPanelTexts {
  readonly heading: string; readonly help: string; readonly none: string; readonly layer: string; readonly run: string;
  readonly name: (layer: string) => string; readonly nothing: string; readonly failed: string;
  /** Egen text för mängden (annars de gemensamma, där 5 är förvalet). */
  readonly amount?: ((level: number) => string) | undefined; readonly amountHelp?: string | undefined;
}

/**
 * Ägaren 2026-11-11 («dra i» lagren, «itereringar … efter första körning»): ett underlag från laserkörningen (bilden med
 * fuktdjupet eller vegetationens klasser) läses i webbläsaren och gränserna dras med reglage. Efter första «Visa som
 * kandidater» räknas kandidaterna om en kort stund efter att ett reglage flyttats. `compute` ger kandidaterna och ett besked.
 */
export function MapProjectRasterPanel<S>({ layers, georeference, importer, match, own, text, testId, initial, initialLevel = 5, controls, compute, atLevel, extras, refreshKey, onOpen }: {
  /** Inställningarna för en mängd på skalan 1–10 (5 = förvalen, ägaren 2026-11-12); `current` är det som är finjusterat. */
  atLevel: (level: number, current: S) => S;
  layers: ReturnType<typeof useMapProjectLayers>; georeference: MapGeoreference; importer: ReturnType<typeof useMapProjectImport>;
  /** Lagren som panelen ger: de byts i det som visas, resten står kvar. */
  match: RegExp; own: RegExp; text: RasterPanelTexts; testId: string; initial: S;
  /** Mängden som är vald från början (5 om inget annat anges) och finjusteringen (utelämnad = bara mängden). */
  initialLevel?: number;
  controls?: ((settings: S, change: (patch: Partial<S>) => void) => ReactNode) | undefined;
  /** Egna rader efter mängdens hjälptext, och ett värde som räknar om ytorna (när det byts) efter första körningen. */
  extras?: ReactNode; refreshKey?: unknown;
  /** Panelen fälls ut (ägaren 2026-11-14: det panelen behöver hämtas först då, inte när sidan öppnas). */
  onOpen?: (() => void) | undefined;
  compute: (pixels: PhotoPixels, settings: S, toSource: (column: number, row: number) => [number, number], crs: number, cellMeters: number)
    => { data: SourceData; message: string };
}) {
  const [chosen, setChosen] = useState("");
  const [settings, setSettings] = useState<S>(initial);
  const [level, setLevel] = useState(initialLevel);
  const shared = useTexts(mapSavedChoiceSv, mapSavedChoiceEn);
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();
  const pixels = useRef<{ key: string; data: ImageData; toMap: Affine } | undefined>(undefined);
  // En körning i etapper visas som en helhet (förvald), så att reglagen räknar hela kartan på en gång.
  const choices = rasterChoices(layers.loaded.map(drawn => ({ drawn, layerId: drawn.layerId, name: layers.layers.find(row => row.layerId === drawn.layerId)?.name ?? drawn.layerId }))
    .filter(row => match.test(row.name)));
  const current = choices.find(choice => choice.id === chosen) ?? choices[0];
  const crs = georeference.crs.kind === "EPSG" ? georeference.crs.code : undefined;

  // De inställningar som senast räknats: att slå på omräkningen ska inte räkna samma sak en gång till (och då ersätta en
  // annan inläsning som gjorts under tiden).
  const ran = useRef<S | undefined>(undefined), ranKey = useRef(refreshKey);
  function run(next: S) {
    ran.current = next; ranKey.current = refreshKey;
    if (!current || crs === undefined) return;
    try {
      const key = `${current.id}:${current.members.map(member => member.layerId).join(",")}`;
      if (pixels.current?.key !== key) {
        const read = choicePixels(current.members.map(member => member.drawn));
        if (!read) { setMessage({ tone: "error", text: text.failed }); return; }
        pixels.current = { key, ...read };
      }
      const { toMap } = pixels.current;
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
    if (!live || (ran.current === settings && ranKey.current === refreshKey)) return;
    const timer = setTimeout(() => latest.current(settings), 250);
    return () => clearTimeout(timer);
  }, [live, settings, refreshKey]);

  if (!importer.canImport || crs === undefined) return null;
  const change = (patch: Partial<S>) => setSettings(previous => ({ ...previous, ...patch }));
  return <details className={styles.settings} data-testid={testId} onToggle={event => { if (event.currentTarget.open) onOpen?.(); }}>
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {!current ? <p className={styles.muted}>{text.none}</p> : <>
      <label>{text.layer}<select value={current.id} onChange={event => { setChosen(event.target.value); setLive(false); }}>
        {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.members.length > 1 ? shared.allStages(choice.name, choice.members.length) : choice.name}</option>)}
      </select></label>
      <label>{(text.amount ?? shared.amount)(level)}
        <input type="range" min={1} max={10} step={1} value={level} data-testid={`${testId}-amount`}
          onChange={event => { const next = Number(event.target.value); setLevel(next); setSettings(previous => atLevel(next, previous)); }} /></label>
      <p className={styles.muted}>{text.amountHelp ?? shared.amountHelp}</p>
      {extras}
      {controls && <details><summary>{shared.fine}</summary>{controls(settings, change)}</details>}
      <span className={styles.actions}><Button variant="secondary" onClick={() => { setLive(true); run(settings); }} data-testid={`${testId}-run`}>{text.run}</Button></span>
    </>}
    {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? styles.problem : undefined}
      data-testid={`${testId}-message`}>{message.text}</p>}
  </details>;
}
