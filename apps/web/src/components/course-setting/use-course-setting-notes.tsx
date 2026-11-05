"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CourseSettingLevel, CourseSettingNote, CourseSettingNoteKind, CourseSettingNoteTarget } from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { notesSv } from "../../i18n/course-setting-notes-sv";
import { offlineSv } from "../../i18n/course-setting-offline-sv";
import { editCourseSettingNote, replyCourseSettingNote, setCourseSettingNoteStatus } from "../../lib/course-setting-api";
import type { QueuedItem } from "../../lib/course-setting-offline";
import { filterNotes, noteInView, noteMarks, notePosition, type NoteFilter, type NoteKindFilter } from "../../lib/course-setting-note-marks";
import {
  addClickPoint, cancelStroke, createSketch, endStroke, extendStroke, finishShape, sketchBounds, sketchPreview, sketchShapes, startStroke,
  undoSketch, type SketchDraft
} from "../../lib/course-setting-sketch";
import type { CourseSettingMapHandle, MapPointerHandlers, SketchLayer } from "./course-setting-map";
import { NoteForm, NotesPanel, type NotePhoto } from "./course-setting-notes";
import { editOutcome } from "./note-text";
import { useNarrow } from "./course-setting-field";
import { SketchBar } from "./course-setting-sketch-bar";
import type { CourseSettingOffline } from "./use-course-setting-offline";

/**
 * Notiserna i editorn (ADR-0181 beslut 1 och 8), samlade här så att editorn bara kopplar in dem: väntande i telefonens kö,
 * borttagna (också de som väntar i kön), filtret som listan och kartan delar (öppna/klara/alla och slag), en ny notis
 * (verktyget Notis, en bana eller en ritning), ritläget och listan i lådan.
 *
 * Ritläget tar över kartans tryck (`handlers`): ett finger eller musen ritar, två fingrar, hjulet och piltangenterna
 * flyttar kartan. Enter avslutar linjen, Ctrl+Z ångrar i ritningen (inte i banorna) och Escape avbryter.
 */
export interface NotesInput {
  readonly raceId: string;
  readonly document: CourseSettingDocument;
  readonly view: string;
  readonly allControls: string;
  readonly controlsInView: ReadonlySet<string>;
  readonly serverNotes: readonly CourseSettingNote[];
  readonly reloadNotes: () => Promise<void>;
  readonly offline: CourseSettingOffline;
  /** Kontrollen finns på servern (en notis på en ny osparad kontroll fästs vid punkten). */
  readonly saved: (control: string) => boolean;
  readonly access: { readonly accountId: string; readonly displayName: string | null; readonly level: CourseSettingLevel };
  readonly say: (message: { tone: "ok" | "error" | "attention"; text: string }) => void;
  readonly map: React.RefObject<CourseSettingMapHandle | null>;
  readonly readOnlyCourse: boolean;
}

type Draft = { readonly target: CourseSettingNoteTarget; readonly kind: CourseSettingNoteKind };

export function useCourseSettingNotes(input: NotesInput) {
  const { raceId, document, view, offline, access, say } = input;
  const [showNotes, setShowNotes] = useState(true);
  const [selectedNote, setSelectedNote] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [filter, setFilter] = useState<NoteFilter>("OPEN");
  const [kindFilter, setKindFilter] = useState<NoteKindFilter>("ALL");
  const [sketch, setSketch] = useState<{ draft: SketchDraft; kind: CourseSettingNoteKind }>();
  const narrow = useNarrow();

  // Steg 67: notiser som väntar i telefonens kö visas också (märkta "väntar på nät"); borttagna i kön syns inte.
  const me = { accountId: access.accountId, displayName: access.displayName };
  const pendingNotes = useMemo(() => offline.queue.flatMap((item): CourseSettingNote[] => item.kind !== "note" ? [] : [{ id: item.id,
    target: item.request.target, kind: item.request.kind ?? "COURSE_SETTING", at: item.request.at, course: item.request.course,
    text: item.request.text, status: "OPEN", createdAt: item.createdAt, createdBy: me, resolvedAt: null, resolvedBy: null, photo: null,
    replies: [] }]), [offline.queue]);
  const pendingIds = useMemo(() => new Set(pendingNotes.map(note => note.id)), [pendingNotes]);
  const removed = useMemo(() => {
    const deletes = offline.queue.flatMap(item => item.kind === "note-delete" ? [item.request] : []);
    return { notes: new Set(deletes.filter(row => !row.replyId).map(row => row.noteId)),
      replies: new Set(deletes.flatMap(row => row.replyId ? [row.replyId] : [])) };
  }, [offline.queue]);
  const all = useMemo(() => [...input.serverNotes, ...pendingNotes].filter(note => !removed.notes.has(note.id))
    .map(note => note.replies.some(reply => removed.replies.has(reply.id)) ? { ...note, replies: note.replies.filter(reply => !removed.replies.has(reply.id)) } : note),
  [input.serverNotes, pendingNotes, removed]);
  const notesInView = useMemo(() => all.filter(note => noteInView(note, view, input.controlsInView)), [all, view, input.controlsInView]);
  // Kartan visar samma som listan (förval öppna; klara går att visa) och alltid den valda.
  const onMap = useMemo(() => showNotes ? notesInView.filter(note => note.id === selectedNote
    || filterNotes([note], filter, kindFilter).length > 0) : [], [showNotes, notesInView, selectedNote, filter, kindFilter]);
  const mapNotes = useMemo(() => noteMarks(onMap, document), [onMap, document]);
  const sketchLayer = useMemo<SketchLayer>(() => ({
    notes: onMap.flatMap(note => note.target.kind === "SKETCH" ? [{ id: note.id, shapes: note.target.shapes, done: note.status === "DONE" }] : []),
    draft: sketch ? sketchPreview(sketch.draft) : undefined
  }), [onMap, sketch]);

  /**
   * Steg 67: en notis går alltid genom kön i telefonen (skickas direkt med nät, annars när nätet kommer). En notis på en
   * ny kontroll som inte är sparad än fästs vid punkten. Ett kartfel hör inte till någon bana.
   */
  async function queueNote(target: CourseSettingNoteTarget, at: { x: number; y: number } | null, value: string, photo: NotePhoto | null,
    kind: CourseSettingNoteKind = "COURSE_SETTING"): Promise<void> {
    const fixed: CourseSettingNoteTarget = target.kind === "CONTROL" && !input.saved(target.control) && at ? { kind: "POINT", at }
      : target.kind === "LEG" && (!input.saved(target.from) || !input.saved(target.to)) && at ? { kind: "POINT", at } : target;
    const course = kind === "MAP_ERROR" ? null : fixed.kind === "COURSE" ? fixed.course : view === input.allControls ? null : view;
    await offline.enqueueNote({ requestId: crypto.randomUUID(), target: fixed, at: fixed.kind === "SKETCH" ? null : at, course, text: value, photo,
      ...(kind === "MAP_ERROR" ? { kind } : {}) });
  }
  async function saveNote(values: { text: string; photo: NotePhoto | null; kind: CourseSettingNoteKind }): Promise<boolean> {
    if (!draft) return false;
    try {
      await queueNote(draft.target, notePosition({ target: draft.target, at: null }, document) ?? null, values.text, values.photo, values.kind);
      setDraft(undefined);
      if (offline.offline) say({ tone: "ok", text: offlineSv.noteHere.queued });
      return true;
    } catch (error) { console.error("Notisen sparades inte i telefonen", error); return false; }
  }

  /** Ta bort: alltid genom kön (som en ny notis), efter en bekräftelse. */
  async function remove(note: CourseSettingNote, replyId?: string) {
    if (!window.confirm(replyId ? notesSv.deleteReplyConfirm : notesSv.deleteConfirm)) return;
    try {
      await offline.enqueueDelete({ noteId: note.id, ...(replyId ? { replyId } : {}) });
      if (!replyId && selectedNote === note.id) setSelectedNote(undefined);
      if (offline.offline) say({ tone: "ok", text: notesSv.deleteQueued });
    } catch (error) { console.error("Borttagningen sparades inte i telefonen", error); say({ tone: "error", text: notesSv.deleteFailed }); }
  }
  const canDelete = (createdBy: string) => createdBy === access.accountId || access.level === "EDIT";

  function startSketch(kind: CourseSettingNoteKind) {
    setDraft(undefined); setSelectedNote(undefined);
    setSketch({ draft: createSketch(kind === "MAP_ERROR" ? "MAP_ERROR" : "GENERAL"), kind });
  }
  function finishSketch() {
    if (!sketch) return;
    const shapes = sketchShapes(sketch.draft);
    if (!shapes) { say({ tone: "attention", text: notesSv.sketch.empty }); return; }
    setDraft({ target: { kind: "SKETCH", shapes: [...shapes] }, kind: sketch.kind });
    setSketch(undefined);
  }
  function cancelSketch() {
    if (sketch && sketch.draft.shapes.length > 0 && !window.confirm(notesSv.sketch.cancelConfirm)) return;
    setSketch(undefined);
  }
  const change = (next: (current: SketchDraft) => SketchDraft) => setSketch(current => current ? { ...current, draft: next(current.draft) } : current);

  // Ritlägets tryck: mm per skärmpixel räknas ur träffytan (8 px med mus, 18 px med finger, `course-setting-map`).
  const unit = useRef(0.1);
  const handlers: MapPointerHandlers = {
    onTap: point => change(current => addClickPoint(current, point)),
    onDragStart: (point, tolerance, pointerType) => {
      unit.current = tolerance / (pointerType === "touch" ? 18 : 8);
      change(current => startStroke(current, point));
      return true;
    },
    onDragMove: point => change(current => extendStroke(current, point, 2 * unit.current)),
    onDragEnd: () => change(current => endStroke(current, 1.5 * unit.current)),
    onDragCancel: () => change(cancelStroke),
    unlifted: true
  };
  // Tangenterna i ritläget (före editorns, som annars ångrar i banorna).
  const sketching = sketch !== undefined;
  const latest = useRef({ finishSketch, cancelSketch });
  latest.current = { finishSketch, cancelSketch };
  useEffect(() => {
    if (!sketching) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], dialog")) return;
      const key = event.key.toLowerCase();
      const undo = (event.ctrlKey || event.metaKey) && key === "z";
      if (event.key === "Enter") change(current => current.current ? finishShape(current) : current);
      else if (undo || event.key === "Backspace" || event.key === "Delete") change(undoSketch);
      else if (event.key === "Escape") latest.current.cancelSketch();
      else if (!(event.ctrlKey || event.metaKey) && /^[a-zåäö]$/.test(key)) { /* verktygens bokstäver gäller inte medan man ritar */ }
      else return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", keydown, { capture: true });
    return () => window.removeEventListener("keydown", keydown, { capture: true });
  }, [sketching]);

  const card: ReactNode = sketch ? <SketchBar draft={sketch.draft} kind={sketch.kind} compact={narrow} onChange={next => change(() => next)}
    onDone={finishSketch} onCancel={cancelSketch} />
    : draft ? <NoteForm key={JSON.stringify(draft.target).slice(0, 200)} target={draft.target} kind={draft.kind} document={document} onSave={saveNote}
      onCancel={() => setDraft(undefined)} /> : undefined;

  const panel = <NotesPanel raceId={raceId} notes={notesInView} pending={pendingIds} document={document} show={showNotes} onShow={setShowNotes}
    selected={selectedNote} onSelect={setSelectedNote} view={view} filter={filter} onFilter={setFilter} kind={kindFilter} onKind={setKindFilter}
    readOnlyCourse={input.readOnlyCourse}
    onReveal={note => {
      const bounds = note.target.kind === "SKETCH" ? sketchBounds(note.target.shapes) : undefined;
      if (bounds) input.map.current?.reveal([{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }]);
      else { const at = notePosition(note, document); if (at) input.map.current?.focus(at); }
    }}
    onReply={async (id, value) => { try { await replyCourseSettingNote(raceId, id, value); await input.reloadNotes(); return true; } catch { return false; } }}
    onStatus={async (id, value) => { try { await setCourseSettingNoteStatus(raceId, id, value); await input.reloadNotes(); return true; } catch { return false; } }}
    onCourseNote={() => { const course = document.courses.find(row => row.id === view); if (course) setDraft({ target: { kind: "COURSE", course: course.id }, kind: "COURSE_SETTING" }); }}
    canEdit={createdBy => createdBy !== null && createdBy === access.accountId}
    onEdit={async (note, replyId, value, expectedText) => {
      const outcome = await editOutcome(() => editCourseSettingNote(raceId, { noteId: note.id, replyId, text: value, expectedText }));
      if (outcome !== "failed") await input.reloadNotes().catch(() => undefined);
      return outcome;
    }}
    canDelete={canDelete} onDelete={note => void remove(note)} onDeleteReply={(note, replyId) => void remove(note, replyId)} onSketch={startSketch} />;

  return {
    notesInView, openCount: notesInView.filter(note => note.status === "OPEN").length, mapNotes, sketchLayer, selectedNote, setSelectedNote,
    /** Verktyget Notis: en ny notis på det som träffades. */
    setNoteDraft: (target: CourseSettingNoteTarget | undefined) => setDraft(target ? { target, kind: "COURSE_SETTING" } : undefined),
    sketching, handlers, startSketch, queueNote, card, panel,
    /** Escape i editorn: formuläret och ritningen stängs. */
    cancel: () => { setDraft(undefined); setSketch(undefined); }
  };
}

/** Beskedet för en post i kön som servern inte tog emot (notis eller borttagning). */
export function rejectedNoteText(item: Exclude<QueuedItem, { kind: "inspection" }>, status: number): string {
  return item.kind === "note" ? offlineSv.rejectedNote(item.request.text, status) : notesSv.rejectedDelete(status);
}
