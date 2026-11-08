"use client";

import { useRef } from "react";
import { mapProjectImportSv } from "../../i18n/map-project-import-sv";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import styles from "./map-project-editor.module.css";

const text = mapProjectImportSv;
type Import = ReturnType<typeof useMapProjectImport>;

/**
 * ADR-0219 tillägget om vektorunderlagen (K4b): importen i sidopanelen. Fil, koordinatsystem, ett val per lager (symbolerna
 * med samma form först, slutna linjer kan bli ytor) och knappen som lämnar kandidaterna som förslag.
 */
export function MapProjectImportPanel({ importer, symbols }: { importer: Import; symbols: ReadonlyMap<string, CatalogSymbol> }) {
  const input = useRef<HTMLInputElement>(null);
  const { file, result, problem } = importer;
  const all = [...symbols.values()].filter(symbol => symbol.kind !== "text");
  const problemText = problem === undefined ? undefined : typeof problem === "number" ? text.problems.generic(problem)
    : problem === "unsupported" || problem === "crs" ? text.problems[problem] : problem;

  return <details className={styles.settings} data-testid="map-project-import">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {problemText && <p role="alert" className={styles.problem}>{problemText}{" "}
      <Button variant="quiet" onClick={() => importer.setProblem(undefined)}>OK</Button></p>}
    {importer.sent !== undefined && <p role="status" data-testid="map-project-import-sent">{text.sent(importer.sent)}</p>}
    {!file ? <span className={styles.actions}>
      <Button variant="secondary" onClick={() => input.current?.click()}>{text.choose}</Button>
      <input ref={input} type="file" hidden accept=".geojson,.json,.dxf,application/geo+json" data-testid="map-project-import-file"
        onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ""; if (chosen) void importer.open(chosen); }} />
    </span> : <form className={styles.areaForm} onSubmit={event => { event.preventDefault(); void importer.propose(); }}>
      <p className={styles.muted}>{text.file(file.name, file.data.features.length, file.data.skipped)}</p>
      <label>{text.crs}<input inputMode="numeric" value={importer.crs ?? ""} data-testid="map-project-import-crs"
        onChange={event => { const value = Number(event.target.value.replace(/\D/g, "")); importer.setCrs(value > 0 ? value : undefined); }} /></label>
      <p className={styles.muted}>{text.crsHelp}</p>
      <fieldset className={styles.importLayers}>
        <legend>{text.layers}</legend>
        {importer.layers.map(layer => {
          const shapes = new Set<string>([...(layer.points ? ["point"] : []), ...(layer.lines || layer.closedLines || layer.areas ? ["line"] : []),
            ...(layer.closedLines || layer.areas ? ["area"] : [])]);
          const options = [...all.filter(symbol => shapes.has(symbol.kind)), ...all.filter(symbol => !shapes.has(symbol.kind))];
          return <label key={layer.name} data-testid="map-project-import-layer">
            <span><strong>{layer.name}</strong> <span className={styles.muted}>{text.layerShape(layer.points, layer.lines, layer.closedLines, layer.areas)}</span></span>
            <select value={importer.mapping.get(layer.name) ?? ""} aria-label={text.symbolFor(layer.name)}
              onChange={event => importer.choose(layer.name, event.target.value)}>
              <option value="">{text.skip}</option>
              {options.map(symbol => <option key={symbol.id} value={symbol.id}>{symbol.code} {symbol.name}</option>)}
            </select>
          </label>;
        })}
      </fieldset>
      {result && <p className={styles.muted} data-testid="map-project-import-result" role="status">
        {text.result(result.objects.length, result.joined, result.duplicates, result.short, result.outside, result.mismatched)}</p>}
      {!result && importer.crs !== undefined && <p role="alert" className={styles.problem}>{text.problems.crs}</p>}
      <span className={styles.actions}>
        <Button type="submit" disabled={!result || result.objects.length === 0 || !!importer.progress} data-testid="map-project-import-propose">
          {importer.progress ? text.sending(importer.progress.done, importer.progress.total) : text.propose(result?.objects.length ?? 0)}</Button>
        <Button variant="quiet" onClick={importer.cancel}>{text.cancel}</Button>
      </span>
    </form>}
  </details>;
}
