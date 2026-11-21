"use client";

import { useEffect, useRef } from "react";
import { applyEdit } from "@o-tid/course-setting";
import { cancelTool, redo, setTool, undo, type EditorState, type Tool } from "../../lib/course-setting-editor";
import { finishDrawing } from "../../lib/course-setting-specials";

type Change = (change: (current: EditorState) => EditorState) => void;

/** Verktygen med en bokstav (som i Purple Pen). */
const KEYS: Record<string, Tool> = { v: "SELECT", k: "ADD_CONTROL", s: "ADD_START", m: "ADD_FINISH", p: "ADD_CROSSING", l: "INSERT_EXISTING",
  b: "ADD_BEND", n: "NOTE", o: "SPECIAL" };

/**
 * Banläggningens tangenter (inte när man skriver i ett fält): verktygen med en bokstav, Delete, Escape, Enter, ångra och gör
 * om, G för gaffling. Utbrutet ur `course-setting-editor.tsx` (översynen 2026-11-10 G1). Handlingarna läses ur en ref, så att
 * lyssnaren inte behöver läggas om vid varje rendering.
 */
export function useCourseSettingKeys(input: { readOnly: boolean; drawing: () => boolean; apply: Change; edit: Change; onEscape: () => void;
  fork: () => void; togglePalette: () => void;
  /** Delete: ta bort det valda (på en gaffelkontroll frågar banläggningen först, ägaren 2026-11-21). */
  remove: () => void }) {
  const current = useRef(input);
  current.current = input;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const { drawing, apply, edit, onEscape, fork, togglePalette, remove, readOnly } = current.current;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true'], dialog"))) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); }
      else if (event.key === "Escape") { apply(cancelTool); onEscape(); }
      else if (event.key === "Enter" && drawing()) { event.preventDefault(); edit(next => finishDrawing(next, applyEdit)); }
      else if (mod && key === "z") { event.preventDefault(); edit(event.shiftKey ? redo : undo); }
      else if (mod && key === "y") { event.preventDefault(); edit(redo); }
      else if (!mod && !event.altKey && key === "g") fork();
      else if (!mod && !event.altKey && KEYS[key] && (!readOnly || KEYS[key] === "SELECT" || KEYS[key] === "NOTE")) {
        if (KEYS[key] === "SPECIAL") togglePalette();
        else apply(next => setTool(next, KEYS[key]!));
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
}
