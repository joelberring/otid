"use client";

import { useEffect, useRef } from "react";
import { mapProjectQuickEn } from "../../i18n/map-project-tools-en";
import { useTexts } from "../language-provider";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { SymbolIcon } from "./map-project-symbol-icon";
import { RailIconImage, type RailIcon } from "./map-project-tool-rail";
import styles from "./map-project-tool-wheel.module.css";

export interface WheelTool { readonly id: string; readonly label: string; readonly icon: RailIcon; readonly key: string; readonly active: boolean; readonly onPick: () => void }
export interface WheelAction { readonly id: string; readonly label: string; readonly disabled?: boolean | undefined; readonly onPick: () => void }

/** Ringens mittlinje, hjulets hela storlek och fältens storlek. Hålet i mitten är 2 × (RADIUS_PX − BAND_PX / 2) = 72 px. */
const RADIUS_PX = 56;
const BAND_PX = 40;
const SIZE_PX = 2 * RADIUS_PX + BAND_PX;
const SLOT_PX = 32;

/**
 * Ägaren 2026-11-09 ("högerklick, något form av funktionshjul") och 2026-11-10 ("inte för stort; i Mapper är det ganska litet
 * och lite ihåligt så att man ser var man trycker"): en liten ring runt punkten där man högerklickade eller höll fingret.
 * Verktygen som ikoner och de senaste symbolerna ligger i ringen (ett klick väljer och stänger), mitten är ett hål där kartan
 * syns, och objektets åtgärder (förenkla, mjuk, byt symbol …) står i en lista bredvid. Escape eller ett klick utanför stänger.
 */
export function MapProjectToolWheel({ at, bounds, tools, symbols, symbolId, onSymbol, actions, onClose }: {
  /** Punkten i kartrutans pixlar och rutans storlek (hjulet hålls inne i rutan). */
  at: { readonly x: number; readonly y: number }; bounds: { readonly width: number; readonly height: number };
  tools: readonly WheelTool[]; symbols: readonly CatalogSymbol[]; symbolId: string | undefined; onSymbol: (id: string) => void;
  actions: readonly WheelAction[]; onClose: () => void;
}) {
  const text = useTexts(mapProjectQuickSv, mapProjectQuickEn);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    const onDown = (event: PointerEvent) => { if (box.current && !box.current.contains(event.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    box.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onDown, true); };
  }, [onClose]);
  const half = SIZE_PX / 2;
  const left = Math.max(0, Math.min(bounds.width - SIZE_PX, at.x - half));
  const top = Math.max(0, Math.min(bounds.height - SIZE_PX, at.y - half));
  const ring = [...tools.map(tool => ({ kind: "tool" as const, tool })), ...symbols.map((symbol, index) => ({ kind: "symbol" as const, symbol, index }))];
  const pick = (run: () => void) => () => { run(); onClose(); };
  // Listan hamnar på den sida där det finns plats.
  const listLeft = left + SIZE_PX + 220 <= bounds.width;
  return <div ref={box} className={styles.wheel} style={{ left, top, width: SIZE_PX, height: SIZE_PX }} role="menu" aria-label={text.wheel}
    data-testid="map-project-wheel">
    <svg className={styles.ring} width={SIZE_PX} height={SIZE_PX} aria-hidden="true"><circle cx={half} cy={half} r={RADIUS_PX} strokeWidth={BAND_PX} /></svg>
    {ring.map((entry, index) => {
      const angle = -Math.PI / 2 + index / ring.length * Math.PI * 2;
      const style = { left: half + Math.cos(angle) * RADIUS_PX - SLOT_PX / 2, top: half + Math.sin(angle) * RADIUS_PX - SLOT_PX / 2 };
      if (entry.kind === "tool") {
        return <button key={entry.tool.id} type="button" role="menuitemradio" aria-checked={entry.tool.active} className={styles.slot} style={style}
          title={entry.tool.key ? `${entry.tool.label} (${entry.tool.key})` : entry.tool.label} data-testid={`map-project-wheel-${entry.tool.id}`}
          aria-label={entry.tool.label} onClick={pick(entry.tool.onPick)}>
          <RailIconImage icon={entry.tool.icon} size={18} />
        </button>;
      }
      const symbol = entry.symbol;
      return <button key={symbol.id} type="button" role="menuitemradio" aria-checked={symbol.id === symbolId} className={`${styles.slot} ${styles.symbol}`} style={style}
        title={`${entry.index + 1}: ${symbol.code} ${symbol.name}`} aria-label={`${symbol.code} ${symbol.name}`} data-testid="map-project-wheel-symbol" data-code={symbol.code}
        onClick={pick(() => onSymbol(symbol.id))}>
        <SymbolIcon icon={symbol.icon} size={24} />
      </button>;
    })}
    {actions.length > 0 && <div className={styles.actions} style={listLeft ? { left: SIZE_PX + 8 } : { right: SIZE_PX + 8 }} role="group" aria-label={text.actions}>
      {actions.map(action => <button key={action.id} type="button" role="menuitem" disabled={action.disabled} data-testid={`map-project-wheel-action-${action.id}`}
        onClick={pick(action.onPick)}>{action.label}</button>)}
    </div>}
  </div>;
}
