"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyEdit, effectivePaper, paperClipPoints, paperLayoutOf, shapePoints, withPaperItem, type CourseSettingDocument, type CourseSettingEdit, type PaperRect,
  type Sheet, type SheetPaperItem
} from "@o-tid/course-setting";
import { anchorRect, movedPaperItem, paperLayoutEdit, paperUndoFor, resizedPaperItem } from "../../lib/course-setting-paper";
import { paperImageUrl } from "../../lib/course-setting-paper-api";
import { CLIP_SELECTION, type PaperInteraction, type PaperSelection } from "./course-setting-paper-items";
import { paperCourses } from "./course-setting-paper-panel";
import { clipWithPoint, shapeWithPoint, type PlacedPaper } from "./course-setting-paper-space";

/**
 * ADR-0197: papperet i förhandsvisningen. Ändringarna sparas som de andra på utskriftssidan (en i taget, senaste versionen)
 * och visas direkt: medan papperets ändringar sparas visar sidan `view` (dokumentet med dem) i stället för det som lästes om
 * från servern efter ett tidigare sparande. Ångra (knappen och Ctrl+Z) sparar ändringarna som återställer det som gällde
 * före (`paperUndoFor`), de senaste 50.
 */
export function usePaperSpace({ raceId, document, save, canEdit, chosen }: {
  raceId: string; document: CourseSettingDocument | null | undefined;
  save: (edits: CourseSettingEdit[]) => Promise<boolean>; canEdit: boolean; chosen: readonly string[];
}) {
  const [course, setCourse] = useState<string>();
  const [selected, setSelected] = useState<PaperSelection>();
  // ADR-0211 beslut 8: fler markerade (Skift-klick, ruta på tomt papper); `selected` är det första (fälten i panelen).
  const [extra, setExtra] = useState<readonly { course: string; id: string }[]>([]);
  const [snap, setSnap] = useState<{ enabled: boolean; gridMm: number }>({ enabled: true, gridMm: 0 });
  const [undoCount, setUndoCount] = useState(0);
  const [view, setView] = useState<CourseSettingDocument>();
  const undo = useRef<CourseSettingEdit[][]>([]);
  const pending = useRef(0);
  // Dokumentet som ändringarna räknas på: det lokala medan något sparas, annars det som sidan läst.
  const current = useRef<CourseSettingDocument | null | undefined>(document);
  if (pending.current === 0) current.current = document;
  const shown = view ?? document;
  const courses = shown ? paperCourses(shown, chosen) : [];
  const paperCourse = course && courses.some(row => row.id === course) ? course : courses[0]?.id;

  const redo = useRef<CourseSettingEdit[][]>([]);
  const [redoCount, setRedoCount] = useState(0);
  /** `mode`: DO = ny ändring (ångra-stacken, gör om töms), UNDO = ångrar (gör om får motsatsen), REDO = gör om (ångra får motsatsen). */
  const savePaper = useCallback(async (edits: CourseSettingEdit[], mode: boolean | "DO" | "UNDO" | "REDO" = "DO"): Promise<boolean> => {
    const kind = mode === true ? "DO" : mode === false ? "UNDO" : mode;
    const before = current.current;
    if (!before || edits.length === 0) return true;
    let next = before;
    try { next = edits.reduce((doc, edit) => applyEdit(doc, edit).document, before); } catch (error) { console.error("Papperet", error); return false; }
    // Ångra räknas på dokumentet före ändringen och läggs på direkt (Ångra kan tryckas medan ändringen sparas).
    const inverse = paperUndoFor(before, edits);
    const stack = kind === "UNDO" ? redo : undo;
    if (inverse.length > 0) { stack.current = [...stack.current.slice(-49), inverse]; }
    if (kind === "DO") redo.current = [];
    setUndoCount(undo.current.length); setRedoCount(redo.current.length);
    current.current = next;
    pending.current += 1;
    setView(next);
    let ok = false;
    try { ok = await save(edits); } finally { pending.current -= 1; }
    if (!ok && inverse.length > 0) {
      stack.current = stack.current.filter(entry => entry !== inverse);
      setUndoCount(undo.current.length); setRedoCount(redo.current.length);
    }
    // Inget mer på väg: sidans omlästa dokument gäller (även efter ett misslyckat sparande).
    if (pending.current === 0) setView(undefined);
    return ok;
  }, [save]);

  const onUndo = useCallback(() => {
    const last = undo.current.pop();
    setUndoCount(undo.current.length);
    if (last) void savePaper(last, "UNDO");
  }, [savePaper]);
  const onRedo = useCallback(() => {
    const last = redo.current.pop();
    setRedoCount(redo.current.length);
    if (last) void savePaper(last, "REDO");
  }, [savePaper]);

  // Ctrl+Z (Cmd+Z) utanför fälten ångrar papperets senaste ändring; Ctrl+Skift+Z och Ctrl+Y gör om.
  useEffect(() => {
    if (!canEdit) return;
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const letter = event.key.toLowerCase();
      const isRedo = (letter === "z" && event.shiftKey) || letter === "y";
      if (letter !== "z" && !isRedo) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if ((isRedo ? redo : undo).current.length === 0) return;
      event.preventDefault();
      if (isRedo) onRedo(); else onUndo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [canEdit, onUndo, onRedo]);

  const itemOf = (placed: SheetPaperItem) => {
    const doc = current.current;
    return doc ? effectivePaper(doc, placed.course).items.find(row => row.item.id === placed.id)?.item : undefined;
  };
  const putItem = (courseId: string, id: string, next: Parameters<typeof withPaperItem>[3]) => {
    const doc = current.current;
    if (doc) void savePaper([paperLayoutEdit(courseId, withPaperItem(doc, courseId, id, next))]);
  };
  const select = (selection: PaperSelection, additive = false) => {
    if (additive && selection && selected && selection.id !== CLIP_SELECTION && selected.id !== CLIP_SELECTION) {
      const key = (row: { course: string; id: string }) => `${row.course}:${row.id}`;
      const all = [selected, ...extra];
      const exists = all.some(row => key(row) === key(selection));
      const next = exists ? all.filter(row => key(row) !== key(selection)) : [...all, selection];
      setSelected(next[0]); setExtra(next.slice(1));
      return;
    }
    setSelected(selection); setExtra([]);
    if (selection) setCourse(selection.course);
  };
  const selectMany = (list: readonly { course: string; id: string }[]) => {
    setSelected(list[0]); setExtra(list.slice(1));
    if (list[0]) setCourse(list[0].course);
  };
  const selection = selected && selected.id !== CLIP_SELECTION ? [selected, ...extra] : [];
  /** Flera element flyttade samtidigt (gruppen, justering): en ändring per bana. */
  const moveMany = (sheet: Sheet, moves: readonly { placed: SheetPaperItem; dx: number; dy: number }[]) => {
    let doc = current.current;
    if (!doc) return;
    const edits = new Map<string, CourseSettingEdit>();
    for (const { placed, dx, dy } of moves) {
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
      const item = effectivePaper(doc, placed.course).items.find(row => row.item.id === placed.id)?.item;
      if (!item || item.locked) continue;
      const edit = paperLayoutEdit(placed.course, withPaperItem(doc, placed.course, placed.id, movedPaperItem(item, placed, anchorRect(sheet, placed), dx, dy)));
      doc = applyEdit(doc, edit).document;
      edits.set(placed.course, edit);
    }
    if (edits.size > 0) void savePaper([...edits.values()]);
  };
  const clip = shown && paperCourse ? effectivePaper(shown, paperCourse).clip : undefined;
  const white = shown && paperCourse ? effectivePaper(shown, paperCourse).whiteAreas : undefined;

  const interaction: PaperInteraction = {
    editable: canEdit, selected, selection, imageUrl: sha => paperImageUrl(raceId, sha), onSelect: select, onSelectMany: selectMany, snap,
    onMove: (sheet, placed, dx, dy) => {
      // Flyttas ett av de markerade flyttas alla markerade på arket (gruppen).
      const key = `${placed.course}:${placed.id}`;
      const group = selection.some(row => `${row.course}:${row.id}` === key) && selection.length > 1
        ? (sheet.paperItems ?? []).filter(item => selection.some(row => row.course === item.course && row.id === item.id)) : [placed];
      moveMany(sheet, group.map(item => ({ placed: item, dx, dy })));
    },
    textOf: placed => { const item = itemOf(placed); return item?.kind === "TEXT" ? item.text : undefined; },
    onText: (placed, value) => {
      const item = itemOf(placed);
      if (item?.kind === "TEXT" && item.text !== value) putItem(placed.course, placed.id, { ...item, text: value });
    },
    onResize: (sheet, placed, width, height) => {
      const item = itemOf(placed);
      if (item) putItem(placed.course, placed.id, resizedPaperItem(item, placed, anchorRect(sheet, placed), width, height));
    },
    onDelete: placed => {
      setSelected(undefined); setExtra([]);
      const doc = current.current;
      if (!doc) return;
      // Delete tar bort alla markerade.
      const targets = selection.length > 1 ? selection : [placed];
      let next = doc;
      const edits = new Map<string, CourseSettingEdit>();
      for (const target of targets) {
        const edit = paperLayoutEdit(target.course, withPaperItem(next, target.course, target.id, null));
        next = applyEdit(next, edit).document;
        edits.set(target.course, edit);
      }
      void savePaper([...edits.values()]);
    },
    ...(clip && paperCourse ? { clip: { course: paperCourse, points: paperClipPoints(clip) } } : {}),
    // "Vitt på utskriften": den markerade ytans hörn dras på arket.
    ...(white && paperCourse ? { white: { course: paperCourse, areas: white.map(shapePoints) } } : {}),
    onWhitePoint: (area, index, point) => {
      const doc = current.current;
      if (!doc || !paperCourse) return;
      const areas = effectivePaper(doc, paperCourse).whiteAreas;
      const target = areas[area];
      if (!target) return;
      const next = areas.map((row, i) => i === area ? shapeWithPoint(row, index, point) : row);
      void savePaper([paperLayoutEdit(paperCourse, { ...paperLayoutOf(doc, paperCourse), whiteAreas: next })]);
    },
    onClipPoint: (index, point) => {
      const doc = current.current;
      if (!doc || !paperCourse || !clip) return;
      void savePaper([paperLayoutEdit(paperCourse, { ...paperLayoutOf(doc, paperCourse), clip: clipWithPoint(clip, index, point) })]);
    }
  };

  /** Panelens egenskaper för arken som visas (markerat element och banans första ram). */
  const panel = (sheets: readonly { sheet: Sheet }[]) => {
    if (!paperCourse) return undefined;
    const placedOf = (target: PaperSelection): PlacedPaper | undefined => {
      if (!target || target.id === CLIP_SELECTION) return undefined;
      for (const { sheet } of sheets) {
        const item = sheet.paperItems?.find(row => row.course === target.course && row.id === target.id);
        if (item) return { sheet, item };
      }
      return undefined;
    };
    const frameOf = (courseId: string): PaperRect | undefined => {
      for (const { sheet } of sheets) { const frame = sheet.frames.find(row => row.course === courseId); if (frame) return frame.clip; }
      return undefined;
    };
    const placedAll = selection.flatMap(target => { const found = placedOf(target); return found ? [found] : []; });
    return { courses, course: paperCourse, onCourse: (id: string) => setCourse(id), selected, onSelect: select, placed: placedOf(selected), frameOf,
      onSave: (edits: CourseSettingEdit[]) => savePaper(edits), onUndo, canUndo: undoCount > 0, onRedo, canRedo: redoCount > 0,
      // ADR-0211 beslut 8: de markerade på arket (justera, fördela), fästningen och rutnätet.
      marked: placedAll, onMoveMany: moveMany, snap, onSnap: setSnap };
  };

  return { view, interaction, panel };
}
