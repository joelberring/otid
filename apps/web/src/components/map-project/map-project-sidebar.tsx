"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Conflict, ObjectKey } from "@o-tid/map-revision";
import { mapProjectEditorSv } from "../../i18n/map-project-editor-sv";
import type { CatalogSymbol, SymbolGroup } from "../../lib/map-project-protocol";
import { Button } from "../ui";
import styles from "./map-project-editor.module.css";

const text = mapProjectEditorSv;
const GROUPS: readonly SymbolGroup[] = ["LANDFORMS", "ROCK", "WATER", "VEGETATION", "MANMADE", "TECHNICAL", "COURSE", "OTHER"];

/** Symbolens lilla bild (PNG från Workern), som en bild-URL som släpps när den inte används. */
function SymbolIcon({ icon }: { icon: Blob | undefined }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!icon) return;
    const next = URL.createObjectURL(icon);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [icon]);
  return url ? <img src={url} alt="" width={32} height={32} className={styles.icon} /> : <span className={styles.icon} />;
}

/**
 * ADR-0219 (K1): editorns sidopanel. Symbolerna i kartfilen (bara de som finns i filen, sökbara på nummer och namn), lagren
 * (symbolgrupperna efter ISOM-numret), krockarna att välja i och samarbetet.
 */
export function MapProjectSidebar({ open, catalog, symbolId, onSymbol, hiddenGroups, onToggleGroup, conflicts, symbols, onResolve, canEdit, children, after }: {
  /** Telefonen: panelen visas bara när den är öppnad (på större skärmar alltid). */
  open: boolean;
  catalog: readonly CatalogSymbol[]; symbolId: string | undefined; onSymbol: (id: string) => void;
  hiddenGroups: ReadonlySet<SymbolGroup>; onToggleGroup: (group: SymbolGroup) => void;
  conflicts: readonly Conflict[]; symbols: ReadonlyMap<string, CatalogSymbol>; onResolve: (key: ObjectKey, keep: "MINE" | "THEIRS") => void;
  canEdit: boolean;
  /** Samarbetet (förslag, delområden, arbetssätt), efter krockarna. */
  children?: ReactNode;
  /** Efter symbolerna och lagren (K3: rekningen). */
  after?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter(entry => entry.kind !== "text" && (!needle || entry.code.toLowerCase().startsWith(needle) || entry.name.toLowerCase().includes(needle)));
  }, [catalog, query]);
  const counts = useMemo(() => {
    const out = new Map<SymbolGroup, number>();
    for (const entry of catalog) out.set(entry.group, (out.get(entry.group) ?? 0) + entry.count);
    return out;
  }, [catalog]);
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
      <label className={styles.search}>
        <span className={styles.srOnly}>{text.symbols.search}</span>
        <input type="search" value={query} placeholder={text.symbols.searchHelp} aria-label={text.symbols.search}
          onChange={event => setQuery(event.target.value)} />
      </label>
      {chosen && <p className={styles.muted}>{text.symbols.selected(chosen.code, chosen.name)}</p>}
      <ul className={styles.palette} data-testid="map-project-symbols">
        {shown.map(entry => <li key={entry.id}>
          <button type="button" className={styles.symbol} aria-pressed={entry.id === symbolId} onClick={() => onSymbol(entry.id)}
            title={`${entry.code} ${entry.name}`} data-code={entry.code}>
            <SymbolIcon icon={entry.icon} />
            <span><strong>{entry.code}</strong> {entry.name}</span>
          </button>
        </li>)}
      </ul>
      {shown.length === 0 && <p className={styles.muted}>{text.symbols.none}</p>}
    </section>}

    <section aria-labelledby="map-project-layers" className={styles.panel}>
      <h2 id="map-project-layers">{text.layers.title}</h2>
      <p className={styles.muted}>{text.layers.help}</p>
      <ul className={styles.rows}>{GROUPS.filter(group => (counts.get(group) ?? 0) > 0).map(group => <li key={group}>
        <label className={styles.check}>
          <input type="checkbox" checked={!hiddenGroups.has(group)} onChange={() => onToggleGroup(group)} />
          <span>{text.layers.groups[group]} <small className={styles.muted}>{text.symbols.count(counts.get(group) ?? 0)}</small></span>
        </label>
      </li>)}</ul>
    </section>
    {after}
  </aside>;
}
