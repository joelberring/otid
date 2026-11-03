"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyEdit, effectivePaper, paperClipPoints, paperLayoutOf, withPaperItem, type CourseSettingDocument, type CourseSettingEdit, type PaperRect,
  type Sheet, type SheetPaperItem
} from "@o-tid/course-setting";
import { anchorRect, movedPaperItem, paperLayoutEdit, paperUndoFor, resizedPaperItem } from "../../lib/course-setting-paper";
import { paperImageUrl } from "../../lib/course-setting-paper-api";
import { CLIP_SELECTION, type PaperInteraction, type PaperSelection } from "./course-setting-paper-items";
import { paperCourses } from "./course-setting-paper-panel";
import { clipWithPoint, type PlacedPaper } from "./course-setting-paper-space";

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

  const savePaper = useCallback(async (edits: CourseSettingEdit[], record = true): Promise<boolean> => {
    const before = current.current;
    if (!before || edits.length === 0) return true;
    let next = before;
    try { next = edits.reduce((doc, edit) => applyEdit(doc, edit).document, before); } catch (error) { console.error("Papperet", error); return false; }
    // Ångra räknas på dokumentet före ändringen och läggs på direkt (Ångra kan tryckas medan ändringen sparas).
    const inverse = record ? paperUndoFor(before, edits) : [];
    if (inverse.length > 0) { undo.current = [...undo.current.slice(-49), inverse]; setUndoCount(undo.current.length); }
    current.current = next;
    pending.current += 1;
    setView(next);
    let ok = false;
    try { ok = await save(edits); } finally { pending.current -= 1; }
    if (!ok && inverse.length > 0) {
      undo.current = undo.current.filter(entry => entry !== inverse);
      setUndoCount(undo.current.length);
    }
    // Inget mer på väg: sidans omlästa dokument gäller (även efter ett misslyckat sparande).
    if (pending.current === 0) setView(undefined);
    return ok;
  }, [save]);

  const onUndo = useCallback(() => {
    const last = undo.current.pop();
    setUndoCount(undo.current.length);
    if (last) void savePaper(last, false);
  }, [savePaper]);

  // Ctrl+Z (Cmd+Z) utanför fälten ångrar papperets senaste ändring.
  useEffect(() => {
    if (!canEdit) return;
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (undo.current.length === 0) return;
      event.preventDefault();
      onUndo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [canEdit, onUndo]);

  const itemOf = (placed: SheetPaperItem) => {
    const doc = current.current;
    return doc ? effectivePaper(doc, placed.course).items.find(row => row.item.id === placed.id)?.item : undefined;
  };
  const putItem = (courseId: string, id: string, next: Parameters<typeof withPaperItem>[3]) => {
    const doc = current.current;
    if (doc) void savePaper([paperLayoutEdit(courseId, withPaperItem(doc, courseId, id, next))]);
  };
  const select = (selection: PaperSelection) => {
    setSelected(selection);
    if (selection) setCourse(selection.course);
  };
  const clip = shown && paperCourse ? effectivePaper(shown, paperCourse).clip : undefined;

  const interaction: PaperInteraction = {
    editable: canEdit, selected, imageUrl: sha => paperImageUrl(raceId, sha), onSelect: select,
    onMove: (sheet, placed, dx, dy) => {
      const item = itemOf(placed);
      if (item) putItem(placed.course, placed.id, movedPaperItem(item, placed, anchorRect(sheet, placed), dx, dy));
    },
    onResize: (sheet, placed, width, height) => {
      const item = itemOf(placed);
      if (item) putItem(placed.course, placed.id, resizedPaperItem(item, placed, anchorRect(sheet, placed), width, height));
    },
    onDelete: placed => { setSelected(undefined); putItem(placed.course, placed.id, null); },
    ...(clip && paperCourse ? { clip: { course: paperCourse, points: paperClipPoints(clip) } } : {}),
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
    return { courses, course: paperCourse, onCourse: (id: string) => setCourse(id), selected, onSelect: select, placed: placedOf(selected), frameOf,
      onSave: (edits: CourseSettingEdit[]) => savePaper(edits), onUndo, canUndo: undoCount > 0 };
  };

  return { view, interaction, panel };
}
