import { useState } from "react";


import { administratorEffectiveResultResponseSchema, entryTransferCandidatesSchema, raceSessionStatusSchema,
  type AdministratorEffectiveResultResponse, type CourseSettingLevel, type EntryTransferCandidates } from "@o-tid/contracts";

import type { WorkspaceRole } from "../../lib/race-sections";
import type { Operation } from "./types";
import type { Base } from "./workspace-state";
import type { MobileNavigation } from "./navigation";

/** Banläggningens sida för nivån: kartritaren (MAP) har bara kartfelen. */
export const courseSettingPath = (level: CourseSettingLevel) => level === "MAP" ? "course-setting/map-errors" : "course-setting";

/** Tävlingens deltagarlista (ögonblicksbilden) och vald deltagares gällande resultat. */
export function useRaceDataState() {
  const [data, setData] = useState<EntryTransferCandidates>();
  const [effectiveResult, setEffectiveResult] = useState<AdministratorEffectiveResultResponse>();
  const [effectiveResultError, setEffectiveResultError] = useState(false);
  /** Administratör eller funktionär (ADR-0172 beslut 3), kontots roll på tävlingen. */
  const [role, setRole] = useState<WorkspaceRole>("ADMIN");
  /** Banläggningens behörighet på tävlingen (sidopanelens Banläggning); saknas = ingen. */
  const [courseSetting, setCourseSetting] = useState<CourseSettingLevel>();
  return { data, setData, effectiveResult, setEffectiveResult, effectiveResultError, setEffectiveResultError, role, setRole, courseSetting, setCourseSetting };
}

/** Session och dataladdning: inloggning med kontot, utloggning och ny läsning av ögonblicksbilden. */
export function createRaceDataActions(ws: Base & MobileNavigation) {
  const text = ws.adminText;
  const { raceId, entryId, pending, writingRef, deadline, setEffectiveResult, setEffectiveResultError, setData,
    setEntryChanges, setIdentityCandidates, setSelectedClassId, setExpiresAt, setAuthenticated, setMobilePanel, setMessage,
    setEntryId, setClassId, setPage, setNewCard, setRole, setCourseSetting, request, json, assertCurrent, current, begin, finish,
    requireSession, showMobilePanel } = ws;
  async function loadEffectiveResult(id: string, roster: EntryTransferCandidates, op: Operation) {
    setEffectiveResult(undefined); setEffectiveResultError(false);
    const entry = roster.entries.find((row) => row.id === id);
    if (!entry || pending.current) return;
    try {
      const response = await request(`/entries/${id}/effective-result`, op);
      if (!response.ok) throw new Error("Effective result unavailable");
      const value = administratorEffectiveResultResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId || value.entryId !== id || value.entryVersion !== entry.version ||
        value.currentClassId !== entry.classId || value.snapshotVersion !== roster.snapshotVersion || value.timeZone !== roster.timeZone) {
        throw new Error("Effective result scope mismatch");
      }
      setEffectiveResult(value);
    } catch { if (current(op)) { setEffectiveResult(undefined); setEffectiveResultError(true); } }
  }
  async function load(op: Operation, selectedId = entryId) {
    setEntryChanges(undefined);
    setIdentityCandidates(undefined);
    const response = await request("/transfer-candidates", op);
    if (!response.ok) throw new Error("List unavailable");
    const value = entryTransferCandidatesSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Scope mismatch");
    setSelectedClassId("");
    setData(value);
    if (selectedId) await loadEffectiveResult(selectedId, value, op);
    assertCurrent(op); return value;
  }
  async function session(op: Operation) {
    const response = await request("/session", op);
    if (!response.ok) throw new Error("Session unavailable");
    // Kontots session och roll på tävlingen (ADR-0173 beslut 4).
    const value = raceSessionStatusSchema.parse(await json(response, op));
    if ("authenticated" in value) {
      // Ägaren 2026-11-03: den som bara har banläggningen hamnar där, inte på en tom arbetsyta.
      if (value.courseSetting && value.raceId === raceId) {
        window.location.replace(`/admin/${encodeURIComponent(raceId)}/${courseSettingPath(value.courseSetting)}`);
      }
      throw new Error("No race session");
    }
    if (value.raceId !== raceId || Date.parse(value.expiresAt) <= Date.now()) throw new Error("Invalid session");
    deadline.current = Date.parse(value.expiresAt); setExpiresAt(value.expiresAt);
    setRole(value.role); setCourseSetting(value.courseSetting);
    await load(op); assertCurrent(op); setAuthenticated(true); if (pending.current) setMobilePanel("WORK"); setMessage("");
  }
  async function refresh() {
    if (writingRef.current || pending.current || !requireSession()) return;
    showMobilePanel("LIST");
    const op = begin(); setData(undefined); setEntryId(""); setClassId(""); setPage(0); setNewCard("");
    try { await load(op); setMessage(""); }
    catch { if (current(op)) setMessage(text.error); } finally { finish(op); }
  }
  /** Läser deltagarlistan igen utan att tömma vyn, t.ex. efter en rättning för hela tävlingen (PLAN.md steg 31). */
  async function reloadQuietly() {
    const op = begin(false);
    try { await load(op); } catch { if (current(op)) setMessage(text.error); } finally { finish(op); }
  }
  return { loadEffectiveResult, load, session, refresh, reloadQuietly };
}
export type RaceDataActions = ReturnType<typeof createRaceDataActions>;
