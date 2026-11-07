import { useState, type FormEvent } from "react";
import {
  entryStartTimeChangeRequestSchema, entryStartTimeChangeResponseSchema, entryTransferRequestSchema, entryTransferResponseSchema
} from "@o-tid/contracts";
import { parseRaceClockNear, startReference } from "../../lib/clock-time";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { TimeAttempt, TransferAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Klassbyte och starttid: båda har ett granskningssteg innan de sparas (ADR-0169 beslut 4). */
export function useEntryClassState() {
  const [transferAttempt, setTransferAttempt] = useState<TransferAttempt>();
  const [timeAttempt, setTimeAttempt] = useState<TimeAttempt>();
  return { transferAttempt, setTransferAttempt, timeAttempt, setTimeAttempt };
}

export function createEntryClassActions(ws: Base & RaceDataActions) {
  const { raceId, data, entryId, classId, startClock, writingRef, pending, sent, requireSession, begin, finish, current, request, json, csrf, load,
    setMessage, setUnknown, setTransferAttempt, setData, setEntryId, setClassId, setNewCard, setStartClock, setTimeAttempt } = ws;
  function prepareTransfer(event: FormEvent) {
    event.preventDefault(); if (writingRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    const target = data?.classes.find((row) => row.id === classId);
    const previous = data?.classes.find((row) => row.id === entry?.classId);
    if (!data || !entry || !target || !previous || entry.classId === target.id) { setMessage(text.invalid); return; }
    if (target.maxEntries !== null && target.entryCount >= target.maxEntries) { setMessage(text.classFull); return; }
    const fixedStartTime = target.startRule === "FIXED"
      ? parseRaceClockNear(data.raceDate, startClock, data.timeZone, startReference(data.entries, target.id)) : null;
    if (target.startRule === "FIXED" && fixedStartTime === null) { setMessage(text.invalidTime); return; }
    const value: TransferAttempt = { kind: "TRANSFER", id: crypto.randomUUID(), entryId: entry.id, displayName: entry.displayName,
      previousClassId: entry.classId, previousClassName: previous.name, className: target.name,
      request: entryTransferRequestSchema.parse({ formatVersion: 1, targetClassId: target.id,
        expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedFixedStartTime: entry.fixedStartTime,
        expectedTargetCourseVersionId: target.courseVersionId, expectedTargetStartRule: target.startRule,
        fixedStartTime }) };
    pending.current = value; sent.current = false; setTransferAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitTransfer(value: TransferAttempt) {
    if (writingRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/transfer`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-transfer:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setTransferAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setMessage(text.conflict); return;
      }
      if (!response.ok) throw new Error("Unknown outcome");
      const receipt = entryTransferResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        JSON.stringify(receipt.request) !== JSON.stringify(value.request)) throw new Error("Receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setTransferAttempt(undefined); setUnknown(false);
      setData(undefined); setClassId(""); setMessage(text.saved); setNewCard("");
      setStartClock("");
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.savedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareTime(event: FormEvent) {
    event.preventDefault(); if (writingRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    const currentClass = data?.classes.find((row) => row.id === entry?.classId);
    const fixedStartTime = data ? parseRaceClockNear(data.raceDate, startClock, data.timeZone,
      entry?.fixedStartTime ?? startReference(data.entries, entry?.classId)) : null;
    if (!data || !entry || currentClass?.startRule !== "FIXED" || fixedStartTime === null || fixedStartTime === entry.fixedStartTime) {
      setMessage(text.timeInvalid); return;
    }
    const value: TimeAttempt = { kind: "TIME", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, timeZone: data.timeZone,
      request: entryStartTimeChangeRequestSchema.parse({ formatVersion: 1, expectedEntryVersion: entry.version,
        expectedClassId: entry.classId, expectedFixedStartTime: entry.fixedStartTime, fixedStartTime }) };
    pending.current = value; sent.current = false; setTimeAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitTime(value: TimeAttempt) {
    if (writingRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/start-time`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-start-time-change:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setTimeAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setMessage(text.timeConflict); return;
      }
      if (!response.ok) throw new Error("Unknown start time outcome");
      const receipt = entryStartTimeChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.previousFixedStartTime !== value.request.expectedFixedStartTime ||
        receipt.fixedStartTime !== value.request.fixedStartTime || receipt.entryVersionBefore !== value.request.expectedEntryVersion) throw new Error("Start time receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setTimeAttempt(undefined); setUnknown(false);
      setData(undefined); setStartClock(""); setMessage(text.timeSaved);
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.timeSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  return { prepareTransfer, submitTransfer, prepareTime, submitTime };
}
