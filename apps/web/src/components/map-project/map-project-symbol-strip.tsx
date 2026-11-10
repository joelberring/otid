"use client";

import { useState } from "react";
import { mapProjectQuickEn } from "../../i18n/map-project-tools-en";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { useTexts } from "../language-provider";
import { SymbolIcon } from "./map-project-symbol-icon";
import styles from "./map-project-editor.module.css";

export const SYMBOL_STRIP_KEY = "otid-map-symbol-strip";

/**
 * Ägaren 2026-11-10: symbolerna som en rad bilder under verktygen, utan nummer; numret och namnet visas direkt när musen står
 * över (eller knappen har fokus). Ett klick väljer symbolen och verktyget Rita, som i sidopanelen.
 */
export function MapProjectSymbolStrip({ catalog, symbolId, onSymbol }: {
  catalog: readonly CatalogSymbol[]; symbolId: string | undefined; onSymbol: (id: string) => void;
}) {
  const quick = useTexts(mapProjectQuickSv, mapProjectQuickEn);
  const [tip, setTip] = useState<{ text: string; x: number; y: number }>();
  const show = (entry: CatalogSymbol, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    setTip({ text: `${entry.code} ${entry.name}`, x: box.left, y: box.bottom + 4 });
  };
  return <>
    <ul className={styles.strip} aria-label={quick.stripLabel} data-testid="map-project-symbol-strip">
      {catalog.filter(entry => entry.kind !== "text").map(entry => <li key={entry.id}>
        <button type="button" aria-pressed={entry.id === symbolId} aria-label={`${entry.code} ${entry.name}`} data-code={entry.code}
          onClick={() => onSymbol(entry.id)} onMouseEnter={event => show(entry, event.currentTarget)} onFocus={event => show(entry, event.currentTarget)}
          onMouseLeave={() => setTip(undefined)} onBlur={() => setTip(undefined)}>
          <SymbolIcon icon={entry.icon} size={28} />
        </button>
      </li>)}
    </ul>
    {tip && <span className={styles.stripTip} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</span>}
  </>;
}
