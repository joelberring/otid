import { useState, type FormEvent } from "react";
import { administratorEffectiveResultResponseSchema, entryTransferCandidatesSchema, raceAdministratorLoginResponseSchema,
  type AdministratorEffectiveResultResponse, type EntryTransferCandidates } from "@o-tid/contracts";
import { readOrganizerCsrf } from "../../lib/organizer-client";
import { readRaceAdministratorCsrfCookie } from "../../lib/race-administrator-cookies";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { Operation } from "./types";
import type { Base } from "./workspace-state";
import type { MobileNavigation } from "./navigation";

/** Tävlingens deltagarlista (ögonblicksbilden) och vald deltagares gällande resultat. */
export function useRaceDataState() {
  const [data, setData] = useState<EntryTransferCandidates>();
  const [effectiveResult, setEffectiveResult] = useState<AdministratorEffectiveResultResponse>();
  const [effectiveResultError, setEffectiveResultError] = useState(false);
  return { data, setData, effectiveResult, setEffectiveResult, effectiveResultError, setEffectiveResultError };
}

/** Session och dataladdning: inloggning med kontot, utloggning och ny läsning av ögonblicksbilden. */
export function createRaceDataActions(ws: Base & MobileNavigation) {
  const { raceId, entryId, pending, sent, busyRef, deadline, base, setEffectiveResult, setEffectiveResultError, setData,
    setDnsCandidates, setDnsWithdrawals, setEntryChanges, setIdentityCandidates, setRecalculationCandidates,
    setCourseWarningClassId, setSelectedCourseTarget, setExpiresAt, setAuthenticated, setMobilePanel, setMessage,
    setEntryId, setClassId, setPage, setNewCard, request, json, assertCurrent, current, begin, finish, lock,
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
    setDnsCandidates(undefined); setDnsWithdrawals(undefined);
    setEntryChanges(undefined);
    setIdentityCandidates(undefined);
    setRecalculationCandidates(undefined);
    const response = await request("/transfer-candidates", op);
    if (!response.ok) throw new Error("List unavailable");
    const value = entryTransferCandidatesSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Scope mismatch");
    setCourseWarningClassId("");
    setSelectedCourseTarget(undefined);
    setData(value);
    if (selectedId) await loadEffectiveResult(selectedId, value, op);
    assertCurrent(op); return value;
  }
  /** ADR-0168: öppna tävlingen med det inloggade kontot (OWNER/ADMIN på eventet). */
  async function enterWithAccount(op: Operation) {
    let csrfToken: string;
    try { csrfToken = readOrganizerCsrf(document.cookie, new URL(window.location.href)); }
    catch { throw new Error("No account session"); }
    const response = await fetch(`/api/organizer/races/${encodeURIComponent(raceId)}/enter`, {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: op.controller.signal,
      headers: { "x-otid-csrf": csrfToken } });
    if (!response.ok) throw new Error("Account enter failed");
    await session(op);
  }
  async function session(op: Operation) {
    const response = await request("/session", op);
    if (!response.ok) throw new Error("Session unavailable");
    const value = raceAdministratorLoginResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId || Date.parse(value.expiresAt) <= Date.now()) throw new Error("Invalid session");
    deadline.current = Date.parse(value.expiresAt); setExpiresAt(value.expiresAt);
    await load(op); assertCurrent(op); setAuthenticated(true); if (pending.current) setMobilePanel("WORK"); setMessage("");
  }
  async function login(event: FormEvent) {
    event.preventDefault(); if (busyRef.current) return;
    const op = begin();
    try {
      await enterWithAccount(op);
    } catch { if (current(op)) lock(); } finally { finish(op); }
  }
  async function logout() {
    const hadPending = sent.current;
    const token = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
    lock(true); if (hadPending) setMessage(text.discarded);
    if (!token) { setMessage(`${text.logoutError}${hadPending ? ` ${text.discarded}` : ""}`); return; }
    const op = begin();
    try {
      // Logout must not route an unauthorized response through lock(), which would erase the pending-warning message.
      const response = await fetch(`${base}/session`, { method: "DELETE", credentials: "same-origin", cache: "no-store",
        signal: op.controller.signal, headers: { "x-otid-csrf": token } });
      assertCurrent(op);
      if (!response.ok && response.status !== 401) throw new Error("Logout failed");
    } catch { if (current(op)) setMessage(`${text.logoutError}${hadPending ? ` ${text.discarded}` : ""}`); }
    finally { finish(op); }
  }
  async function refresh() {
    if (busyRef.current || pending.current || !requireSession()) return;
    showMobilePanel("LIST");
    const op = begin(); setData(undefined); setEntryId(""); setClassId(""); setPage(0); setNewCard("");
    try { await load(op); setMessage(""); }
    catch { if (current(op)) setMessage(text.error); } finally { finish(op); }
  }
  return { loadEffectiveResult, load, enterWithAccount, session, login, logout, refresh };
}
export type RaceDataActions = ReturnType<typeof createRaceDataActions>;
