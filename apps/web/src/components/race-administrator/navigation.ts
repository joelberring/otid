import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { RaceType } from "@o-tid/contracts";
import { activeSection, profileForRole, raceTypeProfile, sectionForPanel, type Panel, type SectionId,
  type WorkspaceRole } from "../../lib/race-sections";
import type { Base } from "./workspace-state";
import type { DuringRaceActions } from "./during-race";

/** Vilken del av tävlingen och vilken mobilpanel som visas. */
export function useNavigationState() {
  const [step, setStep] = useState<SectionId>("COURSES");
  const [mobilePanel, setMobilePanel] = useState<"LIST" | "WORK">("LIST");
  /** Användaren försökte lämna steget med inmatning som inte är sparad (PLAN.md steg 24). */
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const [printTarget, setPrintTarget] = useState<"FOREST" | "RENTAL">();
  const [selectedClassId, setSelectedClassId] = useState("");
  const listPanel = useRef<HTMLElement | null>(null), workPanel = useRef<HTMLElement | null>(null);
  return { step, setStep, mobilePanel, setMobilePanel, navigationBlocked, setNavigationBlocked, printTarget, setPrintTarget, selectedClassId, setSelectedClassId,
    listPanel, workPanel };
}

/**
 * ADR-0170: tävlingstypen avgör delarna och ADR-0172 rollen (funktionären ser färre). `section` är delen som
 * visas (den valda om den finns, annars Avläsning för funktionären och den första för administratören) och
 * `shows` säger om ett visst innehåll hör till den.
 */
export function deriveSections(s: { data?: { raceType: RaceType } | undefined; step: SectionId; role: WorkspaceRole }) {
  const profile = profileForRole(raceTypeProfile(s.data?.raceType ?? "STANDARD"), s.role);
  const functionary = s.role === "FUNCTIONARY";
  const section = activeSection(profile, s.step, functionary ? "READOUT" : undefined);
  return { profile, section, functionary, shows: (panel: Panel) => section.panels.includes(panel) };
}

export function createMobileNavigation(ws: Base) {
  const { writingRef, pending, requireSession, setMobilePanel, listPanel, workPanel } = ws;
  function showMobilePanel(value: "LIST" | "WORK") {
    // Read viewport only for this explicit navigation event; CSS owns responsive visibility.
    if (window.matchMedia("(max-width: 720px)").matches) {
      flushSync(() => setMobilePanel(value));
      (value === "LIST" ? listPanel : workPanel).current?.focus();
    } else setMobilePanel(value);
  }
  function navigateMobile(value: "LIST" | "WORK") {
    if (writingRef.current || pending.current || !requireSession()) return;
    showMobilePanel(value);
  }
  return { showMobilePanel, navigateMobile };
}
export type MobileNavigation = ReturnType<typeof createMobileNavigation>;

/** Navigering i checklistan och genvägar från tabellerna till rätt steg. */
export function createWorkflowNavigation(ws: Base & MobileNavigation & DuringRaceActions) {
  const { data, profile, navigationLocked, workflowLocked, writingRef, pending, forestData, rentalEntries, listPanel, requireSession, showMobilePanel,
    loadRaceDayAttention, setSelectedClassId, setStep, setQuery, setPage, setRosterClassId, setOlderResultsOnly,
    setRentalCardsOnly, setResultState, setMissingFixedStartOnly, setCapacityClassId,
    setCapacityInput, setMessage, setPrintTarget, setRelayMessage, setNavigationBlocked, setEditingCourseId, setEditingClassId,
    setCourseEditError, setClassEditError } = ws;
  /**
   * Byter steg. Sidopanelen är aldrig låst; bara när något inte är sparat (ett beslut som väntar, en granskning eller
   * en ändrad rad) stannar man kvar och får beskedet. En öppen rad utan ändring stängs.
   */
  function navigateStep(next: SectionId) {
    if (navigationLocked) { setNavigationBlocked(true); return; }
    setNavigationBlocked(false);
    setEditingCourseId(""); setEditingClassId(""); setCourseEditError(""); setClassEditError("");
    setSelectedClassId(""); setRelayMessage("");
    setStep(next);
    if (next === "READOUT") void loadRaceDayAttention();
  }
  /** "Mina tävlingar" i toppbalken: samma regel som stegen. Ger false när man ska stanna kvar. */
  function mayLeave(): boolean {
    if (!navigationLocked) return true;
    setNavigationBlocked(true);
    return false;
  }
  function openMissingFixedStart(classId: string) {
    if (workflowLocked) return;
    setSelectedClassId("");
    setQuery(""); setPage(0); setRosterClassId(classId);
    setOlderResultsOnly(false); setRentalCardsOnly(false); setResultState("ALL");
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
    flushSync(() => { setSelectedClassId(classId); setStep(sectionForPanel(profile, "CLASSES")?.id ?? "CLASSES"); });
  }
  function printPrivate(target: "FOREST" | "RENTAL") {
    if (writingRef.current || pending.current || !requireSession() ||
      (target === "FOREST" ? !forestData : !data || rentalEntries.length === 0)) return;
    flushSync(() => setPrintTarget(target));
    window.print();
  }
  return { navigateStep, mayLeave, openMissingFixedStart, openAssignedClass, printPrivate };
}
export type WorkflowNavigation = ReturnType<typeof createWorkflowNavigation>;
