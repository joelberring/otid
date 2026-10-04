import { useCallback, useRef, useState } from "react";
import { readRaceAdministratorCsrfCookie } from "../../lib/race-administrator-cookies";
import { fetchWithRetry } from "../../lib/retrying-fetch";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { Operation, PendingAttempt } from "./types";
import type { WorkspaceState } from "./workspace-state";
import { clearBeforeOperation, clearBeforeRequest, resetWorkspaceOnLock } from "./workspace-reset";

/** Gemensamt läge för alla anrop i arbetsytan: en åtgärd i taget och ett försök som väntar på kvitto. */
export function useOperationState() {
  const [expiresAt, setExpiresAt] = useState<string>();
  const [authenticated, setAuthenticated] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string>(text.checking);
  const generation = useRef(0), deadline = useRef(0), busyRef = useRef(true);
  const pending = useRef<PendingAttempt | undefined>(undefined), sent = useRef(false);
  const operation = useRef<Operation | undefined>(undefined);
  return { expiresAt, setExpiresAt, authenticated, setAuthenticated, unknown, setUnknown, busy, setBusy, message, setMessage,
    generation, deadline, busyRef, pending, sent, operation };
}

/**
 * Den enda hjälpen för API-anrop från arbetsytan. Varje anrop får en operation som avbryts när en nyare
 * startar, när sessionen går ut eller efter 15 sekunder. 401/403 låser arbetsytan. Läsningar och skrivningar
 * med idempotensnyckel eller requestId skickas om automatiskt vid nätfel (`fetchWithRetry`).
 */
export function useOperations(s: WorkspaceState) {
  const { raceId, generation, operation, busyRef, deadline, setBusy } = s;
  const base = `/api/admin/races/${raceId}/administrator`;
  const invalidate = useCallback(() => {
    generation.current += 1;
    if (operation.current) { operation.current.controller.abort(); clearTimeout(operation.current.timer); }
    operation.current = undefined; busyRef.current = false;
  }, []);
  const lock = useCallback((discard = false) => {
    invalidate(); deadline.current = 0;
    resetWorkspaceOnLock(s, discard);
  }, [invalidate]);
  function begin(): Operation {
    clearBeforeOperation(s);
    return beginRequest();
  }
  function beginRequest(): Operation {
    clearBeforeRequest(s);
    invalidate(); const controller = new AbortController();
    const op = { generation: generation.current, controller, timer: setTimeout(() => controller.abort(), 15_000) };
    operation.current = op; busyRef.current = true; setBusy(true); return op;
  }
  function current(op: Operation) { return op.generation === generation.current; }
  function finish(op: Operation) {
    clearTimeout(op.timer);
    if (current(op)) { operation.current = undefined; busyRef.current = false; setBusy(false); }
  }
  function assertCurrent(op: Operation) {
    if (!current(op) || op.controller.signal.aborted) throw new Error("Superseded request");
    if (deadline.current && deadline.current <= Date.now()) { lock(); throw new Error("Expired session"); }
  }
  function requireSession() {
    if (!deadline.current || deadline.current <= Date.now()) { lock(); return false; }
    return true;
  }
  async function request(path: string, op: Operation, init: RequestInit = {}) {
    const response = await fetchWithRetry(`${base}${path}`, { ...init, credentials: "same-origin", cache: "no-store", signal: op.controller.signal });
    assertCurrent(op);
    if (response.status === 401 || response.status === 403) { lock(); throw new Error("Unauthorized"); }
    return response;
  }
  async function json(response: Response, op: Operation): Promise<unknown> {
    const value: unknown = await response.json(); assertCurrent(op); return value;
  }
  function csrf() {
    const token = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
    if (!token) { lock(); throw new Error("Missing CSRF"); }
    return token;
  }
  return { base, invalidate, lock, begin, beginRequest, current, finish, assertCurrent, requireSession, request, json, csrf };
}
export type Operations = ReturnType<typeof useOperations>;
