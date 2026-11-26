"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapProjectView } from "@o-tid/contracts";
import type { MapTextSymbolChange, Point } from "@o-tid/map-file";
import { newKey, type EditKind, type ObjectKey, type ObjectRef } from "@o-tid/map-revision";
import { mapProjectTextEn } from "../../i18n/map-project-text-en";
import { mapProjectTextSv } from "../../i18n/map-project-text-sv";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import type { CatalogSymbol } from "../../lib/map-project-protocol";
import {
  editTextDraft, EMPTY_STYLE_HISTORY, finishText, newTextDraft, recordStyle, redoStyle, textSymbolFor, undoStyle, type StyleHistory, type TextDraft,
  type TextObject
} from "../../lib/map-project-text";
import { useTexts } from "../language-provider";

type Save = (key: ObjectKey, ref: ObjectRef | null, object: TextObject, kind: EditKind) => boolean;

/**
 * K8b V6 (ägaren 2026-11-22): textverktyget (B), textfältet på kartan och projektets textsymboler, utbrutet ur editorn. Logiken
 * ligger i `lib/map-project-text.ts`; här finns lägena, sparandet och Ångra/Gör om där textsymbolernas steg och objektens
 * steg går i den ordning de gjordes.
 */
export function useMapProjectText(input: {
  view: MapProjectView; canEdit: boolean; catalog: readonly CatalogSymbol[]; symbols: ReadonlyMap<string, CatalogSymbol>;
  symbol: CatalogSymbol | undefined; recent: readonly string[]; chooseSymbol: (id: string) => void; save: Save; say: (message: string) => void;
  /** Rita kartan med textsymbolerna (sparade eller i dialogen). */
  show: (changes: readonly MapTextSymbolChange[]) => void;
  objects: { readonly undo: number; readonly redo: number }; undo: () => void; redo: () => void;
}) {
  const text = useTexts(mapProjectTextSv, mapProjectTextEn);
  const { view, symbols, say } = input;
  const [draft, setDraft] = useState<TextDraft>();

  /** B: textverktyget med en textsymbol (den valda, senast använda eller kartans första). Falskt när kartan saknar textsymbol. */
  const start = (): CatalogSymbol | undefined => {
    const chosen = textSymbolFor(input.symbol, input.recent, input.catalog);
    if (!chosen) { say(text.noTextSymbol); return undefined; }
    if (chosen.id !== input.symbol?.id) { input.chooseSymbol(chosen.id); say(text.picked(chosen.code)); }
    return chosen;
  };
  const place = (at: Point) => {
    if (!input.canEdit) return;
    const chosen = input.symbol?.kind === "text" ? input.symbol : start();
    if (chosen) setDraft(newTextDraft(at, chosen.id));
  };
  const edit = (target: { key: ObjectKey; ref: ObjectRef | null; object: TextObject }) => { if (input.canEdit) setDraft(editTextDraft(target)); };
  const commit = (value: string) => {
    const current = draft;
    setDraft(undefined);
    if (!current) return;
    const done = finishText(current, value);
    if (!done) return;
    if (input.save(current.target?.key ?? newKey(crypto.randomUUID()), current.target?.ref ?? null, done.object, done.kind)) say(done.kind === "ADD" ? text.added : text.changed);
  };

  // Projektets textsymboler.
  const base = mapProjectBase(view.projectId);
  const canChange = view.viewer.canDecide;
  const [saved, setSaved] = useState<readonly MapTextSymbolChange[]>(view.textSymbols);
  const savedRef = useRef(saved);
  const [history, setHistory] = useState<StyleHistory>(EMPTY_STYLE_HISTORY);
  const historyRef = useRef(history);
  const objectsRef = useRef(input.objects);
  objectsRef.current = input.objects;
  /** Symbolen i dialogen Ändra textsymbol. */
  const [open, setOpen] = useState<string>();
  const { show } = input;
  const put = useCallback(async (next: readonly MapTextSymbolChange[]): Promise<boolean> => {
    if (!canChange) return false;
    const result = await clubRequest(base, "PUT", { formatVersion: 1, textSymbols: next }).catch(() => ({ status: 0 }));
    if (result.status !== 200 && result.status !== 204) return false;
    savedRef.current = next;
    setSaved(next);
    show(next);
    return true;
  }, [base, canChange, show]);
  const keep = (next: StyleHistory) => { historyRef.current = next; setHistory(next); };
  const saveStyles = async (next: readonly MapTextSymbolChange[]): Promise<boolean> => {
    const before = savedRef.current;
    const ok = await put(next);
    if (ok) keep(recordStyle(historyRef.current, before, next, objectsRef.current));
    return ok;
  };
  const step = (direction: "undo" | "redo") => {
    const outcome = (direction === "undo" ? undoStyle : redoStyle)(historyRef.current, objectsRef.current);
    if (!outcome) { (direction === "undo" ? input.undo : input.redo)(); return; }
    keep(outcome.history);
    void put(outcome.changes).then(ok => say(ok ? (direction === "undo" ? text.undone : text.redone) : text.failed));
  };
  // Utan rätt att rita stängs textfältet.
  useEffect(() => { if (!input.canEdit) setDraft(undefined); }, [input.canEdit]);

  return {
    draft, draftStyle: draft ? symbols.get(draft.symbol)?.text : undefined, start, place, edit, commit, cancel: () => setDraft(undefined),
    hint: input.symbol?.kind === "text" ? text.hint(input.symbol.code) : text.noTextSymbol,
    styles: { saved, canChange, open, setOpen, save: saveStyles, show },
    undo: () => step("undo"), redo: () => step("redo"),
    canUndo: input.objects.undo > 0 || history.undo.length > 0, canRedo: input.objects.redo > 0 || history.redo.length > 0,
    labels: { edit: text.edit, rotate: text.rotate, style: text.style, switchTo: text.switchTo }
  };
}

export type MapProjectText = ReturnType<typeof useMapProjectText>;
