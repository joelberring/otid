import { useOperationState, useOperations, type Operations } from "./operations";
import { createMobileNavigation, createWorkflowNavigation, deriveSections, useNavigationState } from "./navigation";
import { createRaceDataActions, useRaceDataState } from "./race-data";
import { createParticipantActions, deriveRoster, useRosterState } from "./participant-roster";
import { createEntryActions, deriveEntryActions, useEntryActionState } from "./entry-actions";
import { createResultDecisionActions, useResultDecisionState } from "./result-decisions";
import { createCoursePreparationActions, useCoursePreparationState } from "./course-preparation";
import { createCourseEditActions, useCourseEditState } from "./course-edit";
import { createClassEditActions, useClassEditState } from "./class-edit";
import { createCourseDetailsActions, useCourseDetailsState } from "./course-details";
import { createRemainingRunnersActions, useRemainingRunnersState } from "./remaining-runners";
import { createRogainingActions, useRogainingState } from "./rogaining-actions";
import { createCourseVariantActions, useCourseVariantState } from "./course-variant-actions";
import { createRelayActions, useRelayState } from "./relay-actions";
import { createStatusChangeActions, useStatusChangeState } from "./status-change";
import { createClassPreparationActions, deriveClassPreparation, useClassPreparationState } from "./class-preparation";
import { createStartListActions, useStartListState } from "./start-list-preparation";
import { createStartDrawActions, useStartDrawState } from "./start-draw";
import { createDuringRaceActions, deriveDuringRace, useDuringRaceState } from "./during-race";
import { createAfterRaceActions, deriveAfterRace, useAfterRaceState } from "./after-race";
import { createSettingsActions, useSettingsState } from "./settings-actions";
import { createRemovalActions, useRemovalState } from "./removal";
import { createResultsOfficialActions, useResultsOfficialState } from "./results-official";

/** Allt tillstånd i arbetsytan, samlat per område. */
export function useWorkspaceState(raceId: string) {
  return { raceId, ...useOperationState(), ...useNavigationState(), ...useRaceDataState(), ...useRosterState(),
    ...useEntryActionState(), ...useResultDecisionState(), ...useCoursePreparationState(), ...useCourseEditState(), ...useClassEditState(),
    ...useCourseDetailsState(), ...useRemainingRunnersState(),
    ...useRogainingState(),
    ...useCourseVariantState(), ...useRelayState(),
    ...useClassPreparationState(), ...useStatusChangeState(),
    ...useStartListState(), ...useStartDrawState(), ...useDuringRaceState(), ...useAfterRaceState(), ...useSettingsState(),
    ...useRemovalState(), ...useResultsOfficialState() };
}
export type WorkspaceState = ReturnType<typeof useWorkspaceState>;

/** Värden som räknas fram ur tillståndet vid varje rendering. */
export function deriveWorkspace(s: WorkspaceState) {
  const roster = deriveRoster(s);
  const during = deriveDuringRace(s);
  const editing = during.correctionPending || s.peoplePending ||
    !!s.reviewAttempt || !!s.startCorrection || !!s.returnAttempt || !!s.publicationAttempt ||
    !!s.drawAttempt || !!s.finalizationAttempt || !!s.transferAttempt || !!s.capacityAttempt || !!s.cardAttempt ||
    !!s.rentalAttempt || !!s.rentalReturnAttempt || !!s.rentalReuseAttempt || !!s.timeAttempt ||
    !!s.recalculationAttempt || !!s.identityAttempt || !!s.registrationAttempt || !!s.decisionAttempt || !!s.courseEditAttempt ||
    !!s.unknownReadoutAttempt || !!s.manualClassAttempt || !!s.classEditAttempt || !!s.entryVariantPreview ||
    !!s.rogainingAttempt || !!s.removalAttempt;
  // PLAN.md steg 24: bara det som sparas låses. En skrivning pågår när ett försök väntar på kvitto; läsningar låser inget.
  const saving = s.busy && s.writingRef.current;
  const disabled = saving || editing;
  // Inmatning som går förlorad om man byter steg: ett försök som väntar på svar från användaren, en öppen granskning
  // eller ett beslut som inte är bekräftat. En skrivning som är på väg avslutas av sig själv och hindrar inget.
  const course = s.courseList?.courses.find(row => row.courseId === s.editingCourseId);
  const original = (s.editingVariantCode ? course?.variants.find(row => row.code === s.editingVariantCode)?.controlCodes : course?.controlCodes) ?? [];
  const courseEdited = !!course && (s.courseEditForking ? JSON.stringify(s.courseEditForking) !== s.courseEditForkingOriginal
    : s.courseEditControls.trim().split(/[\s,]+/).filter(Boolean).join(" ") !== original.join(" "));
  const classRow = s.courseList?.classes.find(row => row.classId === s.editingClassId);
  const classEdited = !!classRow && (s.classEditName.trim() !== classRow.name || s.classEditCourseId !== classRow.courseId ||
    s.classEditStartRule !== classRow.startRule || s.classEditMaxTime.trim() !== (classRow.maxTimeMinutes ? String(classRow.maxTimeMinutes) : ""));
  const unsavedInput = !saving && (editing || courseEdited || classEdited || !!s.pending.current || !!s.reviewCandidate || !!s.courseClassAttempt ||
    !!s.manualClassAttempt || !!s.courseEditAttempt || !!s.courseEditPreview || !!s.classEditAttempt || !!s.classEditPreview ||
    !!s.classRecalculationAttempt || !!s.rogainingAttempt);
  const navigationLocked = unsavedInput;
  const workflowLocked = saving || navigationLocked;
  return { ...deriveSections(s), ...roster, ...deriveEntryActions(s, roster), ...deriveClassPreparation(s),
    ...during, ...deriveAfterRace(s), saving, disabled, navigationLocked, workflowLocked };
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
    ...createCoursePreparationActions(withData), ...createClassEditActions(withCourses), ...createCourseDetailsActions(withCourses),
    ...createRogainingActions(withCourses), ...createClassPreparationActions(withData),
    ...createCourseVariantActions(withCourses),
    ...createStatusChangeActions(withDecisions), ...createEntryActions(withData), ...createAfterRaceActions(withData), ...createRemainingRunnersActions(withData),
    ...createSettingsActions(withData), ...createRemovalActions(withCourses),
    ...createResultsOfficialActions(withData) };
  const withParticipants = { ...withAreas, ...createParticipantActions(withAreas) };
  return { ...withParticipants, ...createWorkflowNavigation(withParticipants) };
}
export type Workspace = ReturnType<typeof useWorkspace>;
