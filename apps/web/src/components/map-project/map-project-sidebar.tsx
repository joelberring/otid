"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { mapProjectEditorEn } from "../../i18n/map-project-en";
import { mapProjectSymbolLayersEn } from "../../i18n/map-project-more-en";
import { mapProjectQuickEn } from "../../i18n/map-project-tools-en";
import { useTexts } from "../language-provider";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import { mapProjectSymbolLayersSv } from "../../i18n/map-project-symbol-layers-sv";
import { SymbolIcon } from "./map-project-symbol-icon";
import type { Conflict, ObjectKey } from "@o-tid/map-revision";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import { layerRows, type LayerState } from "../../lib/map-project-layer-model";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { Button } from "../ui";
import styles from "./map-project-editor.module.css";

const GRID_KEY = "otid-map-symbol-grid";
export type SidebarTab = "symbols" | "layers" | "review" | "process";

/**
 * ADR-0219 (K1): editorns panel till höger. Ägaren 2026-11-10: fyra flikar i stället för en lång rullista. Symboler (rutnätet
 * efter normens grupper, de senaste överst, sökbart på nummer och namn), Lager (symbollagren, arbets- och skisslagren och
 * underlagen), Granska (krockar, förslag, delområden, notiser, rekning, normkontroll) och Bearbeta (generalisera, rätta).
 * Flikarnas innehåll står kvar när man byter flik, så att en påbörjad uppladdning eller ett formulär inte går förlorat.
 */
export function MapProjectSidebar({ open, catalog, symbolId, onSymbol, recent, standardSymbols, layerState, layers, review, process, conflicts, symbols,
  onResolve, canEdit, tab, onTab }: {
  /** Telefonen: panelen visas bara när den är öppnad (på större skärmar alltid, om den inte är gömd). */
  open: boolean;
  catalog: readonly CatalogSymbol[]; symbolId: string | undefined; onSymbol: (id: string) => void;
  /** De senast använda symbolerna (1–9 väljer dem). */
  recent: readonly CatalogSymbol[];
  standardSymbols: ReadonlyMap<string, string>; layerState: LayerState;
  /** Fliken Lager: symbollagren, arbetslagren och underlagen. */
  layers: ReactNode;
  /** Fliken Granska, efter krockarna: samarbetet, notiserna, rekningen och normkontrollen. */
  review: ReactNode;
  /** Fliken Bearbeta: generalisera och rätta. */
  process: ReactNode;
  conflicts: readonly Conflict[]; symbols: ReadonlyMap<string, CatalogSymbol>; onResolve: (key: ObjectKey, keep: "MINE" | "THEIRS") => void;
  canEdit: boolean;
  tab: SidebarTab; onTab: (tab: SidebarTab) => void;
}) {
  const text = useTexts(mapProjectEditorSv, mapProjectEditorEn);
  const quick = useTexts(mapProjectQuickSv, mapProjectQuickEn);
  const groupText = useTexts(mapProjectSymbolLayersSv, mapProjectSymbolLayersEn);
  const [query, setQuery] = useState("");
  // Ägaren 2026-11-09 och 2026-11-10: symbolerna som rutor (förvalet) eller som lista; valet sparas i webbläsaren.
  const [grid, setGrid] = useState(true);
  useEffect(() => { try { setGrid(localStorage.getItem(GRID_KEY) !== "0"); } catch { /* utan lagring: rutorna */ } }, []);
  const chooseView = (next: boolean) => { setGrid(next); try { localStorage.setItem(GRID_KEY, next ? "1" : "0"); } catch { /* utan lagring */ } };
  const [tip, setTip] = useState<{ text: string; x: number; y: number }>();
  const showTip = (entry: CatalogSymbol, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    setTip({ text: `${entry.code} ${entry.name}`, x: Math.min(box.left, window.innerWidth - 220), y: box.bottom + 4 });
  };
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (entry: CatalogSymbol) => !needle || entry.code.toLowerCase().startsWith(needle) || entry.name.toLowerCase().includes(needle);
    return layerRows(catalog, standardSymbols, layerState).map(row => ({ id: row.id, symbols: row.symbols.filter(match) })).filter(row => row.symbols.length > 0);
  }, [catalog, standardSymbols, layerState, query]);
  const chosen = symbolId ? symbols.get(symbolId) : undefined;
  const tabs: readonly SidebarTab[] = canEdit ? ["symbols", "layers", "review", "process"] : ["layers", "review"];
  const current = tabs.includes(tab) ? tab : tabs[0]!;
  const tile = (entry: CatalogSymbol, index?: number) => <button type="button" className={grid || index !== undefined ? styles.tile : styles.symbol}
    aria-pressed={entry.id === symbolId} onClick={() => onSymbol(entry.id)} data-code={entry.code}
    aria-label={grid || index !== undefined ? `${entry.code} ${entry.name}` : undefined}
    onMouseEnter={event => showTip(entry, event.currentTarget)} onFocus={event => showTip(entry, event.currentTarget)}
    onMouseLeave={() => setTip(undefined)} onBlur={() => setTip(undefined)}>
    <SymbolIcon icon={entry.icon} size={grid || index !== undefined ? 28 : 32} />
    {index !== undefined ? <span className={styles.tileKey} aria-hidden="true">{index + 1}</span>
      : grid ? null : <span><strong>{entry.code}</strong> {entry.name}</span>}
  </button>;

  return <aside id="map-project-sidebar" className={styles.sidebar} data-open={open}>
    <div className={styles.tabs} role="tablist" aria-label={quick.tabsLabel}>
      {tabs.map(id => <button key={id} type="button" role="tab" id={`map-project-tab-${id}`} aria-selected={id === current}
        aria-controls={`map-project-tabpanel-${id}`} data-testid={`map-project-tab-${id}`} onClick={() => onTab(id)}>
        {quick.tabs[id]}{id === "review" && conflicts.length > 0 && <span className={styles.tabCount}> {conflicts.length}</span>}
      </button>)}
    </div>

    {canEdit && <div role="tabpanel" id="map-project-tabpanel-symbols" aria-labelledby="map-project-tab-symbols" hidden={current !== "symbols"}
      className={styles.tabPanel}>
      <section aria-label={text.symbols.title} className={styles.panel}>
        <div className={styles.symbolTools}>
          <label className={styles.search}>
            <span className={styles.srOnly}>{text.symbols.search}</span>
            <input type="search" value={query} placeholder={text.symbols.searchHelp} aria-label={text.symbols.search}
              onChange={event => setQuery(event.target.value)} />
          </label>
          <div className={styles.viewToggle} role="group" aria-label={quick.view}>
            <button type="button" aria-pressed={grid} onClick={() => chooseView(true)} data-testid="map-project-symbols-grid">{quick.grid}</button>
            <button type="button" aria-pressed={!grid} onClick={() => chooseView(false)} data-testid="map-project-symbols-list">{quick.list}</button>
          </div>
        </div>
        <p className={styles.chosen} data-testid="map-project-symbol-chosen">{chosen ? text.symbols.selected(chosen.code, chosen.name) : text.tools.noSymbol}</p>
        {recent.length > 0 && !query.trim() && <ul className={styles.recentRow} aria-label={quick.recent} data-testid="map-project-symbols-recent">
          {recent.map((entry, index) => <li key={entry.id}>{tile(entry, index)}</li>)}</ul>}
        {/* Ägaren 2026-11-10: rutorna i ett enda tätt rutnät i normens ordning (utan rubriker, som i Mapper), så att allt syns utan
            att rulla. Listan har gruppernas rubriker. */}
        {grid ? <ul className={styles.paletteGrid} data-testid="map-project-symbols" data-view="grid">
          {groups.flatMap(group => group.symbols).map(entry => <li key={entry.id}>{tile(entry)}</li>)}
        </ul> : <div data-testid="map-project-symbols" data-view="list">
          {groups.map(group => <div key={group.id}>
            <h3 className={styles.groupTitle}>{groupText.layers[group.id]}</h3>
            <ul className={styles.palette}>{group.symbols.map(entry => <li key={entry.id}>{tile(entry)}</li>)}</ul>
          </div>)}
        </div>}
        {groups.length === 0 && <p className={styles.muted}>{text.symbols.none}</p>}
      </section>
    </div>}

    <div role="tabpanel" id="map-project-tabpanel-layers" aria-labelledby="map-project-tab-layers" hidden={current !== "layers"} className={styles.tabPanel}>
      {layers}
    </div>

    <div role="tabpanel" id="map-project-tabpanel-review" aria-labelledby="map-project-tab-review" hidden={current !== "review"} className={styles.tabPanel}>
      {conflicts.length > 0 && <section aria-labelledby="map-project-conflicts" className={styles.panel}>
        <h2 id="map-project-conflicts">{text.conflicts.title(conflicts.length)}</h2>
        <p className={styles.muted}>{text.sync.conflict}</p>
        <ul className={styles.rows}>{conflicts.map(conflict => {
          const symbol = conflict.mine.kind === "OBJECT" ? symbols.get(conflict.mine.object.symbol)
            : conflict.theirs.state.kind === "OBJECT" ? symbols.get(conflict.theirs.state.object.symbol) : undefined;
          return <li key={conflict.key}><span>{text.conflicts.object(symbol?.code ?? "?")}</span>
            <span className={styles.actions}>
              <Button variant="secondary" onClick={() => onResolve(conflict.key, "MINE")}>{text.conflicts.mine}</Button>
              <Button variant="secondary" onClick={() => onResolve(conflict.key, "THEIRS")}>{text.conflicts.theirs}</Button>
            </span></li>;
        })}</ul>
      </section>}
      {review}
    </div>

    {canEdit && <div role="tabpanel" id="map-project-tabpanel-process" aria-labelledby="map-project-tab-process" hidden={current !== "process"}
      className={styles.tabPanel}>
      {process}
    </div>}
    {tip && <span className={styles.stripTip} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</span>}
  </aside>;
}
