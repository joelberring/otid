"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MapProjectNoteList, MapProjectNoteView, MapProjectView } from "@o-tid/contracts";
import type { Point } from "@o-tid/map-file";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import { deleteLocalNote, localNotes, putLocalNote, type LocalNote } from "../../lib/map-project-note-store";

/** Notiserna hämtas igen så här ofta (när sidan syns); telefonens skickas lika ofta och när nätet kommer. */
const POLL_MS = 15_000;

/** En notis på kartan: från servern, eller i telefonen och väntar (`pending`). */
export interface ShownNote {
  readonly noteId: string; readonly at: Point; readonly text: string; readonly status: "OPEN" | "DONE";
  readonly pending: boolean; readonly problem?: number | undefined; readonly server?: MapProjectNoteView | undefined;
  /** Fotot som det ska visas: serverns adress eller telefonens data-URL. */
  readonly photoUrl?: string | undefined;
}

/**
 * ADR-0219 (K3): notiserna i kartprojektet. En ny notis läggs först i telefonen och skickas sedan (samma notis två gånger blir en);
 * klar, öppen igen och ta bort görs direkt mot servern.
 */
export function useMapProjectNotes(view: MapProjectView) {
  const base = mapProjectBase(view.projectId);
  const accountId = view.viewer.accountId;
  const [server, setServer] = useState<readonly MapProjectNoteView[]>([]);
  const [local, setLocal] = useState<readonly LocalNote[]>([]);
  const [problem, setProblem] = useState<number>();

  const load = useCallback(async () => {
    try {
      const response = await clubRequest(`${base}/notes`);
      if (response.status === 200) setServer((response.json as MapProjectNoteList).notes);
    } catch { /* Utan nät: det som visas står kvar. */ }
  }, [base]);

  const flush = useCallback(async () => {
    let stored: LocalNote[];
    try { stored = await localNotes(view.projectId, accountId); } catch { stored = []; }
    for (const note of stored) {
      let status: number;
      try { status = (await clubRequest(`${base}/notes`, "POST", note.request)).status; } catch { break; }
      if (status === 200 || status === 201) await deleteLocalNote(note.noteId).catch(() => undefined);
      else await putLocalNote({ ...note, problem: status }).catch(() => undefined);
    }
    try { setLocal(await localNotes(view.projectId, accountId)); } catch { setLocal([]); }
    await load();
  }, [base, view.projectId, accountId, load]);

  useEffect(() => {
    void flush();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void flush(); }, POLL_MS);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => { clearInterval(timer); window.removeEventListener("online", online); };
  }, [flush]);

  const create = useCallback(async (at: Point, text: string, photo: { mediaType: "image/jpeg"; base64: string } | undefined, objectKey?: string) => {
    const noteId = crypto.randomUUID();
    const note: LocalNote = { noteId, projectId: view.projectId, accountId, createdAt: new Date().toISOString(),
      request: { formatVersion: 1, noteId, at: { x: at.x, y: at.y }, text: text.trim(), ...(objectKey ? { objectKey } : {}), ...(photo ? { photo } : {}) } };
    await putLocalNote(note);
    setLocal(current => [...current, note]);
    void flush();
  }, [view.projectId, accountId, flush]);

  const run = useCallback(async (path: string, method: "PUT" | "DELETE", body?: unknown) => {
    setProblem(undefined);
    const response = await clubRequest(path, method, body).catch(() => ({ status: 0, json: undefined }));
    if (response.status !== 200) { setProblem(response.status); return false; }
    await load();
    return true;
  }, [load]);

  const setStatus = useCallback((noteId: string, status: "OPEN" | "DONE") =>
    run(`${base}/notes/${encodeURIComponent(noteId)}`, "PUT", { formatVersion: 1, status }), [base, run]);
  const remove = useCallback(async (noteId: string) => {
    if (local.some(note => note.noteId === noteId)) { await deleteLocalNote(noteId); setLocal(current => current.filter(note => note.noteId !== noteId)); return true; }
    return run(`${base}/notes/${encodeURIComponent(noteId)}`, "DELETE");
  }, [base, local, run]);

  const notes = useMemo((): ShownNote[] => [
    ...server.map(note => ({ noteId: note.noteId, at: note.at, text: note.text, status: note.status, pending: false, server: note,
      ...(note.photo ? { photoUrl: `${base}/notes/${encodeURIComponent(note.noteId)}/photo` } : {}) })),
    ...local.filter(note => !server.some(row => row.noteId === note.noteId)).map(note => ({ noteId: note.noteId, at: note.request.at,
      text: note.request.text, status: "OPEN" as const, pending: true, problem: note.problem,
      ...(note.request.photo ? { photoUrl: `data:${note.request.photo.mediaType};base64,${note.request.photo.base64}` } : {}) }))
  ], [server, local, base]);

  const canWrite = view.viewer.canPropose || view.viewer.canEdit;
  const canManage = (note: ShownNote) => note.pending || !!note.server?.own || view.viewer.canDecide;
  return { notes, create, setStatus, remove, canWrite, canManage, problem, setProblem };
}
