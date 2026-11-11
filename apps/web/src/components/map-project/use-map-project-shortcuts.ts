"use client";

import { useEffect, useRef, type RefObject } from "react";
import { bindingOf, commandFor, type KeyMap } from "../../lib/map-project-keys";

type ToolCommand = "select" | "draw" | "circle" | "rectangle" | "addPoint" | "removePoint" | "cut" | "note";
export type SelectedCommand = "simplify" | "smooth" | "switchSymbol" | "checked" | "join" | "reverse" | "pick" | "duplicate" | "fill" | "parallel";

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
  readonly selectedAction: (command: SelectedCommand) => void;
  /** R3: 1–6 tänder eller släcker normens grupp, Skift visar bara den, 0 tänder allt. */
  readonly layerKey: (digit: number, solo: boolean) => void;
  readonly openWheel: () => void;
  readonly escape: () => void; readonly finishDraft: () => void; readonly dropDraftPoint: () => void; readonly remove: () => void;
}

/**
 * Ritlägets tangenter (utbrutet ur `map-project-editor.tsx`, ägaren 2026-11-10). Kommandona slås upp i kontots tangenter
 * (`lib/map-project-keys.ts`); fasta är Cmd/Ctrl+Z, Esc, Enter, Delete, Backsteg och 0–6 för normens grupper (Skift: bara den gruppen). Mellanslag
 * hålls nere för att dra kartan; ett kort tryck utan drag öppnar hjulet när mellanslag är hjulets tangent. Inget gäller när
 * man skriver i ett fält.
 */
export function useMapProjectShortcuts(api: ShortcutApi) {
  const latest = useRef(api);
  latest.current = api;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = latest.current;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true]"))) return;
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === "z") { event.preventDefault(); if (event.shiftKey) now.redo(); else now.undo(); return; }
      if (command && key === "y") { event.preventDefault(); now.redo(); return; }
      if (command || now.blocked) return;
      if (event.code === "Space") { event.preventDefault(); if (!event.repeat) now.panKey.current = { down: true, used: false }; return; }
      const bound = commandFor(now.keys, bindingOf(event));
      if (bound === "undo") { event.preventDefault(); now.undo(); }
      else if (bound === "redo") { event.preventDefault(); now.redo(); }
      else if (bound === "bare") { event.preventDefault(); now.toggleBare(); }
      else if (bound === "select") now.pickTool("select");
      else if (bound && now.canEdit && (bound === "draw" || bound === "circle" || bound === "rectangle" || bound === "addPoint" || bound === "removePoint" || bound === "cut")) now.pickTool(bound);
      else if (bound === "note" && now.canNote) now.pickTool("note");
      else if (bound && (now.hasSelection || now.multiCount > 0) && now.canEdit && now.tool === "select"
        && (bound === "simplify" || bound === "smooth" || bound === "switchSymbol" || bound === "checked" || bound === "join" || bound === "reverse" || bound === "pick" || bound === "duplicate" || bound === "fill" || bound === "parallel")) { event.preventDefault(); now.selectedAction(bound); }
      else if (bound === "wheel") { event.preventDefault(); now.openWheel(); }
      else if (/^Digit[0-6]$/.test(event.code) && !event.altKey) { event.preventDefault(); now.layerKey(Number(event.code.slice(5)), event.shiftKey); }
      else if (event.key === "Escape") now.escape();
      else if (event.key === "Enter" && now.drafting) { event.preventDefault(); now.finishDraft(); }
      else if (event.key === "Backspace" && now.drafting) { event.preventDefault(); now.dropDraftPoint(); }
      else if ((event.key === "Delete" || event.key === "Backspace") && now.canEdit && (now.multiCount > 0 || now.hasSelection)) { event.preventDefault(); now.remove(); }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const now = latest.current;
      if (event.code !== "Space" || !now.panKey.current.down) return;
      const used = now.panKey.current.used;
      now.panKey.current = { down: false, used: false };
      if (!used && now.keys.wheel === "Space") now.openWheel();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, []);
}
