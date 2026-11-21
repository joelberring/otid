"use client";

import { useEffect, useRef } from "react";
import { mapProjectQuickEn } from "../../i18n/map-project-tools-en";
import { useTexts } from "../language-provider";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import { SymbolIcon } from "./map-project-symbol-icon";
import { RailIconImage, type RailIcon } from "./map-project-tool-rail";
import styles from "./map-project-tool-wheel.module.css";

export interface WheelTool { readonly id: string; readonly label: string; readonly icon: RailIcon; readonly key: string; readonly active: boolean; readonly onPick: () => void;
  /** Förklaringen på raden under kartan när pekaren står på verktyget. */
  readonly help?: string | undefined; readonly disabled?: boolean | undefined }
export interface WheelAction { readonly id: string; readonly label: string; readonly key?: string | undefined; readonly disabled?: boolean | undefined; readonly onPick: () => void }

/** Ringens mittlinje, hjulets hela storlek och fältens storlek. Hålet i mitten är 2 × (RADIUS_PX − BAND_PX / 2) = 72 px. */
const RADIUS_PX = 56;
const BAND_PX = 40;
const SIZE_PX = 2 * RADIUS_PX + BAND_PX;
const SLOT_PX = 32;

/**
 * Ägaren 2026-11-09 ("högerklick, något form av funktionshjul") och 2026-11-10 ("inte för stort; i Mapper är det ganska litet
 * och lite ihåligt så att man ser var man trycker"): en liten ring runt punkten där man högerklickade eller höll fingret.
 * K8b V1 (2026-11-21): verktygen har åtta fasta platser i ringen (`WHEEL_SLOTS`; en tom plats när verktyget inte får användas),
 * mitten är ett hål där kartan syns, och listan bredvid har de senaste symbolerna (1–6), Gör igen och åtgärderna på det
 * markerade. Ett klick väljer och stänger; Escape eller ett klick utanför stänger.
 */
export function MapProjectToolWheel({ at, bounds, tools, symbols, symbolId, onSymbol, repeat, actions, onClose, onHover }: {
  /** Punkten i kartrutans pixlar och rutans storlek (hjulet hålls inne i rutan). */
  at: { readonly x: number; readonly y: number }; bounds: { readonly width: number; readonly height: number };
  tools: readonly (WheelTool | undefined)[]; symbols: readonly CatalogSymbol[]; symbolId: string | undefined; onSymbol: (id: string) => void;
  /** Gör igen överst bland åtgärderna («Gör igen: Byt till 505»), eller inget. */
  repeat?: WheelAction | undefined;
  actions: readonly WheelAction[]; onClose: () => void;
  /** Ägaren 2026-11-15: vad pekaren (eller tangentbordet) står på i hjulet, för raden under kartan; inget när den lämnar. */
  onHover?: ((text: string | undefined) => void) | undefined;
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
  const pick = (run: () => void) => () => { run(); onClose(); };
  const hover = (label: string) => ({ onPointerEnter: () => onHover?.(label), onFocus: () => onHover?.(label),
    onPointerLeave: () => onHover?.(undefined), onBlur: () => onHover?.(undefined) });
  useEffect(() => () => onHover?.(undefined), [onHover]);
  // Listan hamnar på den sida där det finns plats.
  const listLeft = left + SIZE_PX + 220 <= bounds.width;
  return <div ref={box} className={styles.wheel} style={{ left, top, width: SIZE_PX, height: SIZE_PX }} role="menu" aria-label={text.wheel}
    data-testid="map-project-wheel">
    <svg className={styles.ring} width={SIZE_PX} height={SIZE_PX} aria-hidden="true"><circle cx={half} cy={half} r={RADIUS_PX} strokeWidth={BAND_PX} /></svg>
    {tools.map((tool, index) => {
      const angle = -Math.PI / 2 + index / tools.length * Math.PI * 2;
      const style = { left: half + Math.cos(angle) * RADIUS_PX - SLOT_PX / 2, top: half + Math.sin(angle) * RADIUS_PX - SLOT_PX / 2 };
      if (!tool) return <span key={`empty-${index}`} className={`${styles.slot} ${styles.empty}`} style={style} aria-hidden="true" />;
      return <button key={tool.id} type="button" role="menuitemradio" aria-checked={tool.active} className={styles.slot} style={style} disabled={tool.disabled}
        title={tool.key ? `${tool.label} (${tool.key})` : tool.label} data-testid={`map-project-wheel-${tool.id}`} data-slot={index}
        aria-label={tool.label} onClick={pick(tool.onPick)} {...hover(text.wheelHover(tool.label, tool.key || undefined, tool.help))}>
        <RailIconImage icon={tool.icon} size={18} />
      </button>;
    })}
    {(symbols.length > 0 || repeat || actions.length > 0) && <div className={styles.actions} style={listLeft ? { left: SIZE_PX + 8 } : { right: SIZE_PX + 8 }}>
      {symbols.length > 0 && <div className={styles.symbols} role="group" aria-label={text.recent}>
        {symbols.map((symbol, index) => <button key={symbol.id} type="button" role="menuitemradio" aria-checked={symbol.id === symbolId}
          title={`${index + 1}: ${symbol.code} ${symbol.name}`} aria-label={`${symbol.code} ${symbol.name}`} data-testid="map-project-wheel-symbol" data-code={symbol.code}
          onClick={pick(() => onSymbol(symbol.id))} {...hover(text.wheelHover(`${symbol.code} ${symbol.name}`, String(index + 1), undefined))}>
          <SymbolIcon icon={symbol.icon} size={22} /><kbd aria-hidden="true">{index + 1}</kbd>
        </button>)}
      </div>}
      {(repeat || actions.length > 0) && <div role="group" aria-label={text.actions} className={styles.list}>
        {[...(repeat ? [repeat] : []), ...actions].map(action => <button key={action.id} type="button" role="menuitem" disabled={action.disabled}
          data-testid={`map-project-wheel-action-${action.id}`} onClick={pick(action.onPick)} {...hover(text.wheelHover(action.label, action.key, undefined))}>
          <span>{action.label}</span>{action.key && <kbd aria-hidden="true">{action.key}</kbd>}</button>)}
      </div>}
    </div>}
  </div>;
}
