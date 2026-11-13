"use client";

import { useState, type ReactNode } from "react";
import styles from "./map-project-tool-rail.module.css";

export type RailIcon = "select" | "draw" | "circle" | "area" | "note" | "undo" | "redo" | "panel" | "addPoint" | "removePoint" | "keys"
  | "cut" | "rectangle" | "bucket" | "duplicate" | "fill" | "parallel" | "pick" | "reverse" | "switchSymbol" | "join" | "smooth" | "simplify" | "checked" | "remove" | "wheel" | "bare";

export interface RailTool {
  readonly id: string; readonly label: string; readonly icon: RailIcon;
  /** Tangenten, visad i ikonens hörn och i tipset. */
  readonly key?: string | undefined;
  /** Tipset utöver namnet och tangenten. */
  readonly help?: string | undefined;
  readonly active?: boolean | undefined; readonly disabled?: boolean | undefined;
  /** Varför verktyget inte går att använda just nu (visas i förklaringen). */
  readonly disabledHelp?: string | undefined;
  /** Strecket före verktyget (en ny grupp). */
  readonly gap?: boolean | undefined;
  /** Bara på telefonen (panelens knapp). */
  readonly phoneOnly?: boolean | undefined;
  /** Bara i datorn (tangenterna). */
  readonly desktopOnly?: boolean | undefined;
  /** Telefonen: knappen ligger kvar vid radens högra kant när raden rullas (Ångra och Gör om ska alltid synas). */
  readonly pin?: "first" | "second" | undefined;
  readonly testId?: string | undefined;
  readonly onPick: () => void;
}

const PATHS: Record<RailIcon, ReactNode> = {
  select: <path d="M5 3l12 9-5.2 1 3 6-2.4 1.2-3-6L5 18z" fill="currentColor" stroke="none" />,
  draw: <><path d="M4 20l1-4.5L16.5 4l3.5 3.5L8.5 19z" /><path d="M14 6.5l3.5 3.5" /></>,
  circle: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  area: <path d="M4 8l7-4 9 5-2 10-10 1z" strokeDasharray="3 2" />,
  note: <><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" /></>,
  undo: <><path d="M8 5L4 9l4 4" /><path d="M4 9h10a5 5 0 010 10h-4" /></>,
  redo: <><path d="M16 5l4 4-4 4" /><path d="M20 9H10a5 5 0 000 10h4" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /></>,
  addPoint: <><path d="M3 17L10 9l5 5" /><rect x="8" y="7" width="4" height="4" fill="currentColor" /><path d="M18 3v8M14 7h8" /></>,
  removePoint: <><path d="M3 17L10 9l5 5" /><rect x="8" y="7" width="4" height="4" fill="currentColor" /><path d="M14 7h8" /></>,
  keys: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  // Byt symbol: två rutor med pilar emellan.
  switchSymbol: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" fill="currentColor" /><path d="M14 6h5v4M17.5 8.5L19 10l1.5-1.5M10 18H5v-4M3.5 15.5L5 14l1.5 1.5" /></>,
  // Slå ihop: två linjer som möts i en punkt.
  join: <><path d="M3 18l6-6M21 6l-6 6" /><circle cx="12" cy="12" r="2.6" /></>,
  // Saxen, pipetten och två pilar åt var sitt håll.
  rectangle: <path d="M4 7l13-3 3 13-13 3z" />,
  // Färgburken: en lutad burk och en droppe.
  bucket: <><path d="M4.5 12.5L12 5l7 7-7.5 7.5z" /><path d="M9 3.5l3 3" /><path d="M20 15.5c1 1.6 1.5 2.5 1.5 3.3a1.5 1.5 0 01-3 0c0-.8.5-1.7 1.5-3.3z" fill="currentColor" stroke="none" /></>,
  duplicate: <><rect x="4" y="4" width="11" height="11" rx="1.5" /><path d="M9 20h9.5a1.5 1.5 0 001.5-1.5V9" /></>,
  fill: <><path d="M5 6h14v12H5z" /><path d="M5 12l7-6M5 18l14-12M11 18l8-7" /></>,
  parallel: <path d="M4 15c4-6 8-6 16-2M4 20c4-6 8-6 16-2" />,
  cut: <><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M8.2 7.6L20 17M8.2 16.4L20 7" /></>,
  pick: <><path d="M14 6l4 4M15.5 4.5l4 4-2 2-4-4zM13 8l-8 8-1 4 4-1 8-8" /></>,
  reverse: <><path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" /></>,
  smooth: <path d="M3 16c3-10 6-10 9-2s6 6 9-6" />,
  simplify: <><path d="M3 17l4-9 4 6 4-8 6 9" strokeDasharray="2 2.4" /><path d="M3 17L15 6l6 9" /></>,
  checked: <><circle cx="12" cy="12" r="9" /><path d="M7.5 12.5l3 3 6-7" /></>,
  remove: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></>,
  wheel: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21" /></>,
  bare: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>
};

/** Verktygets ikon (också i verktygshjulet). */
export function RailIconImage({ icon, size = 22 }: { icon: RailIcon; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">{PATHS[icon]}</svg>;
}

/**
 * Ägaren 2026-11-10 ("små symboler i en rad i vänsterspalten, ungefär som AutoCAD"): verktygen som ikoner med tangenten i
 * hörnet. En smal spalt till vänster om kartan i datorn, en rad överst i telefonen. Knapparna heter som verktygen
 * (aria-label), och tipset visar namnet, tangenten och en förklaring.
 */
export function MapProjectToolRail({ label, tools, spaceLabel = "Space" }: { label: string; tools: readonly RailTool[]; spaceLabel?: string }) {
  // Förklaringen vid pekaren eller fokus (ägaren 2026-11-10): namnet, tangenten och vad verktyget gör. Den ligger utanför
  // spalten (fast läge), så att den inte klipps av spaltens rullning.
  const [tip, setTip] = useState<{ id: string; top: number; left: number }>();
  const show = (id: string) => (event: { currentTarget: HTMLElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTip({ id, top: rect.top + rect.height / 2, left: rect.right + 8 });
  };
  const shown = tip && tools.find(tool => tool.id === tip.id);
  return <div className={styles.rail} role="toolbar" aria-label={label} aria-orientation="vertical" data-testid="map-project-rail">
    {tools.map(tool => <button key={tool.id} type="button" className={styles.tool} aria-label={tool.label} aria-pressed={tool.active}
      aria-keyshortcuts={tool.key} aria-description={tool.help} aria-disabled={tool.disabled || undefined}
      data-gap={tool.gap || undefined} data-phone={tool.phoneOnly || undefined} data-desktop={tool.desktopOnly || undefined} data-pin={tool.pin} data-testid={tool.testId}
      onPointerEnter={event => { if (event.pointerType === "mouse") show(tool.id)(event); }} onPointerLeave={() => setTip(undefined)}
      onFocus={show(tool.id)} onBlur={() => setTip(undefined)} onClick={() => { if (!tool.disabled) tool.onPick(); }}>
      <RailIconImage icon={tool.icon} />
      {tool.key && <kbd className={styles.key} aria-hidden="true">{tool.key}</kbd>}
    </button>)}
    {shown && <div className={styles.tip} role="tooltip" style={{ top: tip.top, left: tip.left }} data-testid="map-project-rail-tip">
      <strong>{shown.label}</strong>{shown.key && <kbd>{shown.key.replace("␣", spaceLabel)}</kbd>}
      {shown.help && <span>{shown.help}</span>}
      {shown.disabled && shown.disabledHelp && <em>{shown.disabledHelp}</em>}
    </div>}
  </div>;
}
