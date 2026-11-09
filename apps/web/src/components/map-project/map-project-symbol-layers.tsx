"use client";

import { useMemo, useState, type ReactNode } from "react";
import { mapProjectSymbolLayersEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import { mapProjectSymbolLayersSv } from "../../i18n/map-project-symbol-layers-sv";
import {
  layerRows, mergeSuggestions, normalCode, symbolFlags, withLayerFlag, withSymbolFlag, type LayerFlags, type LayerId, type LayerState, type Standard,
  type WorkLayer
} from "../../lib/map-project-layer-model";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { Button } from "../ui";
import { SymbolIcon } from "./map-project-symbol-icon";
import styles from "./map-project-editor.module.css";

/**
 * Ägaren 2026-11-09: lagren efter normen. Normens grupper med symbolerna som underlager; tänd, släck, lås och visa låsta
 * lager fullt eller nedtonat. Symboler utanför normen (äldre norm, egna, sammanslagna kartor) slås ihop med en symbol i normen
 * med en tydlig förhandsvisning av vad som slås ihop.
 */
export function MapProjectSymbolLayers({ catalog, standard, standardSymbols, state, onState, canEdit, onMerge, merging, message, work = [], workPanel }: {
  catalog: readonly CatalogSymbol[]; standard: Standard; standardSymbols: ReadonlyMap<string, string>;
  state: LayerState; onState: (state: LayerState) => void; canEdit: boolean;
  /** Slå ihop: alla objekt med `from` får symbolen `to`. */
  onMerge: (from: CatalogSymbol, to: CatalogSymbol) => void; merging: string | undefined; message: string | undefined;
  /** Lagren fas 2: arbetslagren (för symbolernas val) och panelen för arbets- och skisslagren. */
  work?: readonly WorkLayer[]; workPanel?: ReactNode;
}) {
  const text = useTexts(mapProjectSymbolLayersSv, mapProjectSymbolLayersEn);
  const rows = useMemo(() => layerRows(catalog, standardSymbols, state), [catalog, standardSymbols, state]);
  const suggestions = useMemo(() => mergeSuggestions(catalog, standardSymbols), [catalog, standardSymbols]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const source = catalog.find(symbol => symbol.id === from);
  const targets = catalog.filter(symbol => source && symbol.id !== source.id && symbol.kind === source.kind);
  const target = targets.find(symbol => symbol.id === to);
  const layerFlag = (id: LayerId, flag: keyof LayerFlags, value: boolean) => onState(withLayerFlag(state, catalog, standardSymbols, id, flag, value));
  const label = (symbol: CatalogSymbol) => `${symbol.code} ${symbol.name}`;

  return <section aria-labelledby="map-project-symbol-layers-title" className={styles.panel} data-testid="map-project-symbol-layers">
    <h2 id="map-project-symbol-layers-title">{text.title}</h2>
    <p className={styles.muted}>{text.help(standard)}</p>
    <ul className={styles.layerList}>
      {rows.map(row => <li key={row.id} data-testid="map-project-layer-row" data-layer={row.id}>
        <details>
          <summary>
            <span className={styles.layerName}>{text.layers[row.id]}</span> <small className={styles.muted}>{text.count(row.count)}</small>
          </summary>
          {row.id === "OUTSIDE" && <p className={styles.muted}>{text.outsideHelp(standard)}</p>}
          <ul className={styles.layerSymbols}>
            {row.symbols.map(symbol => {
              const flags = symbolFlags(symbol, standardSymbols, state, work);
              return <li key={symbol.id} data-testid="map-project-layer-symbol" data-code={symbol.code}>
                <SymbolIcon icon={symbol.icon} size={24} />
                <span className={styles.layerSymbolName} title={label(symbol)}><strong>{symbol.code}</strong> {symbol.name}</span>
                <small className={styles.muted}>{symbol.count}</small>
                <Toggles flags={flags} onFlag={(flag, value) => onState(withSymbolFlag(state, symbol.id, flag, value))} name={label(symbol)} />
              </li>;
            })}
          </ul>
        </details>
        <Toggles flags={{ hidden: row.flags.hidden ?? false, locked: row.flags.locked ?? false, dimmed: row.flags.dimmed ?? false }}
          onFlag={(flag, value) => layerFlag(row.id, flag, value)} name={text.layers[row.id]} />
      </li>)}
    </ul>
    {workPanel}

    {canEdit && <details className={styles.settings} data-testid="map-project-merge">
      <summary>{text.mergeHeading}</summary>
      <p className={styles.muted}>{text.mergeHelp}</p>
      {suggestions.length > 0 && <ul className={styles.rows}>
        {suggestions.map(suggestion => <li key={suggestion.from.id} data-testid="map-project-merge-suggestion">
          <span>{text.suggestion(label(suggestion.from), suggestion.from.count, label(suggestion.to), suggestion.reason)}</span>
          <Button variant="secondary" disabled={!!merging} onClick={() => onMerge(suggestion.from, suggestion.to)}>{text.merge(suggestion.from.count)}</Button>
        </li>)}
      </ul>}
      <label>{text.from}<select value={from} onChange={event => { setFrom(event.target.value); setTo(""); }} data-testid="map-project-merge-from">
        <option value="">{text.choose}</option>
        {catalog.filter(symbol => symbol.kind !== "text" && symbol.count > 0).map(symbol => <option key={symbol.id} value={symbol.id}>
          {label(symbol)} ({symbol.count}){standardSymbols.has(normalCode(symbol.code)) ? "" : ` – ${text.outsideShort}`}</option>)}
      </select></label>
      {source && <label>{text.to}<select value={to} onChange={event => setTo(event.target.value)} data-testid="map-project-merge-to">
        <option value="">{text.choose}</option>
        {targets.map(symbol => <option key={symbol.id} value={symbol.id}>{label(symbol)}{standardSymbols.has(normalCode(symbol.code)) ? "" : ` – ${text.outsideShort}`}</option>)}
      </select></label>}
      {source && target && <div role="status" data-testid="map-project-merge-preview">
        <p>{text.preview(source.count, label(source), label(target))}</p>
        {standardSymbols.has(normalCode(source.code)) && standardSymbols.has(normalCode(target.code)) && normalCode(source.code) !== normalCode(target.code)
          && <p className={styles.problem}>{text.bothStandard(standardSymbols.get(normalCode(source.code))!, standardSymbols.get(normalCode(target.code))!)}</p>}
        <span className={styles.actions}>
          <Button disabled={!!merging} onClick={() => { onMerge(source, target); setFrom(""); setTo(""); }} data-testid="map-project-merge-run">
            {text.merge(source.count)}</Button>
        </span>
      </div>}
      {merging && <p role="status" className={styles.muted}>{merging}</p>}
      {message && !merging && <p role="status" data-testid="map-project-merge-message">{message}</p>}
    </details>}
  </section>;
}

function Toggles({ flags, onFlag, name }: { flags: Required<LayerFlags>; onFlag: (flag: keyof LayerFlags, value: boolean) => void; name: string }) {
  const text = useTexts(mapProjectSymbolLayersSv, mapProjectSymbolLayersEn);
  return <span className={styles.layerToggles}>
    <button type="button" aria-pressed={!flags.hidden} title={flags.hidden ? text.show(name) : text.hide(name)} aria-label={flags.hidden ? text.show(name) : text.hide(name)}
      onClick={() => onFlag("hidden", !flags.hidden)} data-testid="map-project-layer-visible">{flags.hidden ? text.hiddenMark : text.visibleMark}</button>
    <button type="button" aria-pressed={flags.locked} title={flags.locked ? text.unlock(name) : text.lock(name)} aria-label={flags.locked ? text.unlock(name) : text.lock(name)}
      onClick={() => onFlag("locked", !flags.locked)} data-testid="map-project-layer-lock">{flags.locked ? text.lockedMark : text.openMark}</button>
    <button type="button" aria-pressed={flags.dimmed} disabled={!flags.locked || flags.hidden} title={text.dim(name)} aria-label={text.dim(name)}
      onClick={() => onFlag("dimmed", !flags.dimmed)} data-testid="map-project-layer-dim">{text.dimMark}</button>
  </span>;
}
