import { useState } from "react";


import { courseDetailsResponseSchema, type CourseDetailsRequest } from "@o-tid/contracts";

import { forkingSv } from "../../i18n/forking-sv";
import type { FieldErrors } from "../../lib/form-validation";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { CourseEditActions } from "./course-edit";

type DetailsField = "name" | "length" | "climb";

/** Banans längd och stigning (PLAN.md steg 25): öppen rad, fältfel och sparande. Påverkar inga resultat och sparas direkt. */
export function useCourseDetailsState() {
  const [detailsCourseId, setDetailsCourseId] = useState("");
  const [detailsLength, setDetailsLength] = useState("");
  const [detailsClimb, setDetailsClimb] = useState("");
  const [detailsName, setDetailsName] = useState("");
  const [detailsErrors, setDetailsErrors] = useState<FieldErrors<DetailsField>>({});
  const [detailsMessage, setDetailsMessage] = useState("");
  /** Begärans id behålls tills servern svarat, så att ett nytt försök efter nätfel är samma begäran. */
  const [detailsRequest, setDetailsRequest] = useState<CourseDetailsRequest>();
  return { detailsCourseId, setDetailsCourseId, detailsLength, setDetailsLength, detailsClimb, setDetailsClimb, detailsName, setDetailsName, detailsErrors,
    setDetailsErrors, detailsMessage, setDetailsMessage, detailsRequest, setDetailsRequest };
}

/** Meter som text: tomt = okänt (null), annars ett heltal inom gränserna; undefined = ogiltigt. */
export function parseMeters(value: string, minimum: number, maximum: number): number | null | undefined {
  const trimmed = value.trim().replace(/\s/g, "");
  if (trimmed === "") return null;
  if (!/^\d{1,7}$/.test(trimmed)) return undefined;
  const meters = Number(trimmed);
  return meters >= minimum && meters <= maximum ? meters : undefined;
}

export function createCourseDetailsActions(ws: Base & RaceDataActions & CourseEditActions) {
  const text = ws.adminText;
  const { courseList, detailsCourseId, detailsLength, detailsClimb, detailsName, detailsRequest, raceId, writingRef, pending, requireSession, begin,
    finish, current, request, json, csrf, readCourses, setDetailsCourseId, setDetailsLength, setDetailsClimb, setDetailsName, setDetailsErrors,
    setDetailsMessage, setDetailsRequest } = ws;
  function startCourseDetails(courseId: string) {
    if (writingRef.current || pending.current) return;
    const course = courseList?.courses.find(row => row.courseId === courseId);
    if (!course) return;
    setDetailsCourseId(courseId); setDetailsLength(course.lengthMeters ? String(course.lengthMeters) : "");
    setDetailsClimb(course.climbMeters != null ? String(course.climbMeters) : ""); setDetailsName(course.name); setDetailsErrors({}); setDetailsMessage("");
    setDetailsRequest(undefined);
  }
  function cancelCourseDetails() { setDetailsCourseId(""); setDetailsErrors({}); setDetailsRequest(undefined); }
  function changeCourseDetails(change: { name?: string; length?: string; climb?: string }) {
    if (change.name !== undefined) setDetailsName(change.name);
    if (change.length !== undefined) setDetailsLength(change.length);
    if (change.climb !== undefined) setDetailsClimb(change.climb);
    setDetailsErrors({}); setDetailsRequest(undefined);
  }
  async function saveCourseDetails() {
    if (writingRef.current || pending.current || !requireSession() || !detailsCourseId) return;
    const lengthMeters = parseMeters(detailsLength, 1, 1_000_000), climbMeters = parseMeters(detailsClimb, 0, 100_000);
    const name = detailsName.trim();
    const errors = { length: lengthMeters === undefined ? text.courseLengthInvalid : undefined,
      climb: climbMeters === undefined ? text.courseClimbInvalid : undefined, name: name ? undefined : text.courseNameInvalid };
    setDetailsErrors(errors);
    if (lengthMeters === undefined || climbMeters === undefined || !name) return;
    const renamed = courseList?.courses.find(row => row.courseId === detailsCourseId)?.name !== name;
    const body: CourseDetailsRequest = detailsRequest ?? { formatVersion: 1, requestId: crypto.randomUUID(), courseId: detailsCourseId,
      lengthMeters, climbMeters, ...(renamed ? { name } : {}) };
    setDetailsRequest(body);
    const op = begin(true);
    try {
      const response = await request(`/courses/${detailsCourseId}/details`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `course-details:${body.requestId}` },
        body: JSON.stringify(body) });
      if (response.status === 409) { setDetailsRequest(undefined); setDetailsErrors({ name: text.courseNameTaken }); return; }
      if (!response.ok) throw new Error("Course details not saved");
      const receipt = courseDetailsResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== body.requestId) throw new Error("Course details receipt mismatch");
      setDetailsCourseId(""); setDetailsRequest(undefined); setDetailsMessage(text.courseDetailsSaved);
      await readCourses(op);
    } catch { if (current(op)) setDetailsMessage(text.courseDetailsError); }
    finally { finish(op); }
  }
  /** Steg 49: gafflingssätt (utjämnad eller fulgaffling). Påverkar bara rättvisekontrollen och sparas direkt. */
  async function saveForkingMode(courseId: string, forkingMode: "BALANCED" | "UNEQUAL") {
    if (writingRef.current || pending.current || !requireSession()) return;
    const course = courseList?.courses.find(row => row.courseId === courseId);
    if (!course || course.forkingMode === forkingMode) return;
    const body: CourseDetailsRequest = { formatVersion: 1, requestId: crypto.randomUUID(), courseId,
      lengthMeters: course.lengthMeters ?? null, climbMeters: course.climbMeters ?? null, forkingMode };
    setDetailsMessage("");
    const op = begin(true);
    try {
      const response = await request(`/courses/${courseId}/details`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `course-details:${body.requestId}` },
        body: JSON.stringify(body) });
      if (!response.ok) throw new Error("Forking mode not saved");
      const receipt = courseDetailsResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== body.requestId) throw new Error("Forking mode receipt mismatch");
      setDetailsMessage(forkingSv.modeSaved(forkingMode));
      await readCourses(op);
    } catch { if (current(op)) setDetailsMessage(text.courseDetailsError); }
    finally { finish(op); }
  }
  return { startCourseDetails, cancelCourseDetails, changeCourseDetails, saveCourseDetails, saveForkingMode };
}
