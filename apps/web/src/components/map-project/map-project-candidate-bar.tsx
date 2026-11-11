"use client";

import { mapProjectImportSv } from "../../i18n/map-project-import-sv";
import { mapProjectImportEn } from "../../i18n/map-project-tools-en";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { useTexts } from "../language-provider";
import { Button } from "../ui";
import type { useMapProjectImport } from "./use-map-project-import";
import styles from "./map-project-candidate-bar.module.css";

/**
 * Ägaren 2026-11-11 («jag förstår inte hur jag ska få in materialet i redigerbara lager», «itereringar … innan de genererade
 * lagren flyttar till de riktiga lagren»): när en inläsning visas som kandidater ligger en rad under kartan med lagren
 * (symbol och antal, var och en går att välja bort) och knapparna för att lägga in dem i kartan, lämna dem som förslag,
 * dölja dem en stund eller avbryta. Samma val finns under Importera vektorer, där symbolerna också går att byta.
 */
export function MapProjectCandidateBar({ importer, symbols, onShowLayers }: { importer: ReturnType<typeof useMapProjectImport>;
  symbols: ReadonlyMap<string, CatalogSymbol>; onShowLayers: () => void }) {
  const text = useTexts(mapProjectImportSv, mapProjectImportEn);
  if (!importer.file) return null;
  const count = importer.result?.objects.length ?? 0;
  const rows = importer.layers.filter(layer => importer.mapping.has(layer.name));
  return <section className={styles.bar} aria-label={text.barLabel} data-testid="map-project-candidate-bar">
    <strong className={styles.title}>{text.barTitle(importer.file.name)}</strong>
    <span className={styles.layers}>
      {rows.map(layer => {
        const symbol = symbols.get(importer.mapping.get(layer.name)!);
        const on = !importer.skipped.has(layer.name);
        return <label key={layer.name} className={styles.layer} data-on={on || undefined} title={layer.name}>
          <input type="checkbox" checked={on} onChange={() => importer.toggleLayer(layer.name)} data-testid="map-project-candidate-layer" />
          {symbol ? `${symbol.code} ${symbol.name}` : layer.name} <small>({layer.count})</small>
        </label>;
      })}
      {importer.layers.length > rows.length && <small className={styles.muted}>{text.barUnmapped(importer.layers.length - rows.length)}</small>}
    </span>
    <span className={styles.actions}>
      {importer.canAccept && <Button disabled={count === 0 || !!importer.progress} onClick={importer.accept} data-testid="map-project-candidate-accept">
        {text.accept(count)}</Button>}
      <Button variant={importer.canAccept ? "secondary" : "primary"} disabled={count === 0 || !!importer.progress} onClick={() => void importer.propose()}
        data-testid="map-project-candidate-propose">{importer.progress ? text.sending(importer.progress.done, importer.progress.total) : text.propose(count)}</Button>
      <Button variant="quiet" aria-pressed={importer.hideOnMap} onClick={() => importer.setHideOnMap(!importer.hideOnMap)}>
        {importer.hideOnMap ? text.showOnMap : text.hideOnMap}</Button>
      <Button variant="quiet" onClick={() => {
        onShowLayers();
        // Panelen Importera vektorer öppnas och visas när fliken Lager har ritats.
        setTimeout(() => {
          const panel = document.querySelector('[data-testid="map-project-import"]');
          if (panel instanceof HTMLDetailsElement) panel.open = true;
          panel?.scrollIntoView({ block: "start" });
        }, 60);
      }}>{text.barSymbols}</Button>
      <Button variant="quiet" onClick={importer.cancel} data-testid="map-project-candidate-cancel">{text.cancel}</Button>
    </span>
  </section>;
}
