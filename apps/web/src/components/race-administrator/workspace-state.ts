import { useOperationState, useOperations, type Operations } from "./operations";
import { createMobileNavigation, createWorkflowNavigation, deriveSections, useNavigationState } from "./navigation";
import { createRaceDataActions, useRaceDataState } from "./race-data";
import { createParticipantActions, deriveRoster, useRosterState } from "./participant-roster";
import { createEntryActions, deriveEntryActions, useEntryActionState } from "./entry-actions";
import { createResultDecisionActions, useResultDecisionState } from "./result-decisions";
import { createCoursePreparationActions, useCoursePreparationState } from "./course-preparation";
import { createCourseEditActions, useCourseEditState } from "./course-edit";
import { createClassEditActions, useClassEditState } from "./class-edit";
import { createCourseVariantActions, useCourseVariantState } from "./course-variant-actions";
import { createRelayActions, useRelayState } from "./relay-actions";
import { createStatusChangeActions, useStatusChangeState } from "./status-change";
import { createClassPreparationActions, deriveClassPreparation, useClassPreparationState } from "./class-preparation";
import { createStartListActions, useStartListState } from "./start-list-preparation";
import { createStartDrawActions, useStartDrawState } from "./start-draw";
import { createDuringRaceActions, deriveDuringRace, useDuringRaceState } from "./during-race";
import { createAfterRaceActions, deriveAfterRace, useAfterRaceState } from "./after-race";
import { createSettingsActions, useSettingsState } from "./settings-actions";

/** Allt tillstånd i arbetsytan, samlat per område. */
export function useWorkspaceState(raceId: string) {
  return { raceId, ...useOperationState(), ...useNavigationState(), ...useRaceDataState(), ...useRosterState(),
    ...useEntryActionState(), ...useResultDecisionState(), ...useCoursePreparationState(), ...useCourseEditState(), ...useClassEditState(),
    ...useCourseVariantState(), ...useRelayState(),
    ...useClassPreparationState(), ...useStatusChangeState(),
    ...useStartListState(), ...useStartDrawState(), ...useDuringRaceState(), ...useAfterRaceState(), ...useSettingsState() };
}
export type WorkspaceState = ReturnType<typeof useWorkspaceState>;

/** Värden som räknas fram ur tillståndet vid varje rendering. */
export function deriveWorkspace(s: WorkspaceState) {
  const roster = deriveRoster(s);
  const during = deriveDuringRace(s);
  const editing = during.correctionPending || s.operatorAccessPending ||
    !!s.reviewAttempt || !!s.startCorrection || !!s.returnAttempt || !!s.publicationAttempt ||
    !!s.drawAttempt || !!s.finalizationAttempt || !!s.transferAttempt || !!s.capacityAttempt || !!s.cardAttempt ||
    !!s.rentalAttempt || !!s.rentalReturnAttempt || !!s.rentalReuseAttempt || !!s.timeAttempt ||
    !!s.recalculationAttempt || !!s.identityAttempt || !!s.registrationAttempt || !!s.dnsAttempt || !!s.dnfAttempt ||
    !!s.ntAttempt || !!s.oocAttempt || !!s.dsqAttempt || !!s.approvalAttempt || !!s.courseEditAttempt ||
    !!s.unknownReadoutAttempt || !!s.manualClassAttempt || !!s.classEditAttempt || !!s.entryVariantPreview;
  const disabled = s.busy || editing;
  // Låser byte av steg medan något granskas eller väntar på kvitto. En pågående läsning låser inte
  // checklistan: att byta steg medan data hämtas är ofarligt.
  const navigationLocked = editing || !!s.pending.current || !!s.reviewCandidate ||
    !!s.courseClassAttempt || !!s.manualClassAttempt ||
    !!s.editingCourseId || !!s.courseEditAttempt || !!s.editingClassId || !!s.classEditAttempt || !!s.shortenedCourseCandidate ||
    !!s.shortenedCourseAttempt || !!s.classRecalculationAttempt;
  const workflowLocked = s.busy || navigationLocked;
  return { ...deriveSections(s), ...roster, ...deriveEntryActions(s, roster), ...deriveClassPreparation(s),
    ...during, ...deriveAfterRace(s), disabled, navigationLocked, workflowLocked };
}
export type Derived = ReturnType<typeof deriveWorkspace>;

/** Det som alla områdens åtgärder får: tillstånd, härledda värden och den gemensamma anropshjälpen. */
export type Base = WorkspaceState & Derived & Operations;

/**
 * Bygger arbetsytan: tillstånd, härledda värden och åtgärder per område. Åtgärderna skapas i beroendeordning
 * så att varje område bara använder åtgärder från områden som redan finns.
 */
export function useWorkspace(raceId: string) {
  const s = useWorkspaceState(raceId);
  const operations = useOperations(s);
  const base: Base = { ...s, ...deriveWorkspace(s), ...operations };
  const withNavigation = { ...base, ...createMobileNavigation(base) };
  const withData = { ...withNavigation, ...createRaceDataActions(withNavigation) };
  const withRelay = { ...withData, ...createRelayActions(withData) };
  const withCourses = { ...withData, ...createCourseEditActions(withData) };
  const withDecisions = { ...withCourses, ...createResultDecisionActions(withCourses) };
  const withAreas = { ...withDecisions, ...withRelay, ...createDuringRaceActions(withRelay), ...createStartListActions(withData),
    ...createStartDrawActions(withData),
    ...createCoursePreparationActions(withData), ...createClassEditActions(withCourses), ...createClassPreparationActions(withData),
    ...createCourseVariantActions(withCourses),
    ...createStatusChangeActions(withDecisions), ...createEntryActions(withData), ...createAfterRaceActions(withData),
    ...createSettingsActions(withData) };
  const withParticipants = { ...withAreas, ...createParticipantActions(withAreas) };
  return { ...withParticipants, ...createWorkflowNavigation(withParticipants) };
}
export type Workspace = ReturnType<typeof useWorkspace>;
