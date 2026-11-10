"use client";

import type { ReactNode } from "react";
import styles from "./map-project-tool-rail.module.css";

export type RailIcon = "select" | "draw" | "circle" | "area" | "note" | "undo" | "redo" | "panel" | "addPoint" | "removePoint" | "keys";

export interface RailTool {
  readonly id: string; readonly label: string; readonly icon: RailIcon;
  /** Tangenten, visad i ikonens hörn och i tipset. */
  readonly key?: string | undefined;
  /** Tipset utöver namnet och tangenten. */
  readonly help?: string | undefined;
  readonly active?: boolean | undefined; readonly disabled?: boolean | undefined;
  /** Strecket före verktyget (en ny grupp). */
  readonly gap?: boolean | undefined;
  /** Bara på telefonen (panelens knapp). */
  readonly phoneOnly?: boolean | undefined;
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
  keys: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>
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
export function MapProjectToolRail({ label, tools }: { label: string; tools: readonly RailTool[] }) {
  return <div className={styles.rail} role="toolbar" aria-label={label} aria-orientation="vertical" data-testid="map-project-rail">
    {tools.map(tool => <button key={tool.id} type="button" className={styles.tool} aria-label={tool.label} aria-pressed={tool.active}
      disabled={tool.disabled} data-gap={tool.gap || undefined} data-phone={tool.phoneOnly || undefined} data-testid={tool.testId}
      title={[tool.key ? `${tool.label} (${tool.key})` : tool.label, tool.help].filter(Boolean).join(" – ")} onClick={tool.onPick}>
      <RailIconImage icon={tool.icon} />
      {tool.key && <kbd className={styles.key} aria-hidden="true">{tool.key}</kbd>}
    </button>)}
  </div>;
}
