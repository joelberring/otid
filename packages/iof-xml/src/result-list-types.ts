/** IOF XML 3.0 ResultList: projektionen som `serializeIofResultList` skriver, och felet när den är ogiltig. */
export type IofResultListStatus = "OK" | "OVERTIME" | "MP" | "DSQ" | "DNF" | "OOC" | "DNS";

export interface IofResultListExpectedControl {
  readonly controlCode: number;
  readonly occurrence: number;
}

export interface IofResultListSplit {
  readonly controlCode: number;
  readonly occurrence: number;
  readonly elapsedMs: number;
}

/** IOF 3.0 Score, t.ex. rogainingens summa (type="Score") och straff (type="Penalty"). */
export interface IofResultListScore {
  readonly type: string;
  readonly value: number;
}

export interface IofResultListManualApprovalProof {
  /** Internal approval-decision identity; never written to the IOF document. */
  readonly decisionId: string;
  /** Exact technical result revision approved by the decision; never serialized. */
  readonly targetResultRevisionId: string;
}

/** Banan i resultatet (IOF 3.0 SimpleCourse): namn (variantens namn i en gafflad klass), längd och stigning i meter. */
export interface IofResultListCourse {
  readonly name?: string | undefined;
  readonly lengthMeters?: number | undefined;
  readonly climbMeters?: number | undefined;
}

interface IofResultListPersonResultBase {
  readonly entryExternalId?: string;
  /** Eventors person- och klubb-id (PLAN.md steg 25), skrivs som Id type="Eventor". */
  readonly personEventorId?: string;
  readonly organisationEventorId?: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organisationName?: string;
  /** SPORTident-brickan (ControlCard punchingSystem="SI"). */
  readonly cardNumber?: string;
  /** Löparens bana: varianten i en gafflad klass med banans längd och stigning. */
  readonly course?: IofResultListCourse;
}

export interface IofResultListEvaluatedPersonResult extends IofResultListPersonResultBase {
  readonly status: Exclude<IofResultListStatus, "DNF" | "OOC">;
  readonly startTime?: string;
  readonly finishTime?: string;
  readonly elapsedMs?: number;
  /** Already-derived individual ranking; serialized only as a complete pair for OK. */
  readonly position?: number;
  readonly timeBehindMs?: number;
  readonly expectedControls: readonly IofResultListExpectedControl[];
  readonly splits: readonly IofResultListSplit[];
  /** Stämplade kontroller utan giltig tid (före start eller efter mål): SplitTime utan Time (PLAN.md steg 13). */
  readonly untimedControls?: readonly IofResultListExpectedControl[];
  /** Rogaining: poäng. En klass med poäng rangordnas på poäng, så placering anges utan tid efter. */
  readonly scores?: readonly IofResultListScore[];
  /**
   * Internal proof for an approved OK projection whose source has a missing
   * expected split. It is runtime-validated and intentionally never emitted.
   */
  readonly manualApprovalProof?: IofResultListManualApprovalProof;
}

/** OOC preserves technical timing/control facts but can never carry ranking or an approval proof. */
export interface IofResultListOutOfCompetitionPersonResult extends IofResultListPersonResultBase {
  readonly status: "OOC";
  readonly startTime?: string;
  readonly finishTime?: string;
  readonly elapsedMs?: number;
  readonly position?: never;
  readonly timeBehindMs?: never;
  readonly expectedControls: readonly IofResultListExpectedControl[];
  readonly splits: readonly IofResultListSplit[];
  readonly untimedControls?: readonly IofResultListExpectedControl[];
  readonly scores?: readonly IofResultListScore[];
  readonly manualApprovalProof?: never;
}

/**
 * Brutit: aldrig mål, tid, placering eller bevis. Steg 38: med avläsning starten och sträcktiderna fram till sista
 * stämplade kontrollen (banans övriga kontroller skrivs som saknade); annars bara status.
 */
export interface IofResultListDidNotFinishPersonResult extends IofResultListPersonResultBase {
  readonly status: "DNF";
  readonly startTime?: string;
  readonly finishTime?: never;
  readonly elapsedMs?: never;
  readonly position?: never;
  readonly timeBehindMs?: never;
  readonly expectedControls?: readonly IofResultListExpectedControl[];
  readonly splits?: readonly IofResultListSplit[];
  readonly untimedControls?: never;
  readonly scores?: never;
  readonly manualApprovalProof?: never;
}

export type IofResultListPersonResult =
  | IofResultListEvaluatedPersonResult
  | IofResultListOutOfCompetitionPersonResult
  | IofResultListDidNotFinishPersonResult;

/** Stafett: en sträcklöpares resultat. Placering och tid efter gäller sträckan (type="Leg"). */
export interface IofResultListTeamMemberResult {
  readonly leg: number;
  /** Steg 48: ordning inom sträckan (IOF LegOrder) när sträckan har flera löpare. */
  readonly legOrder?: number;
  readonly result: IofResultListPersonResult;
}

export type IofResultListTeamStatus = IofResultListStatus | "Active";

/** Stafett: lagets resultat (lagets tid, placering och status skrivs som OverallResult på sista avlästa sträckan). */
export interface IofResultListTeamResult {
  readonly name: string;
  readonly bibNumber: number;
  readonly organisationName?: string;
  readonly legCount: number;
  readonly status: IofResultListTeamStatus;
  readonly elapsedMs?: number;
  readonly position?: number;
  readonly timeBehindMs?: number;
  readonly members: readonly IofResultListTeamMemberResult[];
}

export interface IofResultListClass {
  readonly className: string;
  readonly classExternalId?: string;
  /** Klassens bana med längd och stigning (ClassResult/Course). */
  readonly course?: IofResultListCourse;
  readonly results: readonly IofResultListPersonResult[];
  /** Stafettklass: lagresultat i stället för individuella resultat. */
  readonly teamResults?: readonly IofResultListTeamResult[];
}

export interface IofResultListFinalizationProof {
  /** Internal finalization identity; never written to the IOF document. */
  readonly finalizationId: string;
  /** Scope-local immutable finalization revision. */
  readonly revision: number;
  /** Canonical SHA-256 of the immutable finalization source. */
  readonly sourceHash: string;
}

interface IofResultListProjectionBase {
  readonly eventName: string;
  readonly classes: readonly IofResultListClass[];
}

export interface IofResultListSnapshotProjection extends IofResultListProjectionBase {
  readonly status: "Snapshot";
}

export interface IofResultListCompleteProjection extends IofResultListProjectionBase {
  readonly status: "Complete";
  readonly finalizationProof: IofResultListFinalizationProof;
}

export type IofResultListProjection =
  | IofResultListSnapshotProjection
  | IofResultListCompleteProjection;

export class IofResultListSerializationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Ogiltig IOF ResultList-projektion: ${issues.join("; ")}`);
    this.name = "IofResultListSerializationError";
    this.issues = issues;
  }
}
