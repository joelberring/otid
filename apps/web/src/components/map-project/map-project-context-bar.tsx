"use client";

import type { RefObject } from "react";
import type { Box } from "@o-tid/map-revision";
import type { Viewport } from "../../lib/course-setting-viewport";
import { CONTEXT_GAP_PX, CONTEXT_MULTI_GAP_PX, contextPlacement, type ContextAction, type ContextActionId } from "./map-project-context-actions";
import styles from "./map-project-context-bar.module.css";

/**
 * Flyttar kontextraden till objektets ram (anropas när kartans påtryck ritas, så att raden följer med vid zoom och
 * panorering utan att React ritar om). Utan ram eller utanför rutan göms raden; i telefonen ligger den nederst (CSS).
 */
export function placeContextRow(row: HTMLDivElement | null, box: Box | undefined, view: Viewport, multi = false) {
  if (!row) return;
  const at = box && contextPlacement(box, view, { width: row.offsetWidth, height: row.offsetHeight }, multi ? CONTEXT_MULTI_GAP_PX : CONTEXT_GAP_PX);
  if (!at) { row.removeAttribute("data-placed"); return; }
  row.style.setProperty("--context-x", `${Math.round(at.x)}px`);
  row.style.setProperty("--context-y", `${Math.round(at.y)}px`);
  row.setAttribute("data-placed", "");
}

/**
 * K8b V1 (ägaren 2026-11-21): åtgärderna på det markerade i en rad som flyter vid objektets ram på kartan (ovanför, under
 * om det inte får plats). Bara det som går att använda, och varje knapp visar sin tangent.
 */
export function MapProjectContextBar({ label, actions, rowRef, onAction, spaceLabel, hidden }: { label: string; actions: readonly ContextAction[];
  rowRef: RefObject<HTMLDivElement | null>; onAction: (id: ContextActionId) => void; spaceLabel: string;
  /** Hjulet är öppet (raden ligger kvar med sitt läge men syns inte). */
  hidden?: boolean | undefined }) {
  if (actions.length === 0) return null;
  return <div ref={rowRef} className={styles.row} role="toolbar" aria-label={label} hidden={hidden} data-testid="map-project-context">
    {actions.map(action => <button key={action.id} type="button" className={styles.action} aria-pressed={action.pressed}
      aria-keyshortcuts={action.key?.replace("⇧", "Shift+")} title={[action.key ? `${action.label} (${action.key.replace("␣", spaceLabel)})` : action.label, action.help].filter(Boolean).join(" – ")}
      data-testid={action.testId ?? `map-project-context-${action.id}`} data-action={action.id} onClick={() => onAction(action.id)}>
      <span>{action.label}</span>
      {action.key && <kbd className={styles.key} aria-hidden="true">{action.key.replace("␣", spaceLabel)}</kbd>}
    </button>)}
  </div>;
}
