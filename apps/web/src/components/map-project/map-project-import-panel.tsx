"use client";

import { useRef, useState } from "react";
import { mapProjectImportEn } from "../../i18n/map-project-tools-en";
import { useLocale, useTexts } from "../language-provider";
import type { Point } from "@o-tid/map-file";
import { mapProjectImportSv } from "../../i18n/map-project-import-sv";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import styles from "./map-project-editor.module.css";

type Import = ReturnType<typeof useMapProjectImport>;

/**
 * ADR-0219 tillägget om vektorunderlagen (K4b): importen i sidopanelen. Fil, koordinatsystem, ett val per lager (symbolerna
 * med samma form först, slutna linjer kan bli ytor) och knappen som lämnar kandidaterna som förslag.
 */
export function MapProjectImportPanel({ importer, symbols, areas }: { importer: Import; symbols: ReadonlyMap<string, CatalogSymbol>;
  areas: readonly { areaId: string; name: string; polygon: readonly (readonly Point[])[] }[] }) {
  const text = useTexts(mapProjectImportSv, mapProjectImportEn);
  const input = useRef<HTMLInputElement>(null);
  const [where, setWhere] = useState("");
  const { file, result, problem } = importer;
  const all = [...symbols.values()].filter(symbol => symbol.kind !== "text");
  const problemText = problem === undefined ? undefined : typeof problem === "number" ? text.problems.generic(problem)
    : problem in text.problems ? (text.problems as unknown as Record<string, string>)[problem] : problem;

  return <details className={styles.settings} data-testid="map-project-import">
    <summary>{text.heading}</summary>
    <p className={styles.muted}>{text.help}</p>
    {problemText && <p role="alert" className={styles.problem}>{problemText}{" "}
      <Button variant="quiet" onClick={() => importer.setProblem(undefined)}>OK</Button></p>}
    {importer.sent !== undefined && <p role="status" data-testid="map-project-import-sent">{text.sent(importer.sent)}</p>}
    {importer.accepted !== undefined && <p role="status" data-testid="map-project-import-accepted">{text.accepted(importer.accepted)}</p>}
    {importer.dwgSent && <p role="status" data-testid="map-project-import-dwg">{text.dwgSent(importer.dwgSent)}</p>}
    {!file ? <>
      <span className={styles.actions}>
        <Button variant="secondary" onClick={() => input.current?.click()}>{text.choose}</Button>
        <input ref={input} type="file" hidden multiple accept=".geojson,.json,.dxf,.dwg,.shp,.dbf,.prj,.cpg,.zip,application/geo+json,application/zip"
          data-testid="map-project-import-file"
          onChange={event => { const chosen = [...event.target.files ?? []]; event.target.value = ""; if (chosen.length) void importer.open(chosen); }} />
      </span>
      <fieldset className={styles.areaForm} data-testid="map-project-osm">
        <legend>{text.osmHeading}</legend>
        <p className={styles.muted}>{text.osmHelp}</p>
        <label>{text.osmWhere}<select value={where} onChange={event => setWhere(event.target.value)} data-testid="map-project-osm-area">
          <option value="">{text.osmWhole}</option>
          {areas.map(area => <option key={area.areaId} value={area.areaId}>{area.name}</option>)}
        </select></label>
        <span className={styles.actions}>
          <Button variant="secondary" disabled={importer.fetching} data-testid="map-project-osm-fetch"
            onClick={() => void importer.fetchOsm(areas.find(area => area.areaId === where))}>
            {importer.fetching ? text.osmFetching : text.osmFetch}</Button>
        </span>
      </fieldset>
    </> : <form className={styles.areaForm} onSubmit={event => { event.preventDefault(); void importer.propose(); }}>
      <p className={styles.muted}>{text.file(file.name, file.data.features.length, file.data.skipped)}</p>
      <label>{text.crs}<input inputMode="numeric" value={importer.crs ?? ""} data-testid="map-project-import-crs"
        onChange={event => { const value = Number(event.target.value.replace(/\D/g, "")); importer.setCrs(value > 0 ? value : undefined); }} /></label>
      <p className={styles.muted}>{text.crsHelp}</p>
      <FitControl importer={importer} />
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
      {importer.profile && <p className={styles.muted} data-testid="map-project-import-profile">
        {text.profileUsed(importer.profile.name, importer.profile.matched, importer.profile.layers)}</p>}
      <ProfileForm importer={importer} />
      {result && <p className={styles.muted} data-testid="map-project-import-result" role="status">
        {text.result(result.objects.length, result.joined, result.duplicates, result.short, result.outside, result.mismatched, result.clipped, result.closedAreas, result.stairs, result.steps)}</p>}
      {!result && importer.crs !== undefined && <p role="alert" className={styles.problem}>{text.problems.crs}</p>}
      {result && result.objects.length > 0 && <p className={styles.muted}>{importer.canAccept ? text.acceptHelp : text.shownHelp}</p>}
      <span className={styles.actions}>
        {importer.canAccept && <Button disabled={!result || result.objects.length === 0 || !!importer.progress} onClick={importer.accept}
          data-testid="map-project-import-accept">{text.accept(result?.objects.length ?? 0)}</Button>}
        <Button type="submit" variant={importer.canAccept ? "secondary" : "primary"} disabled={!result || result.objects.length === 0 || !!importer.progress} data-testid="map-project-import-propose">
          {importer.progress ? text.sending(importer.progress.done, importer.progress.total) : text.propose(result?.objects.length ?? 0)}</Button>
        {result && result.objects.length > 0 && <Button variant="quiet" aria-pressed={importer.hideOnMap} onClick={() => importer.setHideOnMap(!importer.hideOnMap)}
          data-testid="map-project-import-hide">{importer.hideOnMap ? text.showOnMap : text.hideOnMap}</Button>}
        <Button variant="quiet" onClick={importer.cancel}>{text.cancel}</Button>
      </span>
    </form>}
  </details>;
}

/**
 * Ägaren 2026-11-10: "Passa in mot kartan" när underlaget hamnar nästan rätt. Kräver att lager har fått hus, vägar, vatten,
 * murar eller järnväg; visar förskjutning, vridning, skala och hur väl det passar, och kan tas bort igen.
 */
function FitControl({ importer }: { importer: Import }) {
  const text = useTexts(mapProjectImportSv, mapProjectImportEn);
  const locale = useLocale();
  const { fit } = importer;
  if (!importer.canFit) return null;
  const number = (value: number, digits: number) => value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return <div data-testid="map-project-import-fit">
    <span className={styles.actions}>
      <Button variant="secondary" disabled={fit === "running" || importer.crs === undefined} onClick={importer.fitToMap}>
        {fit === "running" ? text.fitting : text.fit}</Button>
      {fit && fit !== "running" && <Button variant="quiet" onClick={importer.clearFit}>{text.fitClear}</Button>}
    </span>
    <p className={styles.muted} role="status">{fit === undefined ? text.fitHelp : fit === "running" ? text.fitting
      : fit === null ? text.fitFailed
      : text.fitted(number(Math.hypot(fit.dx, fit.dy) * importer.metersPerMm, 1), number(fit.rotation, 2), number(fit.scale, 4),
        number(fit.medianMm * importer.metersPerMm, 1), Math.round(fit.share * 100))}</p>
  </div>;
}

/** K6b: spara lagrens val som en profil (för kontot eller delad med projektets klubb). */
function ProfileForm({ importer }: { importer: Import }) {
  const text = useTexts(mapProjectImportSv, mapProjectImportEn);
  const [name, setName] = useState("");
  const [share, setShare] = useState(false);
  const [saved, setSaved] = useState(false);
  return <fieldset className={styles.importLayers} data-testid="map-project-import-save-profile">
    <legend>{text.profileHeading}</legend>
    <label>{text.profileName}<input value={name} maxLength={80} onChange={event => { setName(event.target.value); setSaved(false); }}
      data-testid="map-project-import-profile-name" /></label>
    {importer.canShareProfile && <label className={styles.check}><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)} />
      {text.profileShare}</label>}
    <span className={styles.actions}>
      <Button variant="secondary" disabled={!name.trim() || importer.mapping.size === 0} data-testid="map-project-import-profile-save"
        onClick={() => void importer.saveProfile(name, share).then(setSaved)}>{text.profileSave}</Button>
    </span>
    {saved && <p role="status" className={styles.muted}>{text.profileSaved}</p>}
  </fieldset>;
}
