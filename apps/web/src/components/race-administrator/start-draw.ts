import { useState } from "react";




import {
  startDrawPreviewResponseSchema, startDrawResponseSchema, startDrawSetupResponseSchema, type StartDrawMethod,
  type StartDrawPreviewResponse, type StartDrawRequest, type StartDrawSetupResponse
} from "@o-tid/contracts";

import { formatClockTime, normalizeClock } from "../../lib/clock-time";
import { validateFirstStart } from "../../lib/form-validation";
import type { Operation, StartDrawAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import { advancedChanged, advancedFromSetup, advancedRequest, createStartDrawAdvancedActions, useStartDrawAdvancedState,
  type DrawAdvanced } from "./start-draw-advanced";

import { applyDrawCommon, DRAW_COMMON_DEFAULT, type DrawCommon, type DrawCommonScope } from "./start-draw-common";
import { buildWaveShiftRequest, parseWholeMinuteClock, type MassStartWave } from "./start-draw-waves";

export type DrawRow = {
  method: StartDrawMethod; interval: string; vacancies: string; vacancyKind: "COUNT" | "PERCENT";
  /** Klockslag för masstart direkt i klasstabellen (t.ex. "19:10"); tomt = använd tävlingens första start. */
  massStart: string;
  selected: boolean;
};

export type WaveShiftOutcome =
  | { kind: "SHIFTED"; fromClock: string; toClock: string; classNames: string[]; recalculatedCount: number }
  | { kind: "INVALID" | "UNCHANGED" | "CANCELLED" | "ERROR" | "BUSY" };

/** Lottning under Start (PLAN.md steg 9 och 26): klasstabell, inställningar, Avancerat, förhandsvisning och sparande. */
export function useStartDrawState() {
  const [drawSetup, setDrawSetup] = useState<StartDrawSetupResponse>();
  const [drawRows, setDrawRows] = useState<Record<string, DrawRow>>({});
  const [drawFirst, setDrawFirst] = useState("");
  const [drawClubSeparation, setDrawClubSeparation] = useState(true);
  const [drawPreview, setDrawPreview] = useState<StartDrawPreviewResponse>();
  const [drawError, setDrawError] = useState("");
  const [drawSaved, setDrawSaved] = useState("");
  const [drawAttempt, setDrawAttempt] = useState<StartDrawAttempt>();
  /** Fältfelet för första start (PLAN.md steg 24). */
  const [drawFirstError, setDrawFirstError] = useState("");
  /** Fältfel per klass för masstartsklockslag direkt i huvudtabellen. */
  const [drawMassErrors, setDrawMassErrors] = useState<Record<string, string>>({});
  /** ADR-0188 beslut 1: de gemensamma inställningarna och beskedet efter "Använd för alla/valda". */
  const [drawCommon, setDrawCommon] = useState<DrawCommon>(DRAW_COMMON_DEFAULT);
  const [drawCommonApplied, setDrawCommonApplied] = useState("");
  return { ...useStartDrawAdvancedState(), drawCommon, setDrawCommon, drawCommonApplied, setDrawCommonApplied, drawFirstError, setDrawFirstError,
    drawMassErrors, setDrawMassErrors, drawSetup, setDrawSetup, drawRows, setDrawRows, drawFirst, setDrawFirst, drawClubSeparation, setDrawClubSeparation,
    drawPreview, setDrawPreview, drawError, setDrawError, drawSaved, setDrawSaved, drawAttempt, setDrawAttempt };
}

/**
 * Inställningarna i formuläret som en begäran, "none" om ingen klass är ikryssad, "invalid-first" om första start är
 * ogiltigt, `{ massErrors }` för ogiltiga masstartsklockslag i tabellen, `{ errors }` för fältfel under Avancerat,
 * eller undefined om intervall/vakanser är ogiltiga.
 */
export function buildDrawSettings(setup: StartDrawSetupResponse, rows: Record<string, DrawRow>, first: string, clubSeparation: boolean,
  advanced: DrawAdvanced, advancedText: Pick<Base["drawAdvancedText"], "errors">, massInvalidError: string) {
  const selected = setup.classes.filter(row => rows[row.id]?.selected);
  if (selected.length === 0) return "none" as const;
  const trimmedFirst = first.trim();
  const baseFirst = trimmedFirst === "" ? null : parseWholeMinuteClock(setup.raceDate, trimmedFirst, setup.timeZone);
  if (trimmedFirst !== "" && !baseFirst) return "invalid-first" as const;
  const massErrors: Record<string, string> = {};
  const massInstants = new Map<string, string>();
  for (const raceClass of selected) {
    const row = rows[raceClass.id]!;
    if (row.method !== "MASS") continue;
    const raw = row.massStart.trim();
    if (raw === "") continue;
    const instant = parseWholeMinuteClock(setup.raceDate, raw, setup.timeZone, baseFirst ?? setup.firstStartTime);
    if (!instant) massErrors[raceClass.id] = massInvalidError;
    else massInstants.set(raceClass.id, instant);
  }
  if (Object.keys(massErrors).length > 0) return { massErrors };
  const needsBaseFirst = selected.some(raceClass => {
    const row = rows[raceClass.id]!;
    return row.method !== "MASS" || !massInstants.has(raceClass.id);
  });
  if (needsBaseFirst && !baseFirst) return "invalid-first" as const;
  const candidates = [...(baseFirst ? [baseFirst] : []), ...massInstants.values()];
  if (candidates.length === 0) return "invalid-first" as const;
  // Om en masstartsklass har tidigare klockslag än fältet Första start sänks lottningens första start automatiskt dit.
  const firstStartTime = candidates.reduce((earliest, candidate) =>
    Date.parse(candidate) < Date.parse(earliest) ? candidate : earliest);
  const extra = advancedRequest(setup, rows, advanced, firstStartTime, new Set(selected.map(row => row.id)), advancedText);
  if ("errors" in extra) return { errors: extra.errors };
  const classes = [];
  for (const raceClass of selected) {
    const row = rows[raceClass.id]!;
    if (row.method === "MINUTE") {
      const interval = Number(row.interval), vacancies = Number(row.vacancies || "0");
      if (!/^\d+$/.test(row.interval) || interval < 1 || interval > 60 || !/^\d*$/.test(row.vacancies) ||
        vacancies > (row.vacancyKind === "PERCENT" ? 100 : 1_000)) return undefined;
      const laterStart = extra.request.laterStarts.get(raceClass.id);
      classes.push({ classId: raceClass.id, method: row.method, intervalMinutes: interval,
        vacancies: { kind: row.vacancyKind, value: vacancies }, ...(laterStart ? { laterStart } : {}) });
    } else if (row.method === "MASS") {
      const massTime = massInstants.get(raceClass.id);
      const laterStart = massTime ? { kind: "CLOCK" as const, startTime: massTime }
        : (extra.request.laterStarts.get(raceClass.id) ?? (baseFirst ? { kind: "CLOCK" as const, startTime: baseFirst } : undefined));
      classes.push({ classId: raceClass.id, method: row.method, intervalMinutes: 1,
        vacancies: { kind: "COUNT" as const, value: 0 }, ...(laterStart ? { laterStart } : {}) });
    } else {
      classes.push({ classId: raceClass.id, method: row.method, intervalMinutes: 1,
        vacancies: { kind: "COUNT" as const, value: 0 } });
    }
  }
  return { firstStartTime, clubSeparation, classes, rules: extra.request.rules, seeds: extra.request.seeds };
}
type DrawSettings = Exclude<ReturnType<typeof buildDrawSettings>,
  "none" | "invalid-first" | undefined | { errors: Record<string, string> } | { massErrors: Record<string, string> }>;
const isSettings = (value: ReturnType<typeof buildDrawSettings>): value is DrawSettings =>
  value !== undefined && value !== "none" && value !== "invalid-first" && !("errors" in value) && !("massErrors" in value);

function rowFromSetup(row: StartDrawSetupResponse["classes"][number], timeZone: string): DrawRow {
  const massStart = row.method === "MASS" && row.firstStartTime
    ? formatClockTime(row.firstStartTime, timeZone).slice(0, 5) : "";
  return {
    method: row.method,
    interval: String(row.intervalMinutes),
    vacancies: String(row.vacancies.value),
    vacancyKind: row.vacancies.kind,
    massStart,
    selected: row.method !== "FREE" && row.entryCount > 0 && !row.hasStartTimes
  };
}

export function createStartDrawActions(ws: Base & RaceDataActions) {
  const advancedText = ws.drawAdvancedText;
  const text = ws.drawText;
  const { raceId, drawSetup, drawRows, drawFirst, drawClubSeparation, drawPreview, setDrawClubSeparation, writingRef, pending, sent, requireSession,
    begin, beginRequest, finish, current, request, json, csrf, load, setDrawSetup, setDrawRows, setDrawFirst, setDrawPreview, setDrawError,
    setDrawSaved, setDrawAttempt, setPublicationPreview, setDrawFirstError, setDrawMassErrors, drawAdvanced, drawAdvancedLoaded, setDrawAdvanced,
    setDrawAdvancedLoaded, setDrawAdvancedOpen, setDrawAdvancedErrors, drawCommon, setDrawCommon, setDrawCommonApplied } = ws;
  const settingsNow = (setup: StartDrawSetupResponse) =>
    buildDrawSettings(setup, drawRows, drawFirst, drawClubSeparation, drawAdvanced, advancedText, text.massStartInvalid);

  async function readSetup(op: Operation, options: { syncAll?: boolean; syncClassIds?: ReadonlySet<string> } = {}) {
    const response = await request("/draw", op);
    if (!response.ok) throw new Error("Draw setup unavailable");
    const value = startDrawSetupResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Draw setup scope mismatch");
    const previousClasses = new Map((drawSetup?.classes ?? []).map(row => [row.id, row]));
    setDrawSetup(value);
    // Behåll lokala val när klassen är oförändrad på servern; uppdatera rader som sparats eller ändrats (t.ex. via Klasser eller vågflytt).
    setDrawRows(previous => Object.fromEntries(value.classes.map(row => {
      const existing = previous[row.id];
      const prior = previousClasses.get(row.id);
      const serverChanged = prior !== undefined && (prior.method !== row.method ||
        (prior.firstStartTime ?? null) !== (row.firstStartTime ?? null) || prior.hasStartTimes !== row.hasStartTimes);
      if (!existing || options.syncAll || options.syncClassIds?.has(row.id) || serverChanged) {
        return [row.id, rowFromSetup(row, value.timeZone)];
      }
      return [row.id, existing];
    })));
    // ADR-0188 beslut 2: tävlingens första start (samma som under Inställningar), annars den lottade.
    const serverFirst = value.firstStartTime ? formatClockTime(value.firstStartTime, value.timeZone).slice(0, 5) : "";
    setDrawFirst(previous => (options.syncAll && serverFirst) ? serverFirst : previous || ws.data?.firstStartTime || serverFirst);
    // Avancerat läses in en gång: det som sparades med senaste lottningen (PLAN.md steg 26).
    if (!drawAdvancedLoaded || options.syncAll) {
      const advanced = advancedFromSetup(value);
      setDrawAdvanced(advanced);
      if (!drawAdvancedLoaded) { setDrawAdvancedOpen(advancedChanged(advanced)); setDrawAdvancedLoaded(true); }
    }
    return value;
  }
  async function loadDrawSetup() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setDrawError("");
    try { await readSetup(op); }
    catch { if (current(op)) setDrawError(text.error); }
    finally { finish(op); }
  }
  function changeDrawRow(classId: string, change: Partial<DrawRow>) {
    setDrawPreview(undefined); setDrawError(""); setDrawSaved("");
    setDrawMassErrors(previous => {
      if (!(classId in previous)) return previous;
      const next = { ...previous }; delete next[classId]; return next;
    });
    setDrawRows(previous => {
      const row = previous[classId];
      if (!row) return previous;
      let massStart = change.massStart ?? row.massStart;
      // Förfyll masstartsklockslaget när arrangören byter till Masstart, från klassens sparade tid eller Första start.
      if (change.method === "MASS" && massStart.trim() === "") {
        const later = drawAdvanced.laterStarts[classId];
        const setupClass = drawSetup?.classes.find(item => item.id === classId);
        const savedClock = setupClass?.method === "MASS" && setupClass.firstStartTime && drawSetup
          ? formatClockTime(setupClass.firstStartTime, drawSetup.timeZone).slice(0, 5) : "";
        const normalizedFirst = normalizeClock(drawFirst);
        massStart = (later?.kind === "CLOCK" && later.value.trim()) || savedClock || (normalizedFirst?.length === 5 ? normalizedFirst : "");
      }
      // Nytt startsätt eller ändrad masstartstid betyder att klassen ska tas med i lottningen.
      const selected = change.selected ?? ((change.method !== undefined && change.method !== row.method) ||
        (change.massStart !== undefined && change.massStart !== row.massStart) ? true : row.selected);
      return { ...previous, [classId]: { ...row, ...change, massStart, selected } };
    });
  }
  function changeDrawCommon(change: Partial<DrawCommon>) {
    setDrawCommonApplied("");
    setDrawCommon(previous => ({ ...previous, ...change }));
  }
  /** "Använd för alla" och "Använd för valda": de gemensamma värdena på klasserna (ADR-0188 beslut 1). */
  function applyDrawCommonTo(scope: DrawCommonScope) {
    setDrawPreview(undefined); setDrawError(""); setDrawSaved(""); setDrawMassErrors({});
    const applied = applyDrawCommon(drawRows, drawAdvanced, drawCommon, scope);
    setDrawRows(() => applied.rows);
    if (applied.advanced !== drawAdvanced) {
      setDrawAdvanced(applied.advanced);
      setDrawAdvancedErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith("later:"))));
    }
    setDrawCommonApplied(applied.count === 0 ? text.common.noneSelected : text.common.applied(applied.count));
    // Första start för valda klasser ska inte följa med nästa "Använd för alla" av misstag.
    if (applied.count > 0) setDrawCommon(previous => ({ ...previous, laterStart: "" }));
  }
  /** Lotta-kolumnens kryssruta: alla eller inga klasser. */
  function selectAllDrawRows(selected: boolean) {
    setDrawPreview(undefined); setDrawError(""); setDrawSaved(""); setDrawCommonApplied("");
    setDrawRows(previous => Object.fromEntries(Object.entries(previous).map(([id, row]) => [id, { ...row, selected }])));
  }
  function changeDrawSettings(change: { first?: string; clubSeparation?: boolean }) {
    setDrawPreview(undefined); setDrawError(""); setDrawSaved("");
    if (change.first !== undefined) { setDrawFirst(change.first); setDrawFirstError(""); }
    if (change.clubSeparation !== undefined) setDrawClubSeparation(change.clubSeparation);
  }
  async function readPreview(op: Operation, settings: DrawSettings) {
    const response = await request("/draw-preview", op, { method: "POST",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
      body: JSON.stringify({ formatVersion: 1, ...settings }) });
    if (response.status === 409) return "conflict" as const;
    if (!response.ok) throw new Error("Draw preview unavailable");
    const value = startDrawPreviewResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Draw preview mismatch");
    return value;
  }
  /** Visar lottningen som den blir. Läser om klasserna först om tävlingen ändrats. */
  async function previewDraw() {
    if (writingRef.current || pending.current || !requireSession() || !drawSetup) return;
    setDrawError(""); setDrawSaved(""); setDrawPreview(undefined); setDrawFirstError(""); setDrawMassErrors({});
    const op = beginRequest();
    try {
      let setup = drawSetup;
      let settings = settingsNow(setup);
      if (settings === "none") { setDrawError(text.noneSelected); return; }
      if (settings === "invalid-first") {
        setDrawFirstError(validateFirstStart(drawFirst, ws.formErrorText) ?? ws.formErrorText.firstStart);
        document.getElementById(`draw-first-${raceId}`)?.focus();
        return;
      }
      if (!settings) { setDrawError(text.invalid); return; }
      if ("massErrors" in settings) {
        setDrawMassErrors(settings.massErrors);
        const firstInvalid = Object.keys(settings.massErrors)[0];
        if (firstInvalid) requestAnimationFrame(() => document.getElementById(`draw-mass-${firstInvalid}`)?.focus());
        return;
      }
      setDrawAdvancedErrors("errors" in settings ? settings.errors : {});
      if ("errors" in settings) {
        setDrawAdvancedOpen(true); setDrawError(advancedText.errors.summary);
        requestAnimationFrame(() => document.getElementById(`draw-advanced-${raceId}`)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      let preview = await readPreview(op, settings);
      if (preview === "conflict") {
        setup = await readSetup(op);
        settings = settingsNow(setup);
        if (!isSettings(settings)) { setDrawError(text.conflict); return; }
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
    const savedClassIds = new Set(attempt.request.classes.map(row => row.classId));
    setDrawRows(previous => Object.fromEntries(Object.entries(previous).map(([id, row]) => [id, { ...row, selected: false }])));
    setPublicationPreview(undefined); setDrawSaved(text.saved);
    try { await readSetup(op, { syncClassIds: savedClassIds }); await load(op); }
    catch { if (current(op)) setDrawError(text.error); }
  }
  /** Sparar lottningen som förhandsvisningen visar (samma underlag och samma lottning). */
  async function saveDraw() {
    if (writingRef.current || !requireSession()) return;
    const waiting = pending.current;
    const retry = waiting && "kind" in waiting && waiting.kind === "START_DRAW" ? waiting : undefined;
    if (pending.current && !retry) return;
    if (!retry && (!drawPreview || !drawSetup)) return;
    setDrawError(""); setDrawSaved("");
    const op = beginRequest();
    try {
      let attempt = retry;
      if (!attempt) {
        const settings = settingsNow(drawSetup!);
        if (!isSettings(settings)) { setDrawError(text.invalid); return; }
        const request: StartDrawRequest = { formatVersion: 1, requestId: crypto.randomUUID(), seed: drawPreview!.seed, ...settings,
          confirmChanges: drawPreview!.requiresConfirmation };
        attempt = { kind: "START_DRAW", request };
        pending.current = attempt; sent.current = false; setDrawAttempt(attempt);
      }
      await send(op, attempt);
    } catch { if (current(op)) setDrawError(pending.current ? text.unknown : text.saveError); }
    finally { finish(op); }
  }
  /** Flyttar en hel masstartsvåg på tävlingsdagen (förhandsvisar, frågar och sparar med omräkning). */
  async function shiftMassStartWave(wave: MassStartWave, targetClock: string,
    confirm: (preview: StartDrawPreviewResponse, targetClock: string, deltaMinutes: number) => Promise<boolean>): Promise<WaveShiftOutcome> {
    if (writingRef.current || pending.current || !requireSession()) return { kind: "BUSY" };
    const op = begin(true);
    try {
      const setupResponse = await request("/draw", op);
      if (!setupResponse.ok) throw new Error("Draw setup unavailable");
      const setup = startDrawSetupResponseSchema.parse(await json(setupResponse, op));
      const built = buildWaveShiftRequest(setup, wave, targetClock);
      if (built === "invalid") return { kind: "INVALID" };
      if (built === "unchanged") return { kind: "UNCHANGED" };
      if (built === "empty") return { kind: "ERROR" };
      const previewSettings = { firstStartTime: built.firstStartTime, clubSeparation: built.clubSeparation, classes: built.classes };
      const previewResponse = await request("/draw-preview", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
        body: JSON.stringify({ formatVersion: 1, ...previewSettings }) });
      if (!previewResponse.ok) throw new Error("Draw preview unavailable");
      const preview = startDrawPreviewResponseSchema.parse(await json(previewResponse, op));
      if (!(await confirm(preview, built.targetClock, built.deltaMinutes))) return { kind: "CANCELLED" };
      const requestBody: StartDrawRequest = { formatVersion: 1, requestId: crypto.randomUUID(), seed: preview.seed, ...previewSettings,
        confirmChanges: preview.requiresConfirmation };
      const saveResponse = await request("/draw", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `start-draw:${requestBody.requestId}` },
        body: JSON.stringify(requestBody) });
      if (!saveResponse.ok) throw new Error("Wave shift not saved");
      const receipt = startDrawResponseSchema.parse(await json(saveResponse, op));
      const savedStart = preview.classes[0]?.firstStartTime ?? built.targetStartTime;
      const savedClock = formatClockTime(savedStart, preview.timeZone).slice(0, 5);
      const classNames = wave.classes.map(item => item.name);
      setDrawPreview(undefined); setDrawError(""); setPublicationPreview(undefined);
      setDrawSaved(text.waves.shifted(classNames, wave.clock, savedClock, receipt.recalculatedCount));
      await readSetup(op, { syncAll: true });
      await load(op);
      return { kind: "SHIFTED", fromClock: wave.clock, toClock: savedClock, classNames, recalculatedCount: receipt.recalculatedCount };
    } catch { return current(op) ? { kind: "ERROR" } : { kind: "BUSY" }; }
    finally { finish(op); }
  }
  function cancelDrawPreview() {
    if (pending.current) return;
    setDrawPreview(undefined); setDrawError("");
  }
  return { ...createStartDrawAdvancedActions(ws), changeDrawCommon, applyDrawCommonTo, selectAllDrawRows, loadDrawSetup, changeDrawRow,
    changeDrawSettings, previewDraw, saveDraw, shiftMassStartWave, cancelDrawPreview };
}
