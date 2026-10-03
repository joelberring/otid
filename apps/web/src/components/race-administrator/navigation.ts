import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PreparationStepArea } from "../race-preparation-guide";
import type { DuringArea, PreparationArea, WorkflowMode } from "./types";
import type { Base } from "./workspace-state";
import type { DuringRaceActions } from "./during-race";

/** Vilket arbetsflöde, vilken delvy och vilken mobilpanel som visas. */
export function useNavigationState() {
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("OVERVIEW");
  const [preparationArea, setPreparationArea] = useState<PreparationArea>("OVERVIEW");
  const [duringArea, setDuringArea] = useState<DuringArea>("OVERVIEW");
  const [mobilePanel, setMobilePanel] = useState<"LIST" | "WORK">("LIST");
  const [printTarget, setPrintTarget] = useState<"FOREST" | "RENTAL">();
  const [courseWarningClassId, setCourseWarningClassId] = useState("");
  const [courseSelectionReason, setCourseSelectionReason] = useState<"MISSING" | "ASSIGNED" | "DIRECT">("DIRECT");
  const [selectedCourseTarget, setSelectedCourseTarget] = useState<{ raceId: string; snapshotVersion: number; courseVersionId: string }>();
  const coursesNavigationButton = useRef<HTMLButtonElement>(null);
  const coursesNavigationSelect = useRef<HTMLSelectElement>(null);
  const preparationNavigation = useRef<HTMLElement>(null);
  const listPanel = useRef<HTMLElement | null>(null), workPanel = useRef<HTMLElement | null>(null);
  return { workflowMode, setWorkflowMode, preparationArea, setPreparationArea, duringArea, setDuringArea, mobilePanel, setMobilePanel,
    printTarget, setPrintTarget, courseWarningClassId, setCourseWarningClassId, courseSelectionReason, setCourseSelectionReason,
    selectedCourseTarget, setSelectedCourseTarget, coursesNavigationButton, coursesNavigationSelect, preparationNavigation,
    listPanel, workPanel };
}

export function createMobileNavigation(ws: Base) {
  const { busyRef, pending, requireSession, setMobilePanel, listPanel, workPanel } = ws;
  function showMobilePanel(value: "LIST" | "WORK") {
    // Read viewport only for this explicit navigation event; CSS owns responsive visibility.
    if (window.matchMedia("(max-width: 720px)").matches) {
      flushSync(() => setMobilePanel(value));
      (value === "LIST" ? listPanel : workPanel).current?.focus();
    } else setMobilePanel(value);
  }
  function navigateMobile(value: "LIST" | "WORK") {
    if (busyRef.current || pending.current || !requireSession()) return;
    showMobilePanel(value);
  }
  return { showMobilePanel, navigateMobile };
}
export type MobileNavigation = ReturnType<typeof createMobileNavigation>;

/** Navigering mellan arbetsflöden och genvägar från översikter till rätt formulär. */
export function createWorkflowNavigation(ws: Base & MobileNavigation & DuringRaceActions) {
  const { raceId, data, workflowLocked, duringArea, selectedClass, classNameClassId, classNamePanel, busyRef, pending,
    forestData, rentalEntries, unknownReadoutPanel, forestPanel, listPanel, coursesNavigationSelect, coursesNavigationButton,
    preparationNavigation, requireSession, showMobilePanel, loadRaceDayAttention, setSelectedCourseTarget,
    setCourseWarningClassId, setWorkflowMode, setForestClass, setForestQuery, setForestOpen, setQuery, setPage,
    setRosterClassId, setOlderResultsOnly, setRentalCardsOnly, setPaymentAttentionOnly, setResultState,
    setMissingFixedStartOnly, setEntryId, setClassId, setAction, setEffectiveResult, setEffectiveResultError,
    setClassNameCandidate, setClassNameInput, setClassNameReview, setClassNameError, setClassNameClassId,
    setCapacityClassId, setCapacityInput, setStartRuleClassId, setStartRulePreview, setStartRuleReason,
    setStartRuleConfirmed, setRecalculationCandidates, setMessage, setCourseSelectionReason, setPreparationArea,
    setPrintTarget } = ws;
  function navigateWorkflow(mode: WorkflowMode) {
    if (workflowLocked) return;
    setSelectedCourseTarget(undefined);
    if (mode !== "BEFORE") setCourseWarningClassId("");
    setWorkflowMode(mode);
    if (mode === "DURING" && duringArea === "OVERVIEW") void loadRaceDayAttention();
  }
  function openAttentionPanel(target: "FOREST" | "CONFLICT" | "STARTED_NO_RETURN" | "UNCONFIRMED" | "READOUT") {
    if (workflowLocked) return;
    const panel = target === "READOUT" ? unknownReadoutPanel.current : forestPanel.current;
    if (!panel) return;
    if (target !== "READOUT") {
      setForestClass(""); setForestQuery(""); setForestOpen(true);
    }
    panel.open = true;
    requestAnimationFrame(() => {
      const group = target === "FOREST" || target === "READOUT" ? undefined : panel.querySelector(`[data-forest-group="${target}"]`);
      panel.querySelector("summary")?.focus();
      (group ?? panel).scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
  function followUp(filter: "OLDER_RESULTS" | "RENTAL_CARDS" | "PAYMENT") {
    if (workflowLocked) return;
    setQuery(""); setPage(0); setRosterClassId("");
    setOlderResultsOnly(filter === "OLDER_RESULTS");
    setRentalCardsOnly(filter === "RENTAL_CARDS");
    setPaymentAttentionOnly(filter === "PAYMENT");
    setResultState("ALL");
    setMissingFixedStartOnly(false);
    flushSync(() => setWorkflowMode("PARTICIPANTS"));
    showMobilePanel("LIST");
  }
  function openMissingFixedStart(classId: string) {
    if (workflowLocked) return;
    setCourseWarningClassId("");
    setQuery(""); setPage(0); setRosterClassId(classId);
    setOlderResultsOnly(false); setRentalCardsOnly(false); setPaymentAttentionOnly(false); setResultState("ALL");
    setMissingFixedStartOnly(true);
    flushSync(() => setWorkflowMode("PARTICIPANTS"));
    showMobilePanel("LIST");
    listPanel.current?.focus();
  }
  function openClassParticipants(classId: string) {
    if (workflowLocked || data?.classes.filter((row) => row.id === classId).length !== 1) return;
    setEntryId(""); setClassId(""); setAction("INFO"); setEffectiveResult(undefined); setEffectiveResultError(false);
    setQuery(""); setPage(0); setRosterClassId(classId);
    setOlderResultsOnly(false); setRentalCardsOnly(false); setPaymentAttentionOnly(false);
    setMissingFixedStartOnly(false); setResultState("ALL");
    setSelectedCourseTarget(undefined); setCourseWarningClassId("");
    flushSync(() => setWorkflowMode("PARTICIPANTS"));
    showMobilePanel("LIST");
    listPanel.current?.focus();
  }
  function openClassSetup(classId: string, fromCourse = false) {
    const raceClass = data?.classes.find(row => row.id === classId);
    if (workflowLocked || !raceClass) return;
    if (classNameClassId !== classId) {
      if (classNamePanel.current) classNamePanel.current.open = false;
      setClassNameCandidate(undefined); setClassNameInput(""); setClassNameReview(undefined); setClassNameError("");
    }
    setClassNameClassId(classId);
    setCapacityClassId(classId);
    setCapacityInput(raceClass.maxEntries === null ? "" : String(raceClass.maxEntries));
    setStartRuleClassId(classId);
    setStartRulePreview(undefined); setStartRuleReason(""); setStartRuleConfirmed(false);
    setRecalculationCandidates(undefined); setMessage("");
    flushSync(() => {
      setCourseWarningClassId(classId);
      setCourseSelectionReason(fromCourse ? "ASSIGNED" : "DIRECT");
      setWorkflowMode("BEFORE"); setPreparationArea("CLASSES");
    });
  }
  function openAssignedClass(classId: string) {
    openClassSetup(classId, true);
  }
  function openCourseWarningClass(classId: string) {
    if (workflowLocked || !data?.classes.some((row) => row.id === classId)) return;
    flushSync(() => {
      setCourseWarningClassId(classId); setCourseSelectionReason("MISSING");
      setWorkflowMode("BEFORE"); setPreparationArea("CLASSES");
    });
  }
  function returnToCourses() {
    if (workflowLocked) return;
    setSelectedCourseTarget(undefined);
    flushSync(() => { setCourseWarningClassId(""); setPreparationArea("COURSES"); });
    (window.matchMedia("(max-width: 720px)").matches ? coursesNavigationSelect : coursesNavigationButton).current?.focus();
  }
  function openPreparationStep(area: PreparationStepArea) {
    if (workflowLocked) return;
    setCourseWarningClassId("");
    setSelectedCourseTarget(undefined);
    flushSync(() => setPreparationArea(area));
    const target = window.matchMedia("(max-width: 720px)").matches
      ? coursesNavigationSelect.current
      : preparationNavigation.current?.querySelector<HTMLButtonElement>(`[data-preparation-area="${area}"]`);
    target?.focus();
  }
  function openCourseTarget(courseVersionId: string) {
    if (workflowLocked || !data) return;
    flushSync(() => {
      setCourseWarningClassId("");
      setSelectedCourseTarget({ raceId, snapshotVersion: data.snapshotVersion, courseVersionId });
      setWorkflowMode("BEFORE");
      setPreparationArea("COURSES");
    });
  }
  function openAssignedCourse(courseVersionId: string) {
    if (!selectedClass || selectedClass.courseVersionId !== courseVersionId) return;
    openCourseTarget(courseVersionId);
  }
  function openClassCourse(classId: string) {
    const matchingClasses = data?.classes.filter((row) => row.id === classId) ?? [];
    if (matchingClasses.length !== 1) return;
    openCourseTarget(matchingClasses[0]!.courseVersionId);
  }
  function printPrivate(target: "FOREST" | "RENTAL") {
    if (busyRef.current || pending.current || !requireSession() ||
      (target === "FOREST" ? !forestData : !data || rentalEntries.length === 0)) return;
    flushSync(() => setPrintTarget(target));
    window.print();
  }
  return { navigateWorkflow, openAttentionPanel, followUp, openMissingFixedStart, openClassParticipants, openClassSetup,
    openAssignedClass, openCourseWarningClass, returnToCourses, openPreparationStep, openAssignedCourse, openClassCourse, printPrivate };
}
export type WorkflowNavigation = ReturnType<typeof createWorkflowNavigation>;
