"use client";

import { useEffect, useRef, type RefObject } from "react";
import { bindingOf, commandFor, type KeyMap } from "../../lib/map-project-keys";

export type ToolCommand = "select" | "draw" | "circle" | "rectangle" | "bucket" | "addPoint" | "removePoint" | "cut" | "note";
export type SelectedCommand = "simplify" | "smooth" | "switchSymbol" | "checked" | "join" | "reverse" | "pick" | "duplicate" | "fill" | "parallel";
const SELECTED: ReadonlySet<string> = new Set<SelectedCommand>(["simplify", "smooth", "switchSymbol", "checked", "join", "reverse", "pick", "duplicate", "fill", "parallel"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set<ToolCommand>(["draw", "circle", "rectangle", "bucket", "addPoint", "removePoint", "cut"]);
/** Så länge (ms) Markeras tangent ska hållas för att bara låna Markera (släpp = tillbaka till förra verktyget). */
export const HOLD_SELECT_MS = 250;

export interface ShortcutApi {
  readonly keys: KeyMap;
  /** Dialogen Tangenter är öppen: inga kommandon. */
  readonly blocked: boolean;
  readonly canEdit: boolean; readonly canNote: boolean;
  readonly tool: string; readonly hasSelection: boolean; readonly drafting: boolean; readonly multiCount: number;
  /** Mellanslag hålls nere för att dra kartan (`down`); `used` sätts när ett drag gjordes under tiden. */
  readonly panKey: RefObject<{ down: boolean; used: boolean }>;
  readonly undo: () => void; readonly redo: () => void; readonly toggleBare: () => void;
  readonly pickTool: (tool: ToolCommand) => void;
  /** Tillbaka till verktyget man hade när Markeras tangent släpps efter ett håll. */
  readonly restoreTool: (tool: string) => void;
  readonly selectedAction: (command: SelectedCommand) => void;
  /** Gör igen (⇧Mellanslag): den senaste åtgärden på det markerade en gång till. */
  readonly repeat: () => void;
  readonly toggleSnap: () => void;
  /** K8b V5: Visa ofyllda rutor (⇧§). */
  readonly toggleUnfilled: () => void;
  /** [ och ]: Glapp ett steg mindre eller större. */
  readonly gapStep: (direction: 1 | -1) => void;
  /** 1–8: den senaste symbolen med den siffran, utan att byta verktyg. */
  readonly recentKey: (digit: number) => void;
  /** Alt+0–6 tänder eller släcker normens grupp, Alt+Skift visar bara den, Alt+0 tänder allt. */
  readonly layerKey: (digit: number, solo: boolean) => void;
  readonly openWheel: () => void;
  readonly escape: () => void; readonly finishDraft: () => void; readonly dropDraftPoint: () => void; readonly remove: () => void;
}

/**
 * Ritlägets tangenter (utbrutet ur `map-project-editor.tsx`, ägaren 2026-11-10; K8b V1 2026-11-21). Kommandona slås upp i
 * kontots tangenter (`lib/map-project-keys.ts`); fasta är Cmd/Ctrl+Z, Esc, Enter, Delete, Backsteg, 1–8 för de senaste
 * symbolerna, Alt+0–6 för normens grupper och [ ] för Glapp. Håll Markeras tangent för att låna Markera en stund. Mellanslag
 * hålls nere för att dra kartan; ett kort tryck utan drag öppnar hjulet när mellanslag är hjulets tangent. Inget gäller när
 * man skriver i ett fält.
 */
export function useMapProjectShortcuts(api: ShortcutApi) {
  const latest = useRef(api);
  latest.current = api;
  useEffect(() => {
    /** Markeras tangent är nere: när den trycktes och verktyget man hade. */
    let held: { at: number; previous: string; binding: string } | undefined;
    const onKey = (event: KeyboardEvent) => {
      const now = latest.current;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true]"))) return;
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === "z") { event.preventDefault(); if (event.shiftKey) now.redo(); else now.undo(); return; }
      if (command && key === "y") { event.preventDefault(); now.redo(); return; }
      if (command || now.blocked) return;
      if (event.altKey) {
        if (/^Digit[0-6]$/.test(event.code)) { event.preventDefault(); now.layerKey(Number(event.code.slice(5)), event.shiftKey); }
        return;
      }
      const binding = bindingOf(event), bound = commandFor(now.keys, binding);
      if (event.code === "Space" && (!bound || bound === "wheel")) {
        event.preventDefault(); if (!event.repeat) now.panKey.current = { down: true, used: false }; return;
      }
      if (bound === "select") {
        if (!event.repeat) { held = { at: performance.now(), previous: now.tool, binding: binding! }; now.pickTool("select"); }
        return;
      }
      if (bound === "undo") { event.preventDefault(); now.undo(); }
      else if (bound === "redo") { event.preventDefault(); now.redo(); }
      else if (bound === "bare") { event.preventDefault(); now.toggleBare(); }
      else if (bound === "unfilled") { event.preventDefault(); now.toggleUnfilled(); }
      else if (bound && now.canEdit && EDIT_TOOLS.has(bound)) now.pickTool(bound as ToolCommand);
      else if (bound === "note" && now.canNote) now.pickTool("note");
      else if (bound === "repeat") { event.preventDefault(); if (now.canEdit) now.repeat(); }
      else if (bound === "snap") { event.preventDefault(); now.toggleSnap(); }
      else if (bound && SELECTED.has(bound) && (now.hasSelection || now.multiCount > 0) && now.canEdit && now.tool === "select") { event.preventDefault(); now.selectedAction(bound as SelectedCommand); }
      else if (bound === "wheel") { event.preventDefault(); now.openWheel(); }
      else if (/^Digit[1-8]$/.test(event.code) && !event.shiftKey) { event.preventDefault(); now.recentKey(Number(event.code.slice(5))); }
      else if ((event.code === "BracketLeft" || event.code === "BracketRight") && !event.shiftKey) { event.preventDefault(); now.gapStep(event.code === "BracketLeft" ? -1 : 1); }
      else if (event.key === "Escape") now.escape();
      else if (event.key === "Enter" && now.drafting) { event.preventDefault(); now.finishDraft(); }
      else if (event.key === "Backspace" && now.drafting) { event.preventDefault(); now.dropDraftPoint(); }
      else if ((event.key === "Delete" || event.key === "Backspace") && now.canEdit && (now.multiCount > 0 || now.hasSelection)) { event.preventDefault(); now.remove(); }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const now = latest.current;
      // Markeras tangent släppt efter ett håll: tillbaka till verktyget man hade (Skift kan ha släppts först).
      if (held && (bindingOf(event) === held.binding || bindingOf({ ...plain(event), shiftKey: held.binding.startsWith("Shift+") }) === held.binding)) {
        const was = held;
        held = undefined;
        if (performance.now() - was.at >= HOLD_SELECT_MS && was.previous !== "select") now.restoreTool(was.previous);
        return;
      }
      if (event.code !== "Space" || !now.panKey.current.down) return;
      const used = now.panKey.current.used;
      now.panKey.current = { down: false, used: false };
      if (!used && now.keys.wheel === "Space") now.openWheel();
    };
    const onBlur = () => { held = undefined; };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", onBlur); };
  }, []);
}

const plain = (event: KeyboardEvent) => ({ key: event.key, code: event.code, shiftKey: event.shiftKey });
