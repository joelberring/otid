import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ChecklistStep } from "../../lib/admin-checklist";
import type { Base } from "./workspace-state";
import type { DuringRaceActions } from "./during-race";

/** Vilket steg i checklistan och vilken mobilpanel som visas. */
export function useNavigationState() {
  const [step, setStep] = useState<ChecklistStep>("COURSES");
  const [mobilePanel, setMobilePanel] = useState<"LIST" | "WORK">("LIST");
  const [printTarget, setPrintTarget] = useState<"FOREST" | "RENTAL">();
  const [selectedClassId, setSelectedClassId] = useState("");
  const listPanel = useRef<HTMLElement | null>(null), workPanel = useRef<HTMLElement | null>(null);
  return { step, setStep, mobilePanel, setMobilePanel, printTarget, setPrintTarget, selectedClassId, setSelectedClassId,
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

/** Navigering i checklistan och genvägar från tabellerna till rätt steg. */
export function createWorkflowNavigation(ws: Base & MobileNavigation & DuringRaceActions) {
  const { data, navigationLocked, workflowLocked, busyRef, pending, forestData, rentalEntries, listPanel, requireSession, showMobilePanel,
    loadRaceDayAttention, setSelectedClassId, setStep, setQuery, setPage, setRosterClassId, setOlderResultsOnly,
    setRentalCardsOnly, setPaymentAttentionOnly, setResultState, setMissingFixedStartOnly, setCapacityClassId,
    setCapacityInput, setMessage, setPrintTarget } = ws;
  function navigateStep(next: ChecklistStep) {
    if (navigationLocked) return;
    setSelectedClassId("");
    setStep(next);
    if (next === "READOUT") void loadRaceDayAttention();
  }
  function openMissingFixedStart(classId: string) {
    if (workflowLocked) return;
    setSelectedClassId("");
    setQuery(""); setPage(0); setRosterClassId(classId);
    setOlderResultsOnly(false); setRentalCardsOnly(false); setPaymentAttentionOnly(false); setResultState("ALL");
    setMissingFixedStartOnly(true);
    flushSync(() => setStep("ENTRIES"));
    showMobilePanel("LIST");
    listPanel.current?.focus();
  }
  function openAssignedClass(classId: string) {
    const raceClass = data?.classes.find(row => row.id === classId);
    if (workflowLocked || !raceClass) return;
    setCapacityClassId(classId);
    setCapacityInput(raceClass.maxEntries === null ? "" : String(raceClass.maxEntries));
    setMessage("");
    flushSync(() => { setSelectedClassId(classId); setStep("CLASSES"); });
  }
  function printPrivate(target: "FOREST" | "RENTAL") {
    if (busyRef.current || pending.current || !requireSession() ||
      (target === "FOREST" ? !forestData : !data || rentalEntries.length === 0)) return;
    flushSync(() => setPrintTarget(target));
    window.print();
  }
  return { navigateStep, openMissingFixedStart, openAssignedClass, printPrivate };
}
export type WorkflowNavigation = ReturnType<typeof createWorkflowNavigation>;
