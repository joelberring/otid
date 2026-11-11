"use client";

import { useMemo, useState, type ReactNode } from "react";
import { mapProjectSymbolLayersEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import { mapProjectSymbolLayersSv } from "../../i18n/map-project-symbol-layers-sv";
import {
  GROUP_KEYS, LAYER_ORDER, layerRows, mergeSuggestions, normalCode, symbolFlags, withLayerFlag, withSymbolFlag, type LayerFlags, type LayerId, type LayerState, type Standard,
  type LayerView, type WorkLayer
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
export function MapProjectSymbolLayers({ catalog, standard, standardSymbols, state, onState, canEdit, onMerge, merging, message, work = [], workPanel, views }: {
  catalog: readonly CatalogSymbol[]; standard: Standard; standardSymbols: ReadonlyMap<string, string>;
  state: LayerState; onState: (state: LayerState) => void; canEdit: boolean;
  /** Slå ihop: alla objekt med `from` får symbolen `to`. */
  onMerge: (from: CatalogSymbol, to: CatalogSymbol) => void; merging: string | undefined; message: string | undefined;
  /** Lagren fas 2: arbetslagren (för symbolernas val) och panelen för arbets- och skisslagren. */
  work?: readonly WorkLayer[]; workPanel?: ReactNode;
  /** R3: sparade vyer (lagrens val under ett namn). */
  views?: { readonly views: readonly LayerView[]; readonly saveView: (name: string) => void; readonly removeView: (name: string) => void } | undefined;
}) {
  const text = useTexts(mapProjectSymbolLayersSv, mapProjectSymbolLayersEn);
  const rows = useMemo(() => layerRows(catalog, standardSymbols, state), [catalog, standardSymbols, state]);
  const suggestions = useMemo(() => mergeSuggestions(catalog, standardSymbols), [catalog, standardSymbols]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const source = catalog.find(symbol => symbol.id === from);
  const targets = catalog.filter(symbol => source && symbol.id !== source.id && symbol.kind === source.kind);
  const target = targets.find(symbol => symbol.id === to);
  // R3 «flera rader på en gång»: Skift+klick sätter samma val på alla rader mellan den senast klickade och den här; Alt+klick på
  // ögat visar bara den raden.
  const [last, setLast] = useState<{ list: string; index: number }>();
  const [viewName, setViewName] = useState("");
  const layerFlag = (id: LayerId, flag: keyof LayerFlags, value: boolean, event?: { shiftKey: boolean; altKey: boolean }) => {
    const index = rows.findIndex(row => row.id === id);
    if (event?.altKey && flag === "hidden") {
      onState(LAYER_ORDER.reduce((next, layer) => withLayerFlag(next, catalog, standardSymbols, layer, "hidden", layer !== id), state));
    } else if (event?.shiftKey && last?.list === "layers") {
      const [from, to] = [Math.min(last.index, index), Math.max(last.index, index)];
      onState(rows.slice(from, to + 1).reduce((next, row) => withLayerFlag(next, catalog, standardSymbols, row.id, flag, value), state));
    } else onState(withLayerFlag(state, catalog, standardSymbols, id, flag, value));
    setLast({ list: "layers", index });
  };
  const symbolFlag = (row: (typeof rows)[number], index: number, flag: keyof LayerFlags, value: boolean, event?: { shiftKey: boolean; altKey: boolean }) => {
    const symbol = row.symbols[index]!;
    if (event?.altKey && flag === "hidden") onState(row.symbols.reduce((next, other) => withSymbolFlag(next, other.id, "hidden", other.id !== symbol.id), state));
    else if (event?.shiftKey && last?.list === row.id) {
      const [from, to] = [Math.min(last.index, index), Math.max(last.index, index)];
      onState(row.symbols.slice(from, to + 1).reduce((next, other) => withSymbolFlag(next, other.id, flag, value), state));
    } else onState(withSymbolFlag(state, symbol.id, flag, value));
    setLast({ list: row.id, index });
  };
  const label = (symbol: CatalogSymbol) => `${symbol.code} ${symbol.name}`;

  return <section aria-labelledby="map-project-symbol-layers-title" className={styles.panel} data-testid="map-project-symbol-layers">
    <h2 id="map-project-symbol-layers-title">{text.title}</h2>
    <p className={styles.muted}>{text.help(standard)}</p>
    <ul className={styles.layerList}>
      {rows.map(row => <li key={row.id} data-testid="map-project-layer-row" data-layer={row.id}>
        <details>
          <summary>
            {GROUP_KEYS.includes(row.id) && <kbd className={styles.layerKey} title={text.groupKey(GROUP_KEYS.indexOf(row.id) + 1)}>{GROUP_KEYS.indexOf(row.id) + 1}</kbd>}
            <span className={styles.layerName}>{text.layers[row.id]}</span> <small className={styles.muted}>{text.count(row.count)}</small>
          </summary>
          {row.id === "OUTSIDE" && <p className={styles.muted}>{text.outsideHelp(standard)}</p>}
          <ul className={styles.layerSymbols}>
            {row.symbols.map((symbol, index) => {
              const flags = symbolFlags(symbol, standardSymbols, state, work);
              return <li key={symbol.id} data-testid="map-project-layer-symbol" data-code={symbol.code}>
                <SymbolIcon icon={symbol.icon} size={24} />
                <span className={styles.layerSymbolName} title={label(symbol)}><strong>{symbol.code}</strong> {symbol.name}</span>
                <small className={styles.muted}>{symbol.count}</small>
                <Toggles flags={flags} onFlag={(flag, value, event) => symbolFlag(row, index, flag, value, event)} name={label(symbol)} />
              </li>;
            })}
          </ul>
        </details>
        <Toggles flags={{ hidden: row.flags.hidden ?? false, locked: row.flags.locked ?? false, dimmed: row.flags.dimmed ?? false }}
          onFlag={(flag, value, event) => layerFlag(row.id, flag, value, event)} name={text.layers[row.id]} />
      </li>)}
    </ul>
    <p className={styles.muted}>{text.multiHelp}</p>
    {views && <details className={styles.settings} data-testid="map-project-layer-views">
      <summary>{text.viewsHeading}</summary>
      <p className={styles.muted}>{text.viewsHelp}</p>
      {views.views.length > 0 && <ul className={styles.rows}>
        {views.views.map(view => <li key={view.name} data-testid="map-project-layer-view">
          <span>{view.name}</span>
          <Button variant="secondary" onClick={() => onState(view.state)}>{text.viewUse}</Button>
          <Button variant="quiet" onClick={() => views.removeView(view.name)}>{text.viewRemove}</Button>
        </li>)}
      </ul>}
      <label>{text.viewName}<input value={viewName} maxLength={40} onChange={event => setViewName(event.target.value)} data-testid="map-project-layer-view-name" /></label>
      <span className={styles.actions}><Button variant="secondary" disabled={!viewName.trim()} onClick={() => { views.saveView(viewName.trim()); setViewName(""); }}
        data-testid="map-project-layer-view-save">{text.viewSave}</Button></span>
    </details>}
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

/** R3: öga, lås och nedtonat som ikoner (namnet i title och aria-label). */
const ICONS = {
  eye: <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z" />,
  eyeOff: <path d="M3 3l18 18M10.6 6.1A10 10 0 0112 6c6.5 0 10 6 10 6a17 17 0 01-3 3.6M6.6 6.6A17 17 0 002 12s3.5 6 10 6a9.7 9.7 0 004.4-1" />,
  lock: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3" />,
  open: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 016.8-1.2" />,
  dim: <><circle cx="12" cy="12" r="8" /><path d="M12 4v16a8 8 0 000-16z" fill="currentColor" /></>
};
export const LayerIcon = ({ name }: { name: keyof typeof ICONS }) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"
  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;

function Toggles({ flags, onFlag, name }: { flags: Required<LayerFlags>; name: string;
  onFlag: (flag: keyof LayerFlags, value: boolean, event: { shiftKey: boolean; altKey: boolean }) => void }) {
  const text = useTexts(mapProjectSymbolLayersSv, mapProjectSymbolLayersEn);
  return <span className={styles.layerToggles}>
    <button type="button" aria-pressed={!flags.hidden} title={flags.hidden ? text.show(name) : text.hide(name)} aria-label={flags.hidden ? text.show(name) : text.hide(name)}
      onClick={event => onFlag("hidden", !flags.hidden, event)} data-testid="map-project-layer-visible"><LayerIcon name={flags.hidden ? "eyeOff" : "eye"} /></button>
    <button type="button" aria-pressed={flags.locked} title={flags.locked ? text.unlock(name) : text.lock(name)} aria-label={flags.locked ? text.unlock(name) : text.lock(name)}
      onClick={event => onFlag("locked", !flags.locked, event)} data-testid="map-project-layer-lock"><LayerIcon name={flags.locked ? "lock" : "open"} /></button>
    <button type="button" aria-pressed={flags.dimmed} disabled={!flags.locked || flags.hidden} title={text.dim(name)} aria-label={text.dim(name)}
      onClick={event => onFlag("dimmed", !flags.dimmed, event)} data-testid="map-project-layer-dim"><LayerIcon name="dim" /></button>
  </span>;
}
