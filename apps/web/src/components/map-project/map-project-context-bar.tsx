"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { Box } from "@o-tid/map-revision";
import type { Viewport } from "../../lib/course-setting-viewport";
import { CONTEXT_GAP_PX, CONTEXT_MULTI_GAP_PX, contextPlacement, type ContextAction, type ContextActionId } from "./map-project-context-actions";
import styles from "./map-project-context-bar.module.css";

const CONTEXT_ROW_KEY = "otid-map-context-row";
const PHONE = "(max-width: 760px)";
function subscribePhone(callback: () => void) {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
/** Telefonens bredd (samma gräns som kartsidans CSS). På servern: bred. */
export function usePhoneWidth(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
}

/**
 * Ägaren 2026-11-23 («stressande att denna meny kommer upp varje gång man trycker på ett objekt»): om åtgärdsraden flyter vid
 * det markerade. Av som förval; sparas i webbläsaren (tangentdialogen).
 */
export function useContextRowSetting(): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => { try { setOn(localStorage.getItem(CONTEXT_ROW_KEY) === "on"); } catch { /* utan lagring: av */ } }, []);
  const save = useCallback((next: boolean) => { setOn(next); try { localStorage.setItem(CONTEXT_ROW_KEY, next ? "on" : "off"); } catch { /* utan lagring */ } }, []);
  return [on, save];
}

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
 * om det inte får plats). Bara det som går att använda, och varje knapp visar sin tangent. Sedan 2026-11-23 bara med
 * inställningen «Visa åtgärdsraden vid det markerade»; i telefonen alltid, som en smal rad nederst.
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

/**
 * Ägaren 2026-11-23: åtgärderna i statusraden när raden vid det markerade är av. «Åtgärder ▾» öppnar samma lista som hjulet
 * (de vanligaste först, med tangenterna); Esc eller ett klick utanför stänger.
 */
export function MapProjectActionsMenu({ label, actions, onAction, spaceLabel }: { label: string; actions: readonly ContextAction[];
  onAction: (id: ContextActionId) => void; spaceLabel: string }) {
  // Statusraden klipper det som sticker ut, så listan står fast i fönstret ovanför knappen.
  const [open, setOpen] = useState<{ left: number; bottom: number }>();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(undefined); } };
    const onDown = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(undefined); };
    window.addEventListener("keydown", onKey, true); window.addEventListener("pointerdown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onDown, true); };
  }, [open]);
  if (actions.length === 0) return null;
  return <div ref={box} className={styles.menu}>
    <button type="button" className={styles.menuButton} aria-haspopup="menu" aria-expanded={!!open} data-testid="map-project-actions"
      onClick={event => { const rect = event.currentTarget.getBoundingClientRect();
        setOpen(value => value ? undefined : { left: rect.left, bottom: window.innerHeight - rect.top + 4 }); }}>{label} <span aria-hidden="true">▾</span></button>
    {open && <div role="menu" className={styles.menuList} aria-label={label} style={{ left: open.left, bottom: open.bottom }}>
      {actions.map(action => <button key={action.id} type="button" role="menuitem" className={styles.action} aria-pressed={action.pressed}
        aria-keyshortcuts={action.key?.replace("⇧", "Shift+")} title={action.help}
        data-testid={action.testId ?? `map-project-context-${action.id}`} data-action={action.id} onClick={() => { setOpen(undefined); onAction(action.id); }}>
        <span>{action.label}</span>
        {action.key && <kbd className={styles.key} aria-hidden="true">{action.key.replace("␣", spaceLabel)}</kbd>}
      </button>)}
    </div>}
  </div>;
}
