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
  const [selectedClassId, setSelectedClassId] = useState("");
  const coursesNavigationButton = useRef<HTMLButtonElement>(null);
  const coursesNavigationSelect = useRef<HTMLSelectElement>(null);
  const preparationNavigation = useRef<HTMLElement>(null);
  const listPanel = useRef<HTMLElement | null>(null), workPanel = useRef<HTMLElement | null>(null);
  return { workflowMode, setWorkflowMode, preparationArea, setPreparationArea, duringArea, setDuringArea, mobilePanel, setMobilePanel,
    printTarget, setPrintTarget, selectedClassId, setSelectedClassId,
    coursesNavigationButton, coursesNavigationSelect, preparationNavigation,
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
  const { data, workflowLocked, duringArea, busyRef, pending, forestData, rentalEntries, unknownReadoutPanel, forestPanel,
    listPanel, coursesNavigationSelect, preparationNavigation, requireSession, showMobilePanel, loadRaceDayAttention,
    setSelectedClassId, setWorkflowMode, setForestClass, setForestQuery, setForestOpen, setQuery,
    setPage, setRosterClassId, setOlderResultsOnly, setRentalCardsOnly, setPaymentAttentionOnly, setResultState,
    setMissingFixedStartOnly, setCapacityClassId, setCapacityInput, setMessage, setPreparationArea, setPrintTarget } = ws;
  function navigateWorkflow(mode: WorkflowMode) {
    if (workflowLocked) return;
    if (mode !== "BEFORE") setSelectedClassId("");
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
    setSelectedClassId("");
    setQuery(""); setPage(0); setRosterClassId(classId);
    setOlderResultsOnly(false); setRentalCardsOnly(false); setPaymentAttentionOnly(false); setResultState("ALL");
    setMissingFixedStartOnly(true);
    flushSync(() => setWorkflowMode("PARTICIPANTS"));
    showMobilePanel("LIST");
    listPanel.current?.focus();
  }
  function openClassSetup(classId: string) {
    const raceClass = data?.classes.find(row => row.id === classId);
    if (workflowLocked || !raceClass) return;
    setCapacityClassId(classId);
    setCapacityInput(raceClass.maxEntries === null ? "" : String(raceClass.maxEntries));
    setMessage("");
    flushSync(() => {
      setSelectedClassId(classId);
      setWorkflowMode("BEFORE"); setPreparationArea("CLASSES");
    });
  }
  function openAssignedClass(classId: string) {
    openClassSetup(classId);
  }
  function openPreparationStep(area: PreparationStepArea) {
    if (workflowLocked) return;
    setSelectedClassId("");
    flushSync(() => setPreparationArea(area));
    const target = window.matchMedia("(max-width: 720px)").matches
      ? coursesNavigationSelect.current
      : preparationNavigation.current?.querySelector<HTMLButtonElement>(`[data-preparation-area="${area}"]`);
    target?.focus();
  }
  function printPrivate(target: "FOREST" | "RENTAL") {
    if (busyRef.current || pending.current || !requireSession() ||
      (target === "FOREST" ? !forestData : !data || rentalEntries.length === 0)) return;
    flushSync(() => setPrintTarget(target));
    window.print();
  }
  return { navigateWorkflow, openAttentionPanel, followUp, openMissingFixedStart, openClassSetup,
    openAssignedClass, openPreparationStep, printPrivate };
}
export type WorkflowNavigation = ReturnType<typeof createWorkflowNavigation>;
