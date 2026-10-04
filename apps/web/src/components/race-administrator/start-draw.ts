import { useState } from "react";
import {
  startDrawPreviewResponseSchema, startDrawResponseSchema, startDrawSetupResponseSchema, type StartDrawMethod,
  type StartDrawPreviewResponse, type StartDrawRequest, type StartDrawSetupResponse
} from "@o-tid/contracts";
import { startDrawSv as text } from "../../i18n/start-draw-sv";
import { formatClockTime, parseRaceClock } from "../../lib/clock-time";
import type { Operation, StartDrawAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

export type DrawRow = { method: StartDrawMethod; interval: string; vacancies: string; vacancyKind: "COUNT" | "PERCENT"; selected: boolean };

/** Lottning under Start (PLAN.md steg 9): klasstabell, inställningar, förhandsvisning och sparande. */
export function useStartDrawState() {
  const [drawSetup, setDrawSetup] = useState<StartDrawSetupResponse>();
  const [drawRows, setDrawRows] = useState<Record<string, DrawRow>>({});
  const [drawFirst, setDrawFirst] = useState("");
  const [drawClubSeparation, setDrawClubSeparation] = useState(true);
  const [drawPreview, setDrawPreview] = useState<StartDrawPreviewResponse>();
  const [drawError, setDrawError] = useState("");
  const [drawSaved, setDrawSaved] = useState("");
  const [drawAttempt, setDrawAttempt] = useState<StartDrawAttempt>();
  return { drawSetup, setDrawSetup, drawRows, setDrawRows, drawFirst, setDrawFirst, drawClubSeparation, setDrawClubSeparation,
    drawPreview, setDrawPreview, drawError, setDrawError, drawSaved, setDrawSaved, drawAttempt, setDrawAttempt };
}

/** Inställningarna i formuläret som en begäran, eller undefined om något är ogiltigt. */
function settingsFrom(setup: StartDrawSetupResponse, rows: Record<string, DrawRow>, first: string, clubSeparation: boolean) {
  const firstStartTime = parseRaceClock(setup.raceDate, first, setup.timeZone);
  const selected = setup.classes.filter(row => rows[row.id]?.selected);
  if (selected.length === 0) return "none" as const;
  if (!firstStartTime || Date.parse(firstStartTime) % 60_000 !== 0) return undefined;
  const classes = [];
  for (const raceClass of selected) {
    const row = rows[raceClass.id]!;
    const interval = Number(row.interval), vacancies = Number(row.vacancies || "0");
    if (!/^\d+$/.test(row.interval) || interval < 1 || interval > 60 || !/^\d*$/.test(row.vacancies) ||
      vacancies > (row.vacancyKind === "PERCENT" ? 100 : 1_000)) return undefined;
    classes.push({ classId: raceClass.id, method: row.method, intervalMinutes: interval,
      vacancies: { kind: row.vacancyKind, value: vacancies } });
  }
  return { expectedSnapshotVersion: setup.snapshotVersion, firstStartTime, clubSeparation, classes };
}

export function createStartDrawActions(ws: Base & RaceDataActions) {
  const { raceId, drawSetup, drawRows, drawFirst, drawClubSeparation, drawPreview, setDrawClubSeparation, busyRef, pending, sent, requireSession,
    beginRequest, finish, current, request, json, csrf, load, setDrawSetup, setDrawRows, setDrawFirst, setDrawPreview, setDrawError,
    setDrawSaved, setDrawAttempt, setPublicationPreview } = ws;

  async function readSetup(op: Operation) {
    const response = await request("/draw", op);
    if (!response.ok) throw new Error("Draw setup unavailable");
    const value = startDrawSetupResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Draw setup scope mismatch");
    setDrawSetup(value);
    // Behåll det arrangören redan valt för klasser som finns kvar.
    setDrawRows(previous => Object.fromEntries(value.classes.map(row => [row.id, previous[row.id] ?? {
      method: row.method, interval: String(row.intervalMinutes), vacancies: String(row.vacancies.value),
      vacancyKind: row.vacancies.kind, selected: false }])));
    setDrawFirst(previous => previous || (value.firstStartTime ? formatClockTime(value.firstStartTime, value.timeZone).slice(0, 5) : ""));
    return value;
  }
  async function loadDrawSetup() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setDrawError("");
    try { await readSetup(op); }
    catch { if (current(op)) setDrawError(text.error); }
    finally { finish(op); }
  }
  function changeDrawRow(classId: string, change: Partial<DrawRow>) {
    setDrawPreview(undefined); setDrawError(""); setDrawSaved("");
    setDrawRows(previous => {
      const row = previous[classId];
      if (!row) return previous;
      // Ett nytt startsätt betyder att klassen ska lottas om.
      const selected = change.selected ?? (change.method !== undefined && change.method !== row.method ? true : row.selected);
      return { ...previous, [classId]: { ...row, ...change, selected } };
    });
  }
  function changeDrawSettings(change: { first?: string; clubSeparation?: boolean }) {
    setDrawPreview(undefined); setDrawError(""); setDrawSaved("");
    if (change.first !== undefined) setDrawFirst(change.first);
    if (change.clubSeparation !== undefined) setDrawClubSeparation(change.clubSeparation);
  }
  async function readPreview(op: Operation, settings: Exclude<ReturnType<typeof settingsFrom>, "none" | undefined>) {
    const response = await request("/draw-preview", op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
      body: JSON.stringify({ formatVersion: 1, ...settings }) });
    if (response.status === 409) return "conflict" as const;
    if (!response.ok) throw new Error("Draw preview unavailable");
    const value = startDrawPreviewResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId || value.snapshotVersion !== settings.expectedSnapshotVersion) throw new Error("Draw preview mismatch");
    return value;
  }
  /** Visar lottningen som den blir. Läser om klasserna först om tävlingen ändrats. */
  async function previewDraw() {
    if (busyRef.current || pending.current || !requireSession() || !drawSetup) return;
    setDrawError(""); setDrawSaved(""); setDrawPreview(undefined);
    const op = beginRequest();
    try {
      let setup = drawSetup;
      let settings = settingsFrom(setup, drawRows, drawFirst, drawClubSeparation);
      if (settings === "none") { setDrawError(text.noneSelected); return; }
      if (!settings) { setDrawError(text.invalid); return; }
      let preview = await readPreview(op, settings);
      if (preview === "conflict") {
        setup = await readSetup(op);
        settings = settingsFrom(setup, drawRows, drawFirst, drawClubSeparation);
        if (!settings || settings === "none") { setDrawError(text.conflict); return; }
        preview = await readPreview(op, settings);
        if (preview === "conflict") { setDrawError(text.conflict); return; }
      }
      setDrawPreview(preview);
    } catch { if (current(op)) setDrawError(text.error); }
    finally { finish(op); }
  }
  async function send(op: Operation, attempt: StartDrawAttempt) {
    sent.current = true;
    const response = await request("/draw", op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `start-draw:${attempt.request.requestId}` },
      body: JSON.stringify(attempt.request) });
    if (response.status === 409 || response.status === 400 || response.status === 404) {
      pending.current = undefined; sent.current = false; setDrawAttempt(undefined); setDrawPreview(undefined);
      setDrawError(response.status === 409 ? text.conflict : text.saveError);
      if (response.status === 409) await readSetup(op);
      return;
    }
    if (!response.ok) throw new Error("Unknown draw outcome");
    const receipt = startDrawResponseSchema.parse(await json(response, op));
    if (receipt.raceId !== raceId || receipt.requestId !== attempt.request.requestId ||
        JSON.stringify(receipt.request) !== JSON.stringify(attempt.request)) throw new Error("Draw receipt mismatch");
    pending.current = undefined; sent.current = false; setDrawAttempt(undefined); setDrawPreview(undefined);
    setDrawRows(previous => Object.fromEntries(Object.entries(previous).map(([id, row]) => [id, { ...row, selected: false }])));
    setPublicationPreview(undefined); setDrawSaved(text.saved);
    try { await readSetup(op); await load(op); }
    catch { if (current(op)) setDrawError(text.error); }
  }
  /** Sparar lottningen som förhandsvisningen visar (samma underlag och samma lottning). */
  async function saveDraw() {
    if (busyRef.current || !requireSession()) return;
    const waiting = pending.current;
    const retry = waiting && "kind" in waiting && waiting.kind === "START_DRAW" ? waiting : undefined;
    if (pending.current && !retry) return;
    if (!retry && (!drawPreview || !drawSetup)) return;
    setDrawError(""); setDrawSaved("");
    const op = beginRequest();
    try {
      let attempt = retry;
      if (!attempt) {
        const settings = settingsFrom(drawSetup!, drawRows, drawFirst, drawClubSeparation);
        if (!settings || settings === "none") { setDrawError(text.invalid); return; }
        const request: StartDrawRequest = { formatVersion: 1, requestId: crypto.randomUUID(), seed: drawPreview!.seed, ...settings,
          expectedSnapshotVersion: drawPreview!.snapshotVersion, confirmChanges: drawPreview!.requiresConfirmation };
        attempt = { kind: "START_DRAW", request };
        pending.current = attempt; sent.current = false; setDrawAttempt(attempt);
      }
      await send(op, attempt);
    } catch { if (current(op)) setDrawError(pending.current ? text.unknown : text.saveError); }
    finally { finish(op); }
  }
  function cancelDrawPreview() {
    if (pending.current) return;
    setDrawPreview(undefined); setDrawError("");
  }
  return { loadDrawSetup, changeDrawRow, changeDrawSettings, previewDraw, saveDraw, cancelDrawPreview };
}
export type StartDrawActions = ReturnType<typeof createStartDrawActions>;
