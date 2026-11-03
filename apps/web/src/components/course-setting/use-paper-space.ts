"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdit, effectivePaper, paperClipPoints, paperLayoutOf, withPaperItem, type CourseSettingDocument, type CourseSettingEdit, type PaperClip,
  type PaperRect, type Sheet, type SheetPaperItem
} from "@o-tid/course-setting";
import { anchorRect, movedPaperItem, paperLayoutEdit, paperUndoFor, resizedPaperItem } from "../../lib/course-setting-paper";
import { paperImageUrl } from "../../lib/course-setting-paper-api";
import { CLIP_SELECTION, type PaperInteraction, type PaperSelection } from "./course-setting-paper-items";
import { clipWithPoint, type PlacedPaper } from "./course-setting-paper-space";

/**
 * ADR-0197: papperet i förhandsvisningen. Ändringarna sparas som de andra på utskriftssidan (en i taget, senaste versionen)
 * och visas direkt (dokumentet ändras lokalt först). Ångra (knappen och Ctrl+Z) sparar ändringarna som återställer det
 * som gällde före (`paperUndoFor`), de senaste 50.
 */
export function usePaperSpace({ raceId, document, setDocument, save, sheets, canEdit, courses }: {
  raceId: string; document: CourseSettingDocument | null | undefined;
  setDocument: (update: (current: CourseSettingDocument | null | undefined) => CourseSettingDocument | null | undefined) => void;
  save: (edits: CourseSettingEdit[]) => Promise<boolean>; sheets: readonly { sheet: Sheet }[]; canEdit: boolean;
  courses: readonly { id: string; name: string }[];
}) {
  const [course, setCourse] = useState<string>();
  const [selected, setSelected] = useState<PaperSelection>();
  const [undoCount, setUndoCount] = useState(0);
  const undo = useRef<CourseSettingEdit[][]>([]);
  const current = useRef(document);
  current.current = document;
  const paperCourse = course && courses.some(row => row.id === course) ? course : courses[0]?.id;

  const apply = useCallback((edits: CourseSettingEdit[]) => setDocument(value => {
    if (!value) return value;
    try { return edits.reduce((doc, edit) => applyEdit(doc, edit).document, value); } catch (error) { console.error("Papperet", error); return value; }
  }), [setDocument]);

  const savePaper = useCallback(async (edits: CourseSettingEdit[], record = true): Promise<boolean> => {
    const before = current.current;
    if (!before || edits.length === 0) return true;
    const inverse = paperUndoFor(before, edits);
    apply(edits);
    const ok = await save(edits);
    if (ok && record && inverse.length > 0) {
      undo.current = [...undo.current.slice(-49), inverse];
      setUndoCount(undo.current.length);
    }
    return ok;
  }, [apply, save]);

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

  const itemOf = useCallback((placed: SheetPaperItem) => {
    const doc = current.current;
    return doc ? effectivePaper(doc, placed.course).items.find(row => row.item.id === placed.id)?.item : undefined;
  }, []);
  const putItem = useCallback((courseId: string, id: string, next: Parameters<typeof withPaperItem>[3]) => {
    const doc = current.current;
    if (!doc) return;
    void savePaper([paperLayoutEdit(courseId, withPaperItem(doc, courseId, id, next))]);
  }, [savePaper]);

  const placedOf = useCallback((target: PaperSelection): PlacedPaper | undefined => {
    if (!target) return undefined;
    for (const { sheet } of sheets) {
      const item = sheet.paperItems?.find(row => row.course === target.course && row.id === target.id);
      if (item) return { sheet, item };
    }
    return undefined;
  }, [sheets]);
  const frameOf = useCallback((courseId: string): PaperRect | undefined => {
    for (const { sheet } of sheets) { const frame = sheet.frames.find(row => row.course === courseId); if (frame) return frame.clip; }
    return undefined;
  }, [sheets]);

  const clip: PaperClip | undefined = document && paperCourse ? effectivePaper(document, paperCourse).clip : undefined;
  const select = useCallback((selection: PaperSelection) => {
    setSelected(selection);
    if (selection) setCourse(selection.course);
  }, []);
  const interaction = useMemo<PaperInteraction>(() => ({
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
  }), [canEdit, selected, raceId, select, itemOf, putItem, clip, paperCourse, savePaper]);

  return {
    interaction,
    panel: paperCourse ? { course: paperCourse, onCourse: (id: string) => setCourse(id), selected, onSelect: select,
      placed: selected && selected.id !== CLIP_SELECTION ? placedOf(selected) : undefined, frameOf, onSave: (edits: CourseSettingEdit[]) => savePaper(edits),
      onUndo, canUndo: undoCount > 0 } : undefined
  };
}
