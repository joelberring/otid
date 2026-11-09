"use client";

import { useEffect, useRef } from "react";
import { mapProjectQuickSv as text } from "../../i18n/map-project-quick-sv";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { SymbolIcon } from "./map-project-symbol-icon";
import styles from "./map-project-tool-wheel.module.css";

export interface WheelTool { readonly id: string; readonly label: string; readonly key: string; readonly active: boolean; readonly onPick: () => void }
export interface WheelAction { readonly id: string; readonly label: string; readonly disabled?: boolean | undefined; readonly onPick: () => void }

const RADIUS_PX = 84;
const SIZE_PX = 260;

/**
 * Ägaren 2026-11-09 ("högerklick, något form av funktionshjul"): verktygshjulet på kartan där man högerklickade eller höll
 * fingret. Verktygen och de senaste symbolerna ligger i en ring runt punkten (ett klick väljer och stänger), objektets
 * åtgärder (förenkla, mjuk, byt symbol …) i en lista bredvid. Escape eller ett klick utanför stänger.
 */
export function MapProjectToolWheel({ at, bounds, tools, symbols, symbolId, onSymbol, actions, onClose }: {
  /** Punkten i kartrutans pixlar och rutans storlek (hjulet hålls inne i rutan). */
  at: { readonly x: number; readonly y: number }; bounds: { readonly width: number; readonly height: number };
  tools: readonly WheelTool[]; symbols: readonly CatalogSymbol[]; symbolId: string | undefined; onSymbol: (id: string) => void;
  actions: readonly WheelAction[]; onClose: () => void;
}) {
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
    <svg className={styles.ring} width={SIZE_PX} height={SIZE_PX} aria-hidden="true"><circle cx={half} cy={half} r={RADIUS_PX + 30} /></svg>
    {ring.map((entry, index) => {
      const angle = -Math.PI / 2 + index / ring.length * Math.PI * 2;
      const style = { left: half + Math.cos(angle) * RADIUS_PX - 28, top: half + Math.sin(angle) * RADIUS_PX - 28 };
      if (entry.kind === "tool") {
        return <button key={entry.tool.id} type="button" role="menuitemradio" aria-checked={entry.tool.active} className={styles.slot} style={style}
          title={entry.tool.key ? `${entry.tool.label} (${entry.tool.key})` : entry.tool.label} data-testid={`map-project-wheel-${entry.tool.id}`}
          onClick={pick(entry.tool.onPick)}>
          <span className={styles.label}>{entry.tool.label}</span>
        </button>;
      }
      const symbol = entry.symbol;
      return <button key={symbol.id} type="button" role="menuitemradio" aria-checked={symbol.id === symbolId} className={`${styles.slot} ${styles.symbol}`} style={style}
        title={`${entry.index + 1}: ${symbol.code} ${symbol.name}`} data-testid="map-project-wheel-symbol" data-code={symbol.code}
        onClick={pick(() => onSymbol(symbol.id))}>
        <SymbolIcon icon={symbol.icon} size={28} />
        <span className={styles.code}>{symbol.code}</span>
      </button>;
    })}
    <button type="button" className={styles.center} onClick={onClose} aria-label={text.close} title={text.close}>×</button>
    {actions.length > 0 && <div className={styles.actions} style={listLeft ? { left: SIZE_PX + 8 } : { right: SIZE_PX + 8 }} role="group" aria-label={text.actions}>
      {actions.map(action => <button key={action.id} type="button" role="menuitem" disabled={action.disabled} data-testid={`map-project-wheel-action-${action.id}`}
        onClick={pick(action.onPick)}>{action.label}</button>)}
    </div>}
  </div>;
}
