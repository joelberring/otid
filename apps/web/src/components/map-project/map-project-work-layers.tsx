"use client";

import { useMemo, useState } from "react";
import { mapProjectSymbolLayersEn } from "../../i18n/map-project-more-en";
import { mapProjectWorkLayersEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import { MAP_PROJECT_SKETCH_COLORS } from "@o-tid/contracts";
import { mapProjectWorkLayersSv } from "../../i18n/map-project-work-layers-sv";
import { mapProjectSymbolLayersSv } from "../../i18n/map-project-symbol-layers-sv";
import { normalCode, withWorkFlag, type LayerFlags, type LayerState } from "../../lib/map-project-layer-model";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { Button } from "../ui";
import { SymbolIcon } from "./map-project-symbol-icon";
import type { useMapProjectWorkLayers } from "./use-map-project-work-layers";
import styles from "./map-project-editor.module.css";

type Work = ReturnType<typeof useMapProjectWorkLayers>;

/**
 * Ägaren 2026-11-09, lagren fas 2: arbetslagren (egna grupper av normens symboler, med samma tänd, släck, lås och tona som
 * huvudlagren) och skisslagren (skisser som inte hör till kartan) under huvudlagren.
 */
export function MapProjectWorkLayers({ work, catalog, state, onState }: {
  work: Work; catalog: readonly CatalogSymbol[]; state: LayerState; onState: (state: LayerState) => void;
}) {
  const text = useTexts(mapProjectWorkLayersSv, mapProjectWorkLayersEn);
  const [name, setName] = useState("");
  const [codes, setCodes] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [sketchName, setSketchName] = useState("");
  const [color, setColor] = useState<string>(MAP_PROJECT_SKETCH_COLORS[0]);
  const choices = useMemo(() => {
    const seen = new Set<string>();
    const query = filter.trim().toLowerCase();
    return catalog.filter(symbol => symbol.kind !== "text" && normalCode(symbol.code) && !seen.has(normalCode(symbol.code)) && seen.add(normalCode(symbol.code))
      && (!query || `${symbol.code} ${symbol.name}`.toLowerCase().includes(query)));
  }, [catalog, filter]);
  const flags = (layerId: string): Required<LayerFlags> => {
    const own = state.work?.[layerId] ?? {};
    return { hidden: own.hidden ?? false, locked: own.locked ?? false, dimmed: own.dimmed ?? false };
  };
  const flag = (layerId: string, key: keyof LayerFlags, value: boolean) => onState(withWorkFlag(state, layerId, key, value));
  const symbolsOf = (layerCodes: readonly string[]) => catalog.filter(symbol => layerCodes.includes(normalCode(symbol.code)));
  const workLayers = work.layers.filter(layer => layer.kind === "SYMBOLS");
  const sketchLayers = work.layers.filter(layer => layer.kind === "SKETCH");

  return <div data-testid="map-project-work-layers">
    <h3>{text.workHeading}</h3>
    <p className={styles.muted}>{text.workHelp}</p>
    {workLayers.length === 0 ? <p className={styles.muted}>{text.workNone}</p> : <ul className={styles.layerList}>
      {workLayers.map(layer => <li key={layer.layerId} data-testid="map-project-work-layer" data-name={layer.name}>
        <details>
          <summary><span className={styles.layerName}>{layer.name}</span> <small className={styles.muted}>{text.symbols(layer.codes.length)}</small></summary>
          <ul className={styles.layerSymbols}>
            {symbolsOf(layer.codes).map(symbol => <li key={symbol.id}>
              <SymbolIcon icon={symbol.icon} size={24} />
              <span className={styles.layerSymbolName}><strong>{symbol.code}</strong> {symbol.name}</span>
              <small className={styles.muted}>{symbol.count}</small>
            </li>)}
          </ul>
          {work.canManage(layer) && <Button variant="quiet" onClick={() => { if (window.confirm(text.removeWork(layer.name))) void work.removeLayer(layer.layerId); }}>
            {text.remove}</Button>}
        </details>
        <Toggles flags={flags(layer.layerId)} name={layer.name} onFlag={(key, value) => flag(layer.layerId, key, value)} />
      </li>)}
    </ul>}
    {work.canWrite && <details className={styles.settings} data-testid="map-project-work-new">
      <summary>{text.newWork}</summary>
      <label>{text.name}<input value={name} maxLength={80} onChange={event => setName(event.target.value)} data-testid="map-project-work-name" /></label>
      <label>{text.filter}<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <fieldset className={styles.fieldset}>
        <legend>{text.pick} ({codes.size})</legend>
        <div className={styles.workPick}>
          {choices.map(symbol => { const code = normalCode(symbol.code); return <label key={symbol.id} className={styles.check}>
            <input type="checkbox" checked={codes.has(code)} onChange={event => setCodes(current => {
              const next = new Set(current);
              if (event.target.checked) next.add(code); else next.delete(code);
              return next;
            })} />{code} {symbol.name}</label>; })}
        </div>
      </fieldset>
      <span className={styles.actions}>
        <Button disabled={!name.trim() || codes.size === 0} data-testid="map-project-work-create" onClick={() => void work.createLayer("SYMBOLS", name.trim(), [...codes])
          .then(layer => { if (layer) { setName(""); setCodes(new Set()); setFilter(""); } })}>{text.create}</Button>
      </span>
    </details>}

    <h3>{text.sketchHeading}</h3>
    <p className={styles.muted}>{text.sketchHelp}</p>
    {sketchLayers.length === 0 ? <p className={styles.muted}>{text.sketchNone}</p> : <ul className={styles.layerList}>
      {sketchLayers.map(layer => <li key={layer.layerId} data-testid="map-project-sketch-layer" data-name={layer.name}>
        <span className={styles.layerName}><span className={styles.swatch} style={{ background: layer.color }} aria-hidden="true" />{layer.name}{" "}
          <small className={styles.muted}>{text.sketches(work.counts.get(layer.layerId) ?? 0)}</small></span>
        <span className={styles.actions}>
          {work.canWrite && <Button variant={work.drawing === layer.layerId ? "primary" : "secondary"} aria-pressed={work.drawing === layer.layerId}
            aria-label={text.drawIn(layer.name)} data-testid="map-project-sketch-draw"
            onClick={() => work.drawing === layer.layerId ? work.stop() : work.start(layer.layerId)}>
            {work.drawing === layer.layerId ? text.drawing : text.draw}</Button>}
          {work.canManage(layer) && <Button variant="quiet" onClick={() => {
            if (window.confirm(text.removeSketchLayer(layer.name, work.counts.get(layer.layerId) ?? 0))) void work.removeLayer(layer.layerId);
          }}>{text.remove}</Button>}
        </span>
        <Toggles flags={flags(layer.layerId)} name={layer.name} onFlag={(key, value) => flag(layer.layerId, key, value)} sketch />
      </li>)}
    </ul>}
    {work.canWrite && <details className={styles.settings} data-testid="map-project-sketch-new">
      <summary>{text.newSketch}</summary>
      <label>{text.name}<input value={sketchName} maxLength={80} onChange={event => setSketchName(event.target.value)} data-testid="map-project-sketch-name" /></label>
      <label>{text.color}<select value={color} onChange={event => setColor(event.target.value)}>
        {MAP_PROJECT_SKETCH_COLORS.map(value => <option key={value} value={value}>{text.colors[value]}</option>)}
      </select></label>
      <span className={styles.actions}>
        <Button disabled={!sketchName.trim()} data-testid="map-project-sketch-create" onClick={() => void work.createLayer("SKETCH", sketchName.trim(), [], color)
          .then(layer => { if (layer) { setSketchName(""); work.start(layer.layerId); } })}>{text.create}</Button>
      </span>
    </details>}
    {work.problem !== undefined && <p role="alert" className={styles.problem}>{text.problem(work.problem)}{" "}
      <Button variant="quiet" onClick={() => work.setProblem(undefined)}>OK</Button></p>}
  </div>;
}

/** Tänd, släck, lås och tona (skisslager: tänd och tona). */
function Toggles({ flags, onFlag, name, sketch = false }: { flags: Required<LayerFlags>; onFlag: (flag: keyof LayerFlags, value: boolean) => void; name: string;
  sketch?: boolean }) {
  const layerText = useTexts(mapProjectSymbolLayersSv, mapProjectSymbolLayersEn);
  return <span className={styles.layerToggles}>
    <button type="button" aria-pressed={!flags.hidden} aria-label={flags.hidden ? layerText.show(name) : layerText.hide(name)}
      onClick={() => onFlag("hidden", !flags.hidden)} data-testid="map-project-layer-visible">{flags.hidden ? layerText.hiddenMark : layerText.visibleMark}</button>
    {!sketch && <button type="button" aria-pressed={flags.locked} aria-label={flags.locked ? layerText.unlock(name) : layerText.lock(name)}
      onClick={() => onFlag("locked", !flags.locked)} data-testid="map-project-layer-lock">{flags.locked ? layerText.lockedMark : layerText.openMark}</button>}
    <button type="button" aria-pressed={flags.dimmed} disabled={(!sketch && !flags.locked) || flags.hidden} aria-label={layerText.dim(name)}
      onClick={() => onFlag("dimmed", !flags.dimmed)} data-testid="map-project-layer-dim">{layerText.dimMark}</button>
  </span>;
}
