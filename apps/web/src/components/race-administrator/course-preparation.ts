import { useRef, useState, type FormEvent } from "react";
import { manualCourseClassCreateResponseSchema } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { isDuplicateName } from "../../lib/duplicate-name";
import { hasErrors, validateCourseClass, type FieldErrors } from "../../lib/form-validation";
import { focusFirstError, focusWhenEnabled } from "../ui";
import { parseControlCodes, type CourseClassAttempt, type CourseClassRequest } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

export type CourseClassField = "courseName" | "className" | "controls" | "timeLimit" | "penalty";

/** Förberedelse av banor: ny bana med klass. Ändring av en befintlig bana finns i course-edit.ts. */
export function useCoursePreparationState() {
  const [courseName, setCourseName] = useState("");
  const [courseClassName, setCourseClassName] = useState("");
  const [courseStartRule, setCourseStartRule] = useState<CourseClassRequest["startRule"]>("PUNCH");
  const [courseControls, setCourseControls] = useState("");
  // Rogaining (ADR-0170 beslut 5): förval en timme och en straffpoäng per påbörjad minut.
  const [courseTimeLimit, setCourseTimeLimit] = useState("60");
  const [coursePenalty, setCoursePenalty] = useState("1");
  const [courseClassAttempt, setCourseClassAttempt] = useState<CourseClassAttempt>();
  const [courseClassError, setCourseClassError] = useState("");
  /** "Ny bana" öppnar formuläret direkt (PLAN.md steg 24); fälten visar sina egna fel. */
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [courseClassErrors, setCourseClassErrors] = useState<FieldErrors<CourseClassField>>({});
  const courseForm = useRef<HTMLFormElement | null>(null);
  return { courseFormOpen, setCourseFormOpen, courseClassErrors, setCourseClassErrors, courseForm, courseName, setCourseName, courseClassName, setCourseClassName, courseStartRule, setCourseStartRule, courseControls,
    setCourseControls, courseTimeLimit, setCourseTimeLimit, coursePenalty, setCoursePenalty, courseClassAttempt, setCourseClassAttempt, courseClassError,
    setCourseClassError };
}

export function createCoursePreparationActions(ws: Base & RaceDataActions) {
  const { raceId, data, courseName, courseClassName, courseControls, courseStartRule, courseTimeLimit, coursePenalty, writingRef, pending, sent, requireSession,
    begin, finish, current, request, json, csrf, load, setMessage, setCourseClassError, setCourseClassErrors, courseForm,
    setCourseClassAttempt, setCourseName, setCourseClassName, setCourseControls, setCourseStartRule, setCourseTimeLimit, setCoursePenalty } = ws;
  /** Ny bana med klass ändrar inga resultat: sparas direkt utan granskningssteg (ADR-0169 beslut 4). */
  function saveCourseClass(event: FormEvent) {
    event.preventDefault();
    // Ett sparande i taget: medan förra banan skrivs väntar formuläret (fälten är inaktiva).
    if (writingRef.current || pending.current || !requireSession()) return;
    setCourseClassError("");
    const rogaining = ws.profile.features.rogaining;
    const errors = validateCourseClass({ courseName, className: courseClassName, controls: courseControls,
      rogaining: rogaining ? { timeLimit: courseTimeLimit, penalty: coursePenalty } : undefined });
    setCourseClassErrors(errors);
    if (hasErrors(errors)) { focusFirstError(courseForm.current); return; }
    const course = courseName.trim(), raceClass = courseClassName.trim();
    const codes = parseControlCodes(courseControls)!;
    if (!data) { setCourseClassError(text.courseClassUnavailable); return; }
    const limit = Number(courseTimeLimit.trim()), penalty = Number(coursePenalty.trim());
    const request: CourseClassRequest = { formatVersion: 1, requestId: crypto.randomUUID(),
      courseName: course, className: raceClass,
      // ADR-0170: typer utan val av startsätt (Träning, Rogaining) har alltid fri start.
      startRule: ws.profile.features.startRuleChoice ? courseStartRule : "PUNCH", controlCodes: codes,
      ...(rogaining ? { rogaining: { timeLimitMinutes: limit, penaltyPoints: penalty } } : {}) };
    const value = { kind: "COURSE_CLASS" as const, request };
    setMessage("");
    pending.current = value; sent.current = false; setCourseClassAttempt(value); void submitCourseClass(value);
  }
  async function submitCourseClass(value: CourseClassAttempt) {
    if (writingRef.current || !requireSession() || (pending.current && pending.current !== value)) return;
    const op = begin();
    let committed = false;
    try {
      const token = csrf();
      const response = await request("/course-classes", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `manual-course-class-create:${value.request.requestId}` },
        body: JSON.stringify(value.request) });
      if ([400, 409].includes(response.status)) {
        const duplicate = await isDuplicateName(response);
        pending.current = undefined; sent.current = false; setCourseClassAttempt(undefined);
        setCourseClassError(duplicate ? text.duplicateCourseOrClassName(value.request.courseName, value.request.className) : text.courseClassRejected);
        return;
      }
      if (!response.ok) throw new Error("Course class unavailable");
      const receipt = manualCourseClassCreateResponseSchema.parse(await json(response, op));
      if (receipt.raceId !== raceId || receipt.requestId !== value.request.requestId ||
        JSON.stringify(receipt.request) !== JSON.stringify(value.request)) throw new Error("Course class receipt mismatch");
      committed = true;
      pending.current = undefined; sent.current = false; setCourseClassAttempt(undefined); setCourseClassError("");
      // Formuläret töms helt, även startsättet och rogainingens förval (PLAN.md steg 24), och står kvar för nästa bana.
      setCourseName(""); setCourseClassName(""); setCourseControls(""); setCourseStartRule("PUNCH");
      setCourseTimeLimit("60"); setCoursePenalty("1"); setCourseClassErrors({}); setMessage("");
      await load(op); setMessage(text.courseClassSaved);
    } catch {
      if (current(op)) {
        if (committed) { setCourseClassError(text.courseClassSavedLoadError); setMessage(text.courseClassSavedLoadError); }
        else { pending.current = value; sent.current = true; setCourseClassAttempt(value); setCourseClassError(text.unreachable); }
      }
    } finally {
      finish(op);
      if (committed) focusWhenEnabled(courseForm, "input");
    }
  }
  return { saveCourseClass, submitCourseClass };
}
export type CoursePreparationActions = ReturnType<typeof createCoursePreparationActions>;
