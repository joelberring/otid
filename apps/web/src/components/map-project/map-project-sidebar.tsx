"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { mapProjectEditorEn } from "../../i18n/map-project-en";
import { mapProjectQuickEn } from "../../i18n/map-project-tools-en";
import { useTexts } from "../language-provider";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import { SymbolIcon } from "./map-project-symbol-icon";
import type { Conflict, ObjectKey } from "@o-tid/map-revision";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { Button } from "../ui";
import styles from "./map-project-editor.module.css";

const GRID_KEY = "otid-map-symbol-grid";

/**
 * ADR-0219 (K1): editorns sidopanel. Symbolerna i kartfilen (bara de som finns i filen, sökbara på nummer och namn), lagren
 * (symbolgrupperna efter ISOM-numret), krockarna att välja i och samarbetet.
 */
export function MapProjectSidebar({ open, catalog, symbolId, onSymbol, layers, conflicts, symbols, onResolve, canEdit, children, after, strip, onStrip }: {
  /** Telefonen: panelen visas bara när den är öppnad (på större skärmar alltid). */
  open: boolean;
  catalog: readonly CatalogSymbol[]; symbolId: string | undefined; onSymbol: (id: string) => void;
  /** Lagren efter normen (ägaren 2026-11-09). */
  layers: ReactNode;
  conflicts: readonly Conflict[]; symbols: ReadonlyMap<string, CatalogSymbol>; onResolve: (key: ObjectKey, keep: "MINE" | "THEIRS") => void;
  canEdit: boolean;
  /** Samarbetet (förslag, delområden, arbetssätt), efter krockarna. */
  children?: ReactNode;
  /** Efter symbolerna och lagren (K3: rekningen). */
  after?: ReactNode;
  /** Symbolraden överst under verktygen (ägaren 2026-11-10). */
  strip: boolean; onStrip: (on: boolean) => void;
}) {
  const text = useTexts(mapProjectEditorSv, mapProjectEditorEn);
  const quick = useTexts(mapProjectQuickSv, mapProjectQuickEn);
  const [query, setQuery] = useState("");
  // Ägaren 2026-11-09: symbolerna som rutor (som i Mapper) eller som lista; valet sparas i webbläsaren.
  const [grid, setGrid] = useState(false);
  useEffect(() => { try { setGrid(localStorage.getItem(GRID_KEY) === "1"); } catch { /* utan lagring: listan */ } }, []);
  const chooseView = (next: boolean) => { setGrid(next); try { localStorage.setItem(GRID_KEY, next ? "1" : "0"); } catch { /* utan lagring */ } };
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter(entry => entry.kind !== "text" && (!needle || entry.code.toLowerCase().startsWith(needle) || entry.name.toLowerCase().includes(needle)));
  }, [catalog, query]);
  const chosen = symbolId ? symbols.get(symbolId) : undefined;

  return <aside id="map-project-sidebar" className={styles.sidebar} data-open={open}>
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

    {children}

    {canEdit && <section aria-labelledby="map-project-symbols" className={styles.panel}>
      <h2 id="map-project-symbols">{text.symbols.title}</h2>
      <p className={styles.muted}>{quick.wheelHelp}</p>
      <label className={styles.search}>
        <span className={styles.srOnly}>{text.symbols.search}</span>
        <input type="search" value={query} placeholder={text.symbols.searchHelp} aria-label={text.symbols.search}
          onChange={event => setQuery(event.target.value)} />
      </label>
      <div className={styles.viewToggle} role="group" aria-label={quick.view}>
        <button type="button" aria-pressed={grid} onClick={() => chooseView(true)} data-testid="map-project-symbols-grid">{quick.grid}</button>
        <button type="button" aria-pressed={!grid} onClick={() => chooseView(false)}>{quick.list}</button>
      </div>
      <label className={styles.stripToggle}><input type="checkbox" checked={strip} onChange={event => onStrip(event.target.checked)}
        data-testid="map-project-symbol-strip-toggle" /> {quick.strip}</label>
      {chosen && <p className={styles.muted}>{text.symbols.selected(chosen.code, chosen.name)}</p>}
      <ul className={grid ? styles.paletteGrid : styles.palette} data-testid="map-project-symbols" data-view={grid ? "grid" : "list"}>
        {shown.map(entry => <li key={entry.id}>
          <button type="button" className={grid ? styles.tile : styles.symbol} aria-pressed={entry.id === symbolId} onClick={() => onSymbol(entry.id)}
            title={`${entry.code} ${entry.name}`} data-code={entry.code} aria-label={grid ? `${entry.code} ${entry.name}` : undefined}>
            <SymbolIcon icon={entry.icon} size={grid ? 36 : 32} />
            {grid ? <span className={styles.tileCode}>{entry.code}</span> : <span><strong>{entry.code}</strong> {entry.name}</span>}
          </button>
        </li>)}
      </ul>
      {shown.length === 0 && <p className={styles.muted}>{text.symbols.none}</p>}
    </section>}

    {layers}
    {after}
  </aside>;
}
