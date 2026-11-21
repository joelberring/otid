"use client";

import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { SymbolIcon } from "./map-project-symbol-icon";
import { RailIconImage } from "./map-project-tool-rail";
import styles from "./map-project-bars.module.css";

/** Så många av de senaste symbolerna som visas överst (tangenterna 1–8). */
export const RECENT_SHOWN = 8;

/**
 * K8b V1 (ägaren 2026-11-21): raden överst. Senaste: de åtta senast valda symbolerna med siffran 1–8 (ett klick eller siffran
 * väljer symbolen utan att byta verktyg), och Ångra och Gör om. I telefonen står Ångra och Gör om i verktygsraden i stället.
 */
export function MapProjectTopBar({ recent, symbolId, onSymbol, text, undo, redo }: {
  recent: readonly CatalogSymbol[]; symbolId: string | undefined; onSymbol: (id: string) => void;
  text: { readonly recent: string; readonly recentEmpty: string; readonly recentPick: (digit: number, code: string, name: string) => string };
  undo: { readonly label: string; readonly key: string | undefined; readonly disabled: boolean; readonly onPick: () => void };
  redo: { readonly label: string; readonly key: string | undefined; readonly disabled: boolean; readonly onPick: () => void };
}) {
  const shown = recent.slice(0, RECENT_SHOWN);
  const history = (entry: typeof undo, icon: "undo" | "redo") => <button type="button" aria-label={entry.label} aria-keyshortcuts={entry.key?.replace("⇧", "Shift+")}
    title={entry.key ? `${entry.label} (${entry.key})` : entry.label} disabled={entry.disabled} onClick={entry.onPick} data-testid={`map-project-${icon}`}>
    <RailIconImage icon={icon} size={20} />
  </button>;
  return <div className={styles.top} data-testid="map-project-top">
    <h2>{text.recent}</h2>
    {shown.length === 0 ? <p className={styles.empty}>{text.recentEmpty}</p>
      : <ul className={styles.recent} aria-label={text.recent}>
        {shown.map((symbol, index) => <li key={symbol.id}>
          <button type="button" className={styles.tile} aria-pressed={symbol.id === symbolId} aria-keyshortcuts={String(index + 1)}
            title={text.recentPick(index + 1, symbol.code, symbol.name)} aria-label={`${symbol.code} ${symbol.name}`} data-testid="map-project-recent" data-code={symbol.code}
            onClick={() => onSymbol(symbol.id)}>
            <SymbolIcon icon={symbol.icon} size={24} />
            <span className={styles.digit} aria-hidden="true">{index + 1}</span>
          </button>
        </li>)}
      </ul>}
    <div className={styles.history}>{history(undo, "undo")}{history(redo, "redo")}</div>
  </div>;
}
