import { useState } from "react";
import { courseDetailsResponseSchema, type CourseDetailsRequest } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { FieldErrors } from "../../lib/form-validation";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { CourseEditActions } from "./course-edit";

type DetailsField = "length" | "climb";

/** Banans längd och stigning (PLAN.md steg 25): öppen rad, fältfel och sparande. Påverkar inga resultat och sparas direkt. */
export function useCourseDetailsState() {
  const [detailsCourseId, setDetailsCourseId] = useState("");
  const [detailsLength, setDetailsLength] = useState("");
  const [detailsClimb, setDetailsClimb] = useState("");
  const [detailsErrors, setDetailsErrors] = useState<FieldErrors<DetailsField>>({});
  const [detailsMessage, setDetailsMessage] = useState("");
  /** Begärans id behålls tills servern svarat, så att ett nytt försök efter nätfel är samma begäran. */
  const [detailsRequest, setDetailsRequest] = useState<CourseDetailsRequest>();
  return { detailsCourseId, setDetailsCourseId, detailsLength, setDetailsLength, detailsClimb, setDetailsClimb, detailsErrors,
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
  const { courseList, detailsCourseId, detailsLength, detailsClimb, detailsRequest, raceId, writingRef, pending, requireSession, begin,
    finish, current, request, json, csrf, readCourses, setDetailsCourseId, setDetailsLength, setDetailsClimb, setDetailsErrors,
    setDetailsMessage, setDetailsRequest } = ws;
  function startCourseDetails(courseId: string) {
    if (writingRef.current || pending.current) return;
    const course = courseList?.courses.find(row => row.courseId === courseId);
    if (!course) return;
    setDetailsCourseId(courseId); setDetailsLength(course.lengthMeters ? String(course.lengthMeters) : "");
    setDetailsClimb(course.climbMeters != null ? String(course.climbMeters) : ""); setDetailsErrors({}); setDetailsMessage("");
    setDetailsRequest(undefined);
  }
  function cancelCourseDetails() { setDetailsCourseId(""); setDetailsErrors({}); setDetailsRequest(undefined); }
  function changeCourseDetails(change: { length?: string; climb?: string }) {
    if (change.length !== undefined) setDetailsLength(change.length);
    if (change.climb !== undefined) setDetailsClimb(change.climb);
    setDetailsErrors({}); setDetailsRequest(undefined);
  }
  async function saveCourseDetails() {
    if (writingRef.current || pending.current || !requireSession() || !detailsCourseId) return;
    const lengthMeters = parseMeters(detailsLength, 1, 1_000_000), climbMeters = parseMeters(detailsClimb, 0, 100_000);
    const errors = { length: lengthMeters === undefined ? text.courseLengthInvalid : undefined,
      climb: climbMeters === undefined ? text.courseClimbInvalid : undefined };
    setDetailsErrors(errors);
    if (lengthMeters === undefined || climbMeters === undefined) return;
    const body: CourseDetailsRequest = detailsRequest ?? { formatVersion: 1, requestId: crypto.randomUUID(), courseId: detailsCourseId,
      lengthMeters, climbMeters };
    setDetailsRequest(body);
    const op = begin(true);
    try {
      const response = await request(`/courses/${detailsCourseId}/details`, op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `course-details:${body.requestId}` },
        body: JSON.stringify(body) });
      if (!response.ok) throw new Error("Course details not saved");
      const receipt = courseDetailsResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== body.requestId) throw new Error("Course details receipt mismatch");
      setDetailsCourseId(""); setDetailsRequest(undefined); setDetailsMessage(text.courseDetailsSaved);
      await readCourses(op);
    } catch { if (current(op)) setDetailsMessage(text.courseDetailsError); }
    finally { finish(op); }
  }
  return { startCourseDetails, cancelCourseDetails, changeCourseDetails, saveCourseDetails };
}
